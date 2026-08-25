#ifndef VDS4E_I2C_RUNTIME_H
#define VDS4E_I2C_RUNTIME_H

#include "adapter_bridge.h"
#include "i2c_cuse.h"

#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

typedef struct {
  pthread_mutex_t mutex;
  vds4e_i2c_config_t *config;
  vds_adapter_bridge_t client;
  bool connected;
  uint16_t address;
  bool address_selected;
  bool ten_bit;
} vds4e_i2c_handle_t;

int vds4e_i2c_execute(vds4e_i2c_handle_t *handle, uint16_t address,
                      const vds_i2c_message_t *messages, size_t count,
                      uint8_t *reads, size_t capacity, size_t *read_length);

#endif
