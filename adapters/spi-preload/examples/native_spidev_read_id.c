#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "/dev/spidev0.0";
    const int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) {
        fprintf(stderr, "open(%s): %s\n", path, strerror(errno));
        return 1;
    }

    uint8_t mode = SPI_MODE_0;
    uint8_t bits = 8U;
    uint32_t speed = 1000000U;
    if (ioctl(fd, SPI_IOC_WR_MODE, &mode) < 0 ||
        ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, &bits) < 0 ||
        ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed) < 0) {
        fprintf(stderr, "SPI configuration: %s\n", strerror(errno));
        (void)close(fd);
        return 1;
    }

    uint8_t tx[] = {0x9FU, 0x00U, 0x00U, 0x00U};
    uint8_t rx[sizeof(tx)] = {0U};
    struct spi_ioc_transfer transfer = {
        .tx_buf = (uintptr_t)tx,
        .rx_buf = (uintptr_t)rx,
        .len = sizeof(tx),
        .speed_hz = speed,
        .bits_per_word = bits,
    };
    const int transferred = ioctl(fd, SPI_IOC_MESSAGE(1), &transfer);
    if (transferred < 0) {
        fprintf(stderr, "SPI_IOC_MESSAGE: %s\n", strerror(errno));
        (void)close(fd);
        return 1;
    }
    (void)close(fd);

    printf("RX: %02X %02X %02X %02X\n", rx[0], rx[1], rx[2], rx[3]);
    const uint8_t expected[] = {0x00U, 0xEFU, 0x40U, 0x18U};
    if (transferred != (int)sizeof(tx) ||
        memcmp(rx, expected, sizeof(expected)) != 0) {
        fprintf(stderr, "unexpected READ_ID response\n");
        return 1;
    }
    return 0;
}
