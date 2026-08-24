#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <linux/gpio.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#include "vds4e/adapter_bridge.h"

#define DEFAULT_CONFIGFS_ROOT "/sys/kernel/config/gpio-sim"
#define MAX_LINES 1024U

static volatile sig_atomic_t stop_requested;

static int write_attribute(const char *path, const char *value);
static int read_attribute(const char *path, char *buffer, size_t capacity);

static void handle_signal(int signal_number)
{
    (void)signal_number;
    stop_requested = 1;
}

static void usage(FILE *stream, const char *program)
{
    fprintf(stream,
            "Usage: %s --name NAME --label LABEL --lines COUNT "
            "--device-id ID --socket PATH [--configfs-root PATH] "
            "[--sysfs-root PATH]\n",
            program);
}

static int synchronize_lines(vds_adapter_bridge_t *client,
                             const char *device_id,
                             const char *sysfs_root,
                             const char *platform_name,
                             const char *chip_name,
                             int chip_fd,
                             size_t line_count,
                             uint8_t *applied_values)
{
    uint8_t host_values[MAX_LINES];
    uint8_t host_outputs[MAX_LINES];
    uint8_t device_values[MAX_LINES];
    char path[768];
    char value[16];
    size_t device_count = 0U;
    size_t index;
    vds_error_t error;

    for (index = 0U; index < line_count; ++index) {
        struct gpio_v2_line_info line_info;
        memset(&line_info, 0, sizeof(line_info));
        line_info.offset = (uint32_t)index;
        if (ioctl(chip_fd, GPIO_V2_GET_LINEINFO_IOCTL, &line_info) != 0) {
            return -1;
        }
        host_outputs[index] =
            (line_info.flags & GPIO_V2_LINE_FLAG_OUTPUT) != 0U ? 1U : 0U;
        if (snprintf(path, sizeof(path), "%s/%s/%s/sim_gpio%zu/value",
                     sysfs_root, platform_name, chip_name, index) >=
            (int)sizeof(path) ||
            read_attribute(path, value, sizeof(value)) != 0) {
            return -1;
        }
        host_values[index] = strcmp(value, "1") == 0 ? 1U : 0U;
    }
    const vds_status_t status =
        vds_gpio_exchange(client, device_id, host_values, host_outputs, line_count,
                          device_values, sizeof(device_values), &device_count,
                          &error);
    if (status != VDS_OK || device_count != line_count) {
        if (status == VDS_ERR_SERVER) {
            fprintf(stderr, "GPIO runtime exchange failed: %s\n",
                    error.message);
        }
        errno = EPROTO;
        return -1;
    }
    for (index = 0U; index < line_count; ++index) {
        if (applied_values[index] == device_values[index]) {
            continue;
        }
        if (snprintf(path, sizeof(path), "%s/%s/%s/sim_gpio%zu/pull",
                     sysfs_root, platform_name, chip_name, index) >=
            (int)sizeof(path) ||
            write_attribute(path,
                            device_values[index] != 0U ? "pull-up"
                                                       : "pull-down") != 0) {
            return -1;
        }
        applied_values[index] = device_values[index];
    }
    return 0;
}

static bool valid_name(const char *value)
{
    size_t index;

    if (value == NULL || value[0] == '\0') {
        return false;
    }
    for (index = 0U; value[index] != '\0'; ++index) {
        const char character = value[index];
        const bool alpha_numeric =
            (character >= 'a' && character <= 'z') ||
            (character >= 'A' && character <= 'Z') ||
            (character >= '0' && character <= '9');
        if (!alpha_numeric && character != '-' && character != '_') {
            return false;
        }
    }
    return index <= 64U;
}

static int write_attribute(const char *path, const char *value)
{
    FILE *file = fopen(path, "w");
    int result = 0;

    if (file == NULL) {
        return -1;
    }
    if (fputs(value, file) == EOF) {
        result = -1;
    }
    if (fclose(file) != 0) {
        result = -1;
    }
    return result;
}

static int read_attribute(const char *path, char *buffer, size_t capacity)
{
    FILE *file = fopen(path, "r");
    size_t length;

    if (file == NULL) {
        return -1;
    }
    if (fgets(buffer, (int)capacity, file) == NULL) {
        (void)fclose(file);
        return -1;
    }
    (void)fclose(file);
    length = strlen(buffer);
    while (length > 0U &&
           (buffer[length - 1U] == '\n' || buffer[length - 1U] == '\r')) {
        buffer[--length] = '\0';
    }
    return 0;
}

static int make_directory(const char *path)
{
    if (mkdir(path, 0755) == 0) {
        return 0;
    }
    return errno == EEXIST ? 0 : -1;
}

static int wait_for_device(const char *device_path)
{
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 50000000L};
    unsigned int attempt;

    for (attempt = 0U; attempt < 100U; ++attempt) {
        if (access(device_path, F_OK) == 0) {
            return 0;
        }
        (void)nanosleep(&delay, NULL);
    }
    errno = ETIMEDOUT;
    return -1;
}

