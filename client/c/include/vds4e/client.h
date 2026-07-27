#ifndef VDS4E_CLIENT_H
#define VDS4E_CLIENT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int fd;
    uint64_t next_request_id;
} vds_client_t;

typedef enum {
    VDS_OK = 0,
    VDS_ERR_ARGUMENT = -1,
    VDS_ERR_IO = -2,
    VDS_ERR_PROTOCOL = -3,
    VDS_ERR_SERVER = -4,
    VDS_ERR_BUFFER_TOO_SMALL = -5
} vds_status_t;

typedef struct {
    int code;
    char message[256];
} vds_error_t;

typedef enum {
    VDS_SPI_LANE_SINGLE = 1,
    VDS_SPI_LANE_DUAL = 2,
    VDS_SPI_LANE_QUAD = 4
} vds_spi_lane_width_t;

typedef enum {
    VDS_SPI_RATE_STR = 1,
    VDS_SPI_RATE_DTR = 2
} vds_spi_transfer_rate_t;

typedef struct {
    uint8_t mode;
    uint8_t bits_per_word;
    uint64_t max_speed_hz;
    vds_spi_lane_width_t command_width;
    vds_spi_lane_width_t address_width;
    vds_spi_lane_width_t data_width;
    vds_spi_transfer_rate_t rate;
    uint16_t dummy_cycles;
    uint8_t lsb_first;
} vds_spi_wire_config_t;

typedef struct {
    uint8_t read;
    const uint8_t *data;
    size_t length;
    uint16_t flags;
} vds_i2c_message_t;

vds_status_t vds_client_connect(vds_client_t *client, const char *socket_path);
void vds_client_close(vds_client_t *client);

vds_status_t vds_spi_transfer(vds_client_t *client,
                              const char *device_id,
                              const uint8_t *tx,
                              size_t tx_length,
                              uint8_t *rx,
                              size_t rx_capacity,
                              size_t *rx_length,
                              vds_error_t *error);

vds_status_t vds_spi_transfer_configured(vds_client_t *client,
                                         const char *device_id,
                                         const uint8_t *tx,
                                         size_t tx_length,
                                         size_t requested_rx_length,
                                         const vds_spi_wire_config_t *wire,
                                         uint8_t *rx,
                                         size_t rx_capacity,
                                         size_t *rx_length,
                                         vds_error_t *error);

vds_status_t vds_gpio_exchange(vds_client_t *client,
                               const char *device_id,
                               const uint8_t *host_values,
                               size_t line_count,
                               uint8_t *device_values,
                               size_t device_capacity,
                               size_t *device_count,
                               vds_error_t *error);

vds_status_t vds_i2c_transfer(vds_client_t *client,
                              const char *device_id,
                              uint16_t address,
                              const vds_i2c_message_t *messages,
                              size_t message_count,
                              uint8_t *read_data,
                              size_t read_capacity,
                              size_t *read_length,
                              vds_error_t *error);

#ifdef __cplusplus
}
#endif

#endif
