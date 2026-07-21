#include "vds4e/client.h"

#include <stdint.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 2) {
        (void)fprintf(stderr, "usage: %s SOCKET_PATH\n", argv[0]);
        return 2;
    }

    vds_client_t client = {.fd = -1, .next_request_id = 1U};
    vds_status_t status = vds_client_connect(&client, argv[1]);
    if (status != VDS_OK) {
        (void)fprintf(stderr, "failed to connect: %d\n", status);
        return 1;
    }

    const uint8_t tx[] = {0x9FU};
    uint8_t rx[16];
    size_t rx_length = 0U;
    vds_error_t error;
    status = vds_spi_transfer(&client,
                              "spi-flash-0",
                              tx,
                              sizeof(tx),
                              rx,
                              sizeof(rx),
                              &rx_length,
                              &error);
    vds_client_close(&client);

    if (status != VDS_OK) {
        (void)fprintf(stderr,
                      "SPI transfer failed: status=%d code=%d message=%s\n",
                      status,
                      error.code,
                      error.message);
        return 1;
    }

    (void)printf("TX: 9F\nRX:");
    for (size_t index = 0U; index < rx_length; ++index) {
        (void)printf(" %02X", rx[index]);
    }
    (void)printf("\n");
    return 0;
}
