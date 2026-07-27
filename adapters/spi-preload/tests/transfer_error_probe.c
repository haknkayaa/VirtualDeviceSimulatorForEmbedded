#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 3 && argc != 4) {
        fprintf(stderr,
                "usage: %s DEVICE_PATH EXPECTED_ERRNO [OPCODE]\n",
                argv[0]);
        return 2;
    }
    const int expected_errno = atoi(argv[2]);
    const unsigned long opcode = argc == 4 ? strtoul(argv[3], NULL, 0) : 0x9FU;
    if (opcode > UINT8_MAX) {
        fprintf(stderr, "opcode must fit in one byte\n");
        return 2;
    }
    const int fd = open(argv[1], O_RDWR | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "open: %s\n", strerror(errno));
        return 1;
    }
    uint8_t tx[] = {(uint8_t)opcode, 0x00U, 0x00U, 0x00U};
    uint8_t rx[sizeof(tx)] = {0U};
    struct spi_ioc_transfer transfer = {
        .tx_buf = (uintptr_t)tx,
        .rx_buf = (uintptr_t)rx,
        .len = sizeof(tx),
        .bits_per_word = 8U,
    };
    errno = 0;
    const int result = ioctl(fd, SPI_IOC_MESSAGE(1), &transfer);
    const int actual_errno = errno;
    (void)close(fd);
    if (result != -1 || actual_errno != expected_errno) {
        fprintf(stderr,
                "expected -1/%d, received %d/%d\n",
                expected_errno,
                result,
                actual_errno);
        return 1;
    }
    return 0;
}
