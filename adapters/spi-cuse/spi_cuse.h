#ifndef VDS4E_SPI_CUSE_H
#define VDS4E_SPI_CUSE_H

#include <sys/types.h>

#define VDS4E_SPI_DEFAULT_SOCKET "/tmp/vds4e.sock"
#define VDS4E_SPI_DEFAULT_DEVICE_NAME "spidev0.0"
#define VDS4E_SPI_MAX_DEVICE_NAME_LENGTH 127U
#define VDS4E_SPI_MAX_DEVICE_ID_LENGTH 127U
#define VDS4E_SPI_MAX_SOCKET_PATH_LENGTH 4095U
#define VDS4E_SPI_MAX_TRANSFER_SIZE 3900U
#define VDS4E_SPI_MAX_RESPONSE_SIZE (1024U * 1024U)

typedef struct {
  char device_name[VDS4E_SPI_MAX_DEVICE_NAME_LENGTH + 1U];
  char device_id[VDS4E_SPI_MAX_DEVICE_ID_LENGTH + 1U];
  char socket_path[VDS4E_SPI_MAX_SOCKET_PATH_LENGTH + 1U];
  pid_t parent_pid;
} vds4e_spi_config_t;

/* Returns 0 on success, 1 when help was printed, and -1 on invalid input. */
int vds4e_spi_parse_options(int argc, char **argv,
                            vds4e_spi_config_t *config);
int vds4e_spi_cuse_serve(const char *program, vds4e_spi_config_t *config);

#endif
