#include "runtime.h"

#include <errno.h>

static const vds4e_i2c_binding_t *
find_binding(const vds4e_i2c_config_t *config, uint16_t address) {
  for (size_t index = 0U; index < config->binding_count; ++index) {
    if (config->bindings[index].address == address) {
      return &config->bindings[index];
    }
  }
  return NULL;
}

static int ensure_connected(vds4e_i2c_handle_t *handle) {
  if (handle->connected) {
    return 0;
  }
  if (vds_adapter_bridge_connect(&handle->client, handle->config->socket_path) !=
      VDS_OK) {
    return ENOTCONN;
  }
  handle->connected = true;
  return 0;
}

static int status_errno(vds_status_t status, const vds_error_t *error) {
  if (status == VDS_OK) {
    return 0;
  }
  if (status == VDS_ERR_SERVER && error != NULL &&
      (error->code == 1 || error->code == 9)) {
    return ENXIO; /* Missing targets and EEPROM write-cycle NACKs. */
  }
  if (status == VDS_ERR_ARGUMENT) {
    return EINVAL;
  }
  if (status == VDS_ERR_BUFFER_TOO_SMALL) {
    return EMSGSIZE;
  }
  return EIO;
}

int vds4e_i2c_execute(vds4e_i2c_handle_t *handle, uint16_t address,
                      const vds_i2c_message_t *messages, size_t count,
                      uint8_t *reads, size_t capacity, size_t *read_length) {
  const vds4e_i2c_binding_t *binding = find_binding(handle->config, address);
  if (binding == NULL) {
    return ENXIO;
  }
  const int connection_error = ensure_connected(handle);
  if (connection_error != 0) {
    return connection_error;
  }
  vds_error_t error;
  const vds_status_t status =
      vds_i2c_transfer(&handle->client, binding->device_id, address, messages,
                       count, reads, capacity, read_length, &error);
  if (status == VDS_ERR_IO) {
    vds_adapter_bridge_close(&handle->client);
    handle->connected = false;
  }
  return status_errno(status, &error);
}
