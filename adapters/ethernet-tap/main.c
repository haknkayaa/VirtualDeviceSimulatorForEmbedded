#include <errno.h>
#include <fcntl.h>
#include <linux/if_tun.h>
#include <net/if.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <unistd.h>

#include "adapter_bridge.h"

static volatile sig_atomic_t running = 1;

static void stop(int signum) {
    (void)signum;
    running = 0;
}

static int write_frame(int fd, const uint8_t *data, size_t size) {
    for (;;) {
        ssize_t written = write(fd, data, size);
        if (written < 0 && errno == EINTR) continue;
        return written == (ssize_t)size ? 0 : -1;
    }
}

static int valid_ifname(const char *name) {
    size_t len = strlen(name);
    if (len == 0 || len >= IFNAMSIZ) return 0;
    for (size_t i = 0; i < len; ++i) {
        char c = name[i];
        if ((c < 'a' || c > 'z') && (c < 'A' || c > 'Z') &&
            (c < '0' || c > '9') && c != '_' && c != '-') return 0;
    }
    return 1;
}

static void usage(const char *program) {
    fprintf(stderr,
            "usage: %s --device-id ID --socket PATH --ifname NAME [--parent-pid PID]\n",
            program);
}

int main(int argc, char **argv) {
    const char *device_id = NULL;
    const char *socket_path = NULL;
    const char *ifname = NULL;
    pid_t parent_pid = 0;
    char generated_ifname[IFNAMSIZ] = {0};

    if (argc < 7 || argc % 2 != 1) {
        usage(argv[0]);
        return 2;
    }
    for (int i = 1; i + 1 < argc; i += 2) {
        if (strcmp(argv[i], "--device-id") == 0) {
            device_id = argv[i + 1];
        } else if (strcmp(argv[i], "--socket") == 0) {
            socket_path = argv[i + 1];
        } else if (strcmp(argv[i], "--ifname") == 0) {
            ifname = argv[i + 1];
        } else if (strcmp(argv[i], "--bus-number") == 0) {
            char *end = NULL;
            errno = 0;
            unsigned long number = strtoul(argv[i + 1], &end, 10);
            if (errno != 0 || end == argv[i + 1] || *end != '\0' ||
                number > 9999UL) {
                fprintf(stderr, "invalid Ethernet bus number\n");
                return 2;
            }
            (void)snprintf(generated_ifname, sizeof(generated_ifname),
                           "vds%lu", number);
        } else if (strcmp(argv[i], "--parent-pid") == 0) {
            char *end = NULL;
            errno = 0;
            long number = strtol(argv[i + 1], &end, 10);
            if (errno != 0 || end == argv[i + 1] || *end != '\0' ||
                number < 0 || number > 2147483647L) {
                fprintf(stderr, "invalid parent PID\n");
                return 2;
            }
            parent_pid = (pid_t)number;
        } else {
            usage(argv[0]);
            return 2;
        }
    }
    if (ifname == NULL && generated_ifname[0] != '\0')
        ifname = generated_ifname;
    if (device_id == NULL || *device_id == '\0' ||
        socket_path == NULL || *socket_path == '\0' ||
        ifname == NULL || !valid_ifname(ifname)) {
        usage(argv[0]);
        return 2;
    }

    /* Connect to the authoritative runtime before creating a host endpoint. */
    vds_adapter_bridge_t bridge = { .fd = -1, .next_request_id = 1 };
    if (vds_adapter_bridge_connect(&bridge, socket_path) != VDS_OK) {
        fprintf(stderr, "could not connect to VDS4E Unix socket\n");
        return 1;
    }

    int tap = open("/dev/net/tun", O_RDWR | O_CLOEXEC);
    if (tap < 0) {
        perror("open /dev/net/tun");
        vds_adapter_bridge_close(&bridge);
        return 1;
    }
    if (if_nametoindex(ifname) != 0) {
        fprintf(stderr, "TAP interface '%s' already exists\n", ifname);
        (void)close(tap);
        vds_adapter_bridge_close(&bridge);
        return 1;
    }

    struct ifreq request;
    memset(&request, 0, sizeof(request));
    request.ifr_flags = IFF_TAP | IFF_NO_PI;
    (void)snprintf(request.ifr_name, sizeof(request.ifr_name), "%s", ifname);
    if (ioctl(tap, TUNSETIFF, &request) != 0) {
        perror("TUNSETIFF (CAP_NET_ADMIN required)");
        (void)close(tap);
        vds_adapter_bridge_close(&bridge);
        return 1;
    }

    (void)signal(SIGINT, stop);
    (void)signal(SIGTERM, stop);
    printf("%s\n", request.ifr_name);
    (void)fflush(stdout);

    while (running) {
        if (parent_pid > 1 && kill(parent_pid, 0) != 0 && errno == ESRCH) break;
        struct pollfd events = { .fd = tap, .events = POLLIN, .revents = 0 };
        int ready = poll(&events, 1, 1000);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) {
            perror("poll TAP");
            break;
        }
        if (ready == 0) continue;
        if ((events.revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
            fprintf(stderr, "TAP interface closed\n");
            break;
        }
        if ((events.revents & POLLIN) == 0) continue;

        uint8_t request_frame[VDS_ETHERNET_MAX_FRAME_SIZE];
        ssize_t size = read(tap, request_frame, sizeof(request_frame));
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) {
            if (size < 0) perror("read TAP");
            break;
        }
        if (size < 14) continue;

        uint8_t response_frame[VDS_ETHERNET_MAX_FRAME_SIZE];
        size_t response_length = 0;
        vds_error_t error = {0};
        vds_status_t result = vds_ethernet_exchange(
            &bridge, device_id, request_frame, (size_t)size,
            response_frame, sizeof(response_frame), &response_length, &error);
        if (result == VDS_ERR_SERVER) {
            fprintf(stderr, "Ethernet runtime rejected frame: %s\n", error.message);
            continue;
        }
        if (result != VDS_OK) {
            fprintf(stderr, "Ethernet data-plane exchange failed: %d\n", result);
            break;
        }
        if (response_length > 0 &&
            write_frame(tap, response_frame, response_length) != 0) {
            perror("write TAP");
            break;
        }
    }
    (void)close(tap); /* Drops the transient TAP network interface. */
    vds_adapter_bridge_close(&bridge);
    return 0;
}
