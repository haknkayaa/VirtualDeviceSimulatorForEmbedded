#define _POSIX_C_SOURCE 200809L

#include "gpio_sim.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

int vds4e_gpio_write_attribute(const char *path, const char *value) {
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

int vds4e_gpio_read_attribute(const char *path, char *buffer,
                              size_t capacity) {
  FILE *file = fopen(path, "r");
  if (file == NULL) {
    return -1;
  }
  if (fgets(buffer, (int)capacity, file) == NULL) {
    (void)fclose(file);
    return -1;
  }
  (void)fclose(file);
  size_t length = strlen(buffer);
  while (length > 0U &&
         (buffer[length - 1U] == '\n' || buffer[length - 1U] == '\r')) {
    buffer[--length] = '\0';
  }
  return 0;
}

static int make_directory(const char *path) {
  if (mkdir(path, 0755) == 0) {
    return 0;
  }
  return errno == EEXIST ? 0 : -1;
}

static int wait_for_device(const char *device_path) {
  const struct timespec delay = {.tv_sec = 0, .tv_nsec = 50000000L};
  for (unsigned int attempt = 0U; attempt < 100U; ++attempt) {
    if (access(device_path, F_OK) == 0) {
      return 0;
    }
    (void)nanosleep(&delay, NULL);
  }
  errno = ETIMEDOUT;
  return -1;
}

int vds4e_gpio_chip_provision(const vds4e_gpio_config_t *config,
                              vds4e_gpio_chip_t *chip) {
  char attribute[768];
  char line_count_text[32];
  char line_dir[608];
  char generated_line_name[32];

  if (access(config->configfs_root, R_OK | W_OK) != 0) {
    fprintf(stderr, "gpio-sim configfs root '%s' is unavailable: %s\n",
            config->configfs_root, strerror(errno));
    return -1;
  }
  if (snprintf(chip->device_dir, sizeof(chip->device_dir), "%s/%s",
               config->configfs_root, config->name) >=
          (int)sizeof(chip->device_dir) ||
      snprintf(chip->bank_dir, sizeof(chip->bank_dir), "%s/bank0",
               chip->device_dir) >= (int)sizeof(chip->bank_dir)) {
    fputs("gpio-sim configfs path is too long\n", stderr);
    return -1;
  }
  if (mkdir(chip->device_dir, 0755) != 0) {
    fprintf(stderr, "cannot create '%s': %s\n", chip->device_dir,
            strerror(errno));
    return -1;
  }
  chip->created = true;
  if (make_directory(chip->bank_dir) != 0) {
    fprintf(stderr, "cannot create '%s': %s\n", chip->bank_dir,
            strerror(errno));
    return -1;
  }

  (void)snprintf(attribute, sizeof(attribute), "%s/label", chip->bank_dir);
  if (vds4e_gpio_write_attribute(attribute, config->label) != 0 &&
      errno != ENOENT) {
    fprintf(stderr, "cannot set GPIO chip label: %s\n", strerror(errno));
    return -1;
  }
  (void)snprintf(attribute, sizeof(attribute), "%s/num_lines",
                 chip->bank_dir);
  (void)snprintf(line_count_text, sizeof(line_count_text), "%zu",
                 config->line_count);
  if (vds4e_gpio_write_attribute(attribute, line_count_text) != 0) {
    fprintf(stderr, "cannot set GPIO line count: %s\n", strerror(errno));
    return -1;
  }
  for (size_t line = 0U; line < config->line_count; ++line) {
    if (snprintf(line_dir, sizeof(line_dir), "%s/line%zu", chip->bank_dir,
                 line) >= (int)sizeof(line_dir) ||
        make_directory(line_dir) != 0) {
      fprintf(stderr, "cannot create GPIO line %zu: %s\n", line,
              strerror(errno));
      return -1;
    }
    (void)snprintf(attribute, sizeof(attribute), "%s/name", line_dir);
    const char *configured_name = config->line_names[line];
    if (config->supplied_line_names == 0U) {
      (void)snprintf(generated_line_name, sizeof(generated_line_name),
                     "GPIO%zu", line);
      configured_name = generated_line_name;
    }
    if (vds4e_gpio_write_attribute(attribute, configured_name) != 0) {
      fprintf(stderr, "cannot name GPIO line %zu: %s\n", line,
              strerror(errno));
      return -1;
    }
  }

  (void)snprintf(attribute, sizeof(attribute), "%s/live", chip->device_dir);
  if (vds4e_gpio_write_attribute(attribute, "1") != 0) {
    fprintf(stderr, "cannot activate gpio-sim device: %s\n", strerror(errno));
    return -1;
  }
  chip->live = true;

  (void)snprintf(attribute, sizeof(attribute), "%s/chip_name", chip->bank_dir);
  if (vds4e_gpio_read_attribute(attribute, chip->chip_name,
                                sizeof(chip->chip_name)) != 0 ||
      strncmp(chip->chip_name, "gpiochip", 8U) != 0) {
    fprintf(stderr, "cannot discover gpio-sim chip name: %s\n",
            strerror(errno));
    return -1;
  }
  (void)snprintf(attribute, sizeof(attribute), "%s/dev_name",
                 chip->device_dir);
  if (vds4e_gpio_read_attribute(attribute, chip->platform_name,
                                sizeof(chip->platform_name)) != 0) {
    fprintf(stderr, "cannot discover gpio-sim platform name: %s\n",
            strerror(errno));
    return -1;
  }
  (void)snprintf(chip->device_path, sizeof(chip->device_path), "/dev/%s",
                 chip->chip_name);
  if (wait_for_device(chip->device_path) != 0) {
    fprintf(stderr, "GPIO character device '%s' did not appear: %s\n",
            chip->device_path, strerror(errno));
    return -1;
  }
  chip->chip_fd = open(chip->device_path, O_RDONLY | O_CLOEXEC);
  if (chip->chip_fd < 0) {
    fprintf(stderr, "cannot open GPIO character device '%s': %s\n",
            chip->device_path, strerror(errno));
    return -1;
  }
  return 0;
}

int vds4e_gpio_chip_destroy(const vds4e_gpio_config_t *config,
                            vds4e_gpio_chip_t *chip) {
  char attribute[768];
  char line_dir[608];
  int result = 0;

  if (chip->chip_fd >= 0) {
    (void)close(chip->chip_fd);
    chip->chip_fd = -1;
  }
  if (!chip->created) {
    return 0;
  }
  (void)snprintf(attribute, sizeof(attribute), "%s/live", chip->device_dir);
  if (chip->live && vds4e_gpio_write_attribute(attribute, "0") != 0) {
    fprintf(stderr, "cannot deactivate gpio-sim device: %s\n",
            strerror(errno));
    result = -1;
  }
  for (size_t line = config->line_count; line > 0U; --line) {
    (void)snprintf(line_dir, sizeof(line_dir), "%s/line%zu", chip->bank_dir,
                   line - 1U);
    if (rmdir(line_dir) != 0 && errno != ENOENT) {
      fprintf(stderr, "cannot remove '%s': %s\n", line_dir, strerror(errno));
      result = -1;
    }
  }
  if (chip->bank_dir[0] != '\0' && rmdir(chip->bank_dir) != 0 &&
      errno != ENOENT) {
    fprintf(stderr, "cannot remove '%s': %s\n", chip->bank_dir,
            strerror(errno));
    result = -1;
  }
  if (rmdir(chip->device_dir) != 0 && errno != ENOENT) {
    fprintf(stderr, "cannot remove '%s': %s\n", chip->device_dir,
            strerror(errno));
    result = -1;
  }
  return result;
}
