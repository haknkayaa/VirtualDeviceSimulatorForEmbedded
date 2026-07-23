#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <stdint.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(void) {
    const int real_fd = open("/dev/null", O_RDONLY | O_CLOEXEC);
    assert(real_fd >= 0);
    assert(close(real_fd) == 0);
    int pipe_fds[2];
    assert(pipe(pipe_fds) == 0);
    const uint8_t marker = 0xA5U;
    assert(write(pipe_fds[1], &marker, sizeof(marker)) == (ssize_t)sizeof(marker));
    int available = 0;
    assert(ioctl(pipe_fds[0], FIONREAD, &available) == 0 && available == 1);
    assert(ioctl(pipe_fds[0], FIOCLEX) == 0);
    assert(close(pipe_fds[0]) == 0);
    assert(close(pipe_fds[1]) == 0);

    const int fd = open("/dev/spidev0.0", O_RDWR | O_CLOEXEC);
    assert(fd >= 0);
    uint8_t mode = 0U;
    uint8_t bits = 8U;
    uint8_t lsb = 0U;
    uint32_t speed = 4000000U;
    assert(ioctl(fd, SPI_IOC_WR_MODE, &mode) == 0);
    assert(ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, &bits) == 0);
    assert(ioctl(fd, SPI_IOC_WR_LSB_FIRST, &lsb) == 0);
    assert(ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed) == 0);
    mode = 0xFFU;
    bits = 0U;
    speed = 0U;
    assert(ioctl(fd, SPI_IOC_RD_MODE, &mode) == 0 && mode == 0U);
    assert(ioctl(fd, SPI_IOC_RD_BITS_PER_WORD, &bits) == 0 && bits == 8U);
    assert(ioctl(fd, SPI_IOC_RD_MAX_SPEED_HZ, &speed) == 0 &&
           speed == 4000000U);

    errno = 0;
    assert(ioctl(fd, 0x1234UL) == -1 && errno == ENOTTY);
    struct spi_ioc_transfer transfers[2] = {{0}, {0}};
    errno = 0;
    assert(ioctl(fd, SPI_IOC_MESSAGE(2), transfers) == -1 &&
           errno == ENOTSUP);

    const int duplicate = dup(fd);
    assert(duplicate >= 0);
    assert(close(fd) == 0);
    mode = 0xFFU;
    assert(ioctl(duplicate, SPI_IOC_RD_MODE, &mode) == 0 && mode == 0U);

    const int duplicate_fcntl = fcntl(duplicate, F_DUPFD_CLOEXEC, 20);
    assert(duplicate_fcntl >= 20);
    assert(close(duplicate) == 0);
    const int dup2_target = open("/dev/null", O_RDONLY | O_CLOEXEC);
    assert(dup2_target >= 0);
    assert(dup2(duplicate_fcntl, dup2_target) == dup2_target);
    assert(close(duplicate_fcntl) == 0);
    mode = 0xFFU;
    assert(ioctl(dup2_target, SPI_IOC_RD_MODE, &mode) == 0 && mode == 0U);

    const int dup3_target = open("/dev/null", O_RDONLY | O_CLOEXEC);
    assert(dup3_target >= 0);
    assert(dup3(dup2_target, dup3_target, O_CLOEXEC) == dup3_target);
    assert(close(dup2_target) == 0);
    mode = 0xFFU;
    assert(ioctl(dup3_target, SPI_IOC_RD_MODE, &mode) == 0 && mode == 0U);
    assert(close(dup3_target) == 0);
    return 0;
}