int main(int argc, char **argv)
{
    const char *name = NULL;
    const char *label = NULL;
    const char *device_id = NULL;
    const char *socket_path = NULL;
    const char *configfs_root = DEFAULT_CONFIGFS_ROOT;
    const char *sysfs_root = "/sys/devices/platform";
    unsigned long line_count = 0UL;
    char device_dir[512];
    char bank_dir[544];
    char attribute[768];
    char chip_name[128];
    char platform_name[128];
    char device_path[160];
    char line_count_text[32];
    char line_dir[608];
    char line_name[32];
    struct sigaction action;
    int index;
    int chip_fd = -1;
    int result = EXIT_FAILURE;
    bool live = false;
    vds_adapter_bridge_t client = {.fd = -1, .next_request_id = 1U};
    uint8_t applied_values[MAX_LINES];
    const char *line_names[MAX_LINES];
    size_t supplied_line_names = 0U;

    memset(applied_values, 0xFF, sizeof(applied_values));
    memset(line_names, 0, sizeof(line_names));

    for (index = 1; index < argc; ++index) {
        if (strcmp(argv[index], "--help") == 0) {
            usage(stdout, argv[0]);
            return EXIT_SUCCESS;
        }
        if (index + 1 >= argc) {
            usage(stderr, argv[0]);
            return EXIT_FAILURE;
        }
        if (strcmp(argv[index], "--name") == 0) {
            name = argv[++index];
        } else if (strcmp(argv[index], "--label") == 0) {
            label = argv[++index];
        } else if (strcmp(argv[index], "--lines") == 0) {
            char *end = NULL;
            errno = 0;
            line_count = strtoul(argv[++index], &end, 10);
            if (errno != 0 || end == NULL || *end != '\0') {
                line_count = 0UL;
            }
        } else if (strcmp(argv[index], "--configfs-root") == 0) {
            configfs_root = argv[++index];
        } else if (strcmp(argv[index], "--sysfs-root") == 0) {
            sysfs_root = argv[++index];
        } else if (strcmp(argv[index], "--device-id") == 0) {
            device_id = argv[++index];
        } else if (strcmp(argv[index], "--socket") == 0) {
            socket_path = argv[++index];
        } else if (strcmp(argv[index], "--line-name") == 0) {
            if (supplied_line_names >= MAX_LINES) {
                fprintf(stderr, "too many GPIO line names\n");
                return EXIT_FAILURE;
            }
            line_names[supplied_line_names++] = argv[++index];
        } else {
            usage(stderr, argv[0]);
            return EXIT_FAILURE;
        }
    }

    if (!valid_name(name) || label == NULL || label[0] == '\0' ||
        device_id == NULL || device_id[0] == '\0' || socket_path == NULL ||
        socket_path[0] == '\0' ||
        line_count == 0UL || line_count > MAX_LINES) {
        fprintf(stderr,
                "name must be safe and line count must be between 1 and %u\n",
                MAX_LINES);
        return EXIT_FAILURE;
    }
    if (supplied_line_names != 0U &&
        supplied_line_names != (size_t)line_count) {
        fprintf(stderr, "line-name count must match --lines\n");
        return EXIT_FAILURE;
    }
    for (size_t line = 0U; line < supplied_line_names; ++line) {
        if (line_names[line][0] == '\0' || strlen(line_names[line]) > 31U) {
            fprintf(stderr, "GPIO line names must contain 1-31 characters\n");
            return EXIT_FAILURE;
        }
    }
    if (access(configfs_root, R_OK | W_OK) != 0) {
        fprintf(stderr,
                "gpio-sim configfs root '%s' is unavailable: %s\n",
                configfs_root, strerror(errno));
        return EXIT_FAILURE;
    }

    if (snprintf(device_dir, sizeof(device_dir), "%s/%s", configfs_root,
                 name) >= (int)sizeof(device_dir) ||
        snprintf(bank_dir, sizeof(bank_dir), "%s/bank0", device_dir) >=
            (int)sizeof(bank_dir)) {
        fprintf(stderr, "gpio-sim configfs path is too long\n");
        return EXIT_FAILURE;
    }
    if (mkdir(device_dir, 0755) != 0) {
        fprintf(stderr, "cannot create '%s': %s\n", device_dir,
                strerror(errno));
        return EXIT_FAILURE;
    }
    if (make_directory(bank_dir) != 0) {
        fprintf(stderr, "cannot create '%s': %s\n", bank_dir, strerror(errno));
        goto cleanup;
    }

    (void)snprintf(attribute, sizeof(attribute), "%s/label", bank_dir);
    if (write_attribute(attribute, label) != 0 && errno != ENOENT) {
        fprintf(stderr, "cannot set GPIO chip label: %s\n", strerror(errno));
        goto cleanup;
    }
    (void)snprintf(attribute, sizeof(attribute), "%s/num_lines", bank_dir);
    (void)snprintf(line_count_text, sizeof(line_count_text), "%lu", line_count);
    if (write_attribute(attribute, line_count_text) != 0) {
        fprintf(stderr, "cannot set GPIO line count: %s\n", strerror(errno));
        goto cleanup;
    }
    for (unsigned long line = 0UL; line < line_count; ++line) {
        if (snprintf(line_dir, sizeof(line_dir), "%s/line%lu", bank_dir,
                     line) >= (int)sizeof(line_dir) ||
            make_directory(line_dir) != 0) {
            fprintf(stderr, "cannot create GPIO line %lu: %s\n", line,
                    strerror(errno));
            goto cleanup;
        }
        (void)snprintf(attribute, sizeof(attribute), "%s/name", line_dir);
        const char *configured_name;
        if (supplied_line_names == 0U) {
            (void)snprintf(line_name, sizeof(line_name), "GPIO%lu", line);
            configured_name = line_name;
        } else {
            configured_name = line_names[line];
        }
        if (write_attribute(attribute, configured_name) != 0) {
            fprintf(stderr, "cannot name GPIO line %lu: %s\n", line,
                    strerror(errno));
            goto cleanup;
        }
    }

    (void)snprintf(attribute, sizeof(attribute), "%s/live", device_dir);
    if (write_attribute(attribute, "1") != 0) {
        fprintf(stderr, "cannot activate gpio-sim device: %s\n",
                strerror(errno));
        goto cleanup;
    }
    live = true;

    (void)snprintf(attribute, sizeof(attribute), "%s/chip_name", bank_dir);
    if (read_attribute(attribute, chip_name, sizeof(chip_name)) != 0 ||
        strncmp(chip_name, "gpiochip", 8U) != 0) {
        fprintf(stderr, "cannot discover gpio-sim chip name: %s\n",
                strerror(errno));
        goto cleanup;
    }
    (void)snprintf(attribute, sizeof(attribute), "%s/dev_name", device_dir);
    if (read_attribute(attribute, platform_name, sizeof(platform_name)) != 0) {
        fprintf(stderr, "cannot discover gpio-sim platform name: %s\n",
                strerror(errno));
        goto cleanup;
    }
    (void)snprintf(device_path, sizeof(device_path), "/dev/%s", chip_name);
    if (wait_for_device(device_path) != 0) {
        fprintf(stderr, "GPIO character device '%s' did not appear: %s\n",
                device_path, strerror(errno));
        goto cleanup;
    }
    chip_fd = open(device_path, O_RDONLY | O_CLOEXEC);
    if (chip_fd < 0) {
        fprintf(stderr, "cannot open GPIO character device '%s': %s\n",
                device_path, strerror(errno));
        goto cleanup;
    }
    if (vds_adapter_bridge_connect(&client, socket_path) != VDS_OK) {
        fprintf(stderr, "cannot connect to VDS4E data plane '%s'\n",
                socket_path);
        goto cleanup;
    }

    memset(&action, 0, sizeof(action));
    action.sa_handler = handle_signal;
    (void)sigemptyset(&action.sa_mask);
    (void)sigaction(SIGINT, &action, NULL);
    (void)sigaction(SIGTERM, &action, NULL);

    printf("%s\n", device_path);
    fflush(stdout);
    while (!stop_requested) {
        struct timespec delay = {.tv_sec = 0, .tv_nsec = 10000000L};
        if (synchronize_lines(&client, device_id, sysfs_root, platform_name,
                              chip_name, chip_fd, (size_t)line_count,
                              applied_values) != 0) {
            fprintf(stderr, "GPIO line synchronization failed: %s\n",
                    strerror(errno));
            goto cleanup;
        }
        (void)nanosleep(&delay, NULL);
    }
    result = EXIT_SUCCESS;

cleanup:
    if (chip_fd >= 0) {
        (void)close(chip_fd);
    }
    vds_adapter_bridge_close(&client);
    (void)snprintf(attribute, sizeof(attribute), "%s/live", device_dir);
    if (live && write_attribute(attribute, "0") != 0) {
        fprintf(stderr, "cannot deactivate gpio-sim device: %s\n",
                strerror(errno));
        result = EXIT_FAILURE;
    }
    for (unsigned long line = line_count; line > 0UL; --line) {
        (void)snprintf(line_dir, sizeof(line_dir), "%s/line%lu", bank_dir,
                       line - 1UL);
        if (rmdir(line_dir) != 0 && errno != ENOENT) {
            fprintf(stderr, "cannot remove '%s': %s\n", line_dir,
                    strerror(errno));
            result = EXIT_FAILURE;
        }
    }
    if (rmdir(bank_dir) != 0 && errno != ENOENT) {
        fprintf(stderr, "cannot remove '%s': %s\n", bank_dir, strerror(errno));
        result = EXIT_FAILURE;
    }
    if (rmdir(device_dir) != 0 && errno != ENOENT) {
        fprintf(stderr, "cannot remove '%s': %s\n", device_dir,
                strerror(errno));
        result = EXIT_FAILURE;
    }
    return result;
}
