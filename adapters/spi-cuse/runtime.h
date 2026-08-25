#ifndef VDS4E_SPI_RUNTIME_H
#define VDS4E_SPI_RUNTIME_H

#include "adapter_bridge.h"
#include "spi_cuse.h"

#include <linux/spi/spidev.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

typedef struct {
  pthread_mutex_t mutex;
  vds4e_spi_config_t *config;
  vds_adapter_bridge_t client;
  bool connected;
  uint8_t mode;
  uint8_t bits_per_word;
  uint8_t lsb_first;
  uint32_t max_speed_hz;
} vds4e_spi_handle_t;

int vds4e_spi_execute_transfer(vds4e_spi_handle_t *handle,
                               const struct spi_ioc_transfer *transfer,
                               const uint8_t *transmit, uint8_t *receive);

#endif
