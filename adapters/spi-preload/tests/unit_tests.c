#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <assert.h>
#include <errno.h>
#include <linux/spi/spidev.h>
#include <stdlib.h>
#include <string.h>

static void test_device_map(void) {
    char device_id[VDS4E_MAX_DEVICE_ID_LENGTH + 1U];
    assert(setenv("VDS4E_SPI_MAP",
                  "/dev/spidev0.0=flash-0;/dev/spidev0.1=adc-0",
                  1) == 0);
    vds_device_map_reset_for_tests();
    assert(vds_device_map_lookup(
               "/dev/spidev0.0", device_id, sizeof(device_id)) == 1);
    assert(strcmp(device_id, "flash-0") == 0);
    assert(vds_device_map_lookup(
               "/dev/spidev1.0", device_id, sizeof(device_id)) == 0);

    assert(setenv("VDS4E_SPI_MAP",
                  "/dev/spidev0.0=flash;/dev/spidev0.0=duplicate",
                  1) == 0);
    vds_device_map_reset_for_tests();
    assert(vds_device_map_lookup(
               "/dev/spidev0.0", device_id, sizeof(device_id)) == -1);
    assert(errno == EINVAL);

    assert(setenv("VDS4E_SPI_MAP", "/dev/spidev0.0=", 1) == 0);
    vds_device_map_reset_for_tests();
    assert(vds_device_map_lookup(
               "/dev/spidev0.0", device_id, sizeof(device_id)) == -1);

    assert(setenv("VDS4E_SPI_MAP", "/tmp/not-spidev=device", 1) == 0);
    vds_device_map_reset_for_tests();
    assert(vds_device_map_lookup(
               "/tmp/not-spidev", device_id, sizeof(device_id)) == -1);
    assert(unsetenv("VDS4E_SPI_MAP") == 0);
    vds_device_map_reset_for_tests();
}

static void test_fd_table(void) {
    vds_spi_state_t *state = vds_spi_state_create("flash-0");
    assert(state != NULL);
    assert(vds_fd_table_insert(101, state) == 0);
    vds_spi_state_t *acquired = vds_fd_table_acquire(101);
    assert(acquired == state);
    vds_spi_state_release(acquired);
    assert(vds_fd_table_copy(101, 102) == 0);

    vds_spi_state_t *removed = vds_fd_table_remove(101);
    assert(removed == state);
    vds_spi_state_release(removed);
    acquired = vds_fd_table_acquire(102);
    assert(acquired == state);
    vds_spi_state_release(acquired);
    removed = vds_fd_table_remove(102);
    assert(removed == state);
    vds_spi_state_release(removed);
    vds_spi_state_release(state);
}

static void test_response_mapping(void) {
    const uint8_t payload[] = {0xEFU, 0x40U, 0x18U};
    uint8_t receive[4];
    vds_map_response(payload, sizeof(payload), receive, sizeof(receive));
    const uint8_t padded[] = {0x00U, 0xEFU, 0x40U, 0x18U};
    assert(memcmp(receive, padded, sizeof(padded)) == 0);

    const uint8_t long_payload[] = {1U, 2U, 3U, 4U, 5U};
    uint8_t truncated[3];
    vds_map_response(
        long_payload, sizeof(long_payload), truncated, sizeof(truncated));
    const uint8_t expected[] = {1U, 2U, 3U};
    assert(memcmp(truncated, expected, sizeof(expected)) == 0);
}

static void test_errno_mapping(void) {
    vds_error_t error = {0};
    assert(vds_errno_from_client_status(VDS_ERR_ARGUMENT, &error) == EINVAL);
    assert(vds_errno_from_client_status(VDS_ERR_PROTOCOL, &error) == EPROTO);
    assert(vds_errno_from_client_status(
               VDS_ERR_BUFFER_TOO_SMALL, &error) == EMSGSIZE);
    error.code = 1;
    assert(vds_errno_from_client_status(VDS_ERR_SERVER, &error) == ENODEV);
    error.code = 9;
    assert(vds_errno_from_client_status(VDS_ERR_SERVER, &error) == EBUSY);
    error.code = 15;
    assert(vds_errno_from_client_status(VDS_ERR_SERVER, &error) ==
           ETIMEDOUT);
}

static void test_configuration_ioctls(void) {
    vds_spi_state_t *state = vds_spi_state_create("flash-0");
    assert(state != NULL);
    uint8_t mode = 0xFFU;
    assert(vds_spi_ioctl(
               state, SPI_IOC_RD_MODE, (unsigned long)(uintptr_t)&mode) == 0);
    assert(mode == 0U);
    uint8_t bits = 0U;
    assert(vds_spi_ioctl(state,
                         SPI_IOC_WR_BITS_PER_WORD,
                         (unsigned long)(uintptr_t)&bits) == 0);
    bits = 0U;
    assert(vds_spi_ioctl(state,
                         SPI_IOC_RD_BITS_PER_WORD,
                         (unsigned long)(uintptr_t)&bits) == 0);
    assert(bits == 8U);
    bits = 16U;
    assert(vds_spi_ioctl(state,
                         SPI_IOC_WR_BITS_PER_WORD,
                         (unsigned long)(uintptr_t)&bits) == -1);
    assert(errno == EINVAL);
    assert(vds_spi_ioctl(state, SPI_IOC_RD_MODE, 1U) == -1);
    assert(errno == EFAULT);
    vds_spi_state_release(state);
}

int main(void) {
    test_device_map();
    test_fd_table();
    test_response_mapping();
    test_errno_mapping();
    test_configuration_ioctls();
    return 0;
}
