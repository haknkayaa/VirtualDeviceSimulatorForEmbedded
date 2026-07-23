#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static int transfer_once(const char *path, int null_tx, int null_rx) {
    const int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) {
        return -1;
    }
    uint8_t tx[] = {0x9FU, 0x00U, 0x00U, 0x00U};
    uint8_t rx[sizeof(tx)] = {0U};
    struct spi_ioc_transfer transfer = {
        .tx_buf = null_tx ? 0U : (uintptr_t)tx,
        .rx_buf = null_rx ? 0U : (uintptr_t)rx,
        .len = sizeof(tx),
        .bits_per_word = 8U,
    };
    const int result = ioctl(fd, SPI_IOC_MESSAGE(1), &transfer);
    const int saved_errno = errno;
    (void)close(fd);
    errno = saved_errno;
    if (result != (int)sizeof(tx)) {
        return -1;
    }
    if (!null_rx) {
        const uint8_t expected[] = {0x00U, 0xEFU, 0x40U, 0x18U};
        if (memcmp(rx, expected, sizeof(expected)) != 0) {
            errno = EPROTO;
            return -1;
        }
    }
    return 0;
}

typedef struct {
    const char *path;
    int result;
} thread_argument_t;

static void *thread_transfer(void *opaque) {
    thread_argument_t *argument = opaque;
    argument->result = transfer_once(argument->path, 0, 0);
    return NULL;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s DEVICE_PATH null-tx|null-rx|concurrent\n", argv[0]);
        return 2;
    }
    int result = -1;
    if (strcmp(argv[2], "null-tx") == 0) {
        result = transfer_once(argv[1], 1, 0);
    } else if (strcmp(argv[2], "null-rx") == 0) {
        result = transfer_once(argv[1], 0, 1);
    } else if (strcmp(argv[2], "concurrent") == 0) {
        thread_argument_t first = {.path = argv[1], .result = -1};
        thread_argument_t second = {.path = argv[1], .result = -1};
        pthread_t first_thread;
        pthread_t second_thread;
        if (pthread_create(&first_thread, NULL, thread_transfer, &first) != 0 ||
            pthread_create(&second_thread, NULL, thread_transfer, &second) != 0) {
            fprintf(stderr, "pthread_create failed\n");
            return 1;
        }
        (void)pthread_join(first_thread, NULL);
        (void)pthread_join(second_thread, NULL);
        result = first.result == 0 && second.result == 0 ? 0 : -1;
    }
    if (result != 0) {
        fprintf(stderr, "%s failed: %s\n", argv[2], strerror(errno));
        return 1;
    }
    return 0;
}
