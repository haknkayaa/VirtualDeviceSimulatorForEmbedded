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

#ifdef __cplusplus
}
#endif

#endif

