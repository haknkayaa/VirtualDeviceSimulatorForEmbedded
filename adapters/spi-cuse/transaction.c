#include "runtime.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

enum {
  VDS_ERROR_DEVICE_NOT_FOUND = 1,
  VDS_ERROR_UNKNOWN_OPCODE = 2,
  VDS_ERROR_INVALID_REQUEST = 3,
  VDS_ERROR_INTERNAL = 4,
  VDS_ERROR_REGISTER_UNKNOWN_ADDRESS = 5,
  VDS_ERROR_REGISTER_READ_NOT_ALLOWED = 6,
  VDS_ERROR_REGISTER_WRITE_NOT_ALLOWED = 7,
  VDS_ERROR_REGISTER_VALUE_OVERFLOW = 8,
  VDS_ERROR_DEVICE_BUSY = 9,
  VDS_ERROR_TIMING = 10,
  VDS_ERROR_STATE_INVALID_EVENT = 11,
  VDS_ERROR_STATE_GUARD_REJECTED = 12,
  VDS_ERROR_STATE_COMMAND_REJECTED = 13,
  VDS_ERROR_STATE_ACTION_FAILED = 14,
  VDS_ERROR_FAULT_TIMEOUT = 15,
  VDS_ERROR_FAULT_RETURN_ERROR = 16,
  VDS_ERROR_FAULT_DROPPED = 17,
  VDS_ERROR_FAULT_ACTION_FAILED = 18
};

static int errno_from_client_status(vds_status_t status,
                                    const vds_error_t *error) {
  if (status == VDS_ERR_ARGUMENT) {
    return EINVAL;
  }
  if (status == VDS_ERR_IO) {
    return EIO;
  }
  if (status == VDS_ERR_PROTOCOL) {
    return EPROTO;
  }
  if (status == VDS_ERR_BUFFER_TOO_SMALL) {
    return EMSGSIZE;
  }
  if (status != VDS_ERR_SERVER || error == NULL) {
    return EIO;
  }
  switch (error->code) {
  case VDS_ERROR_DEVICE_NOT_FOUND:
    return ENODEV;
  case VDS_ERROR_UNKNOWN_OPCODE:
    return EPROTO;
  case VDS_ERROR_INVALID_REQUEST:
  case VDS_ERROR_REGISTER_UNKNOWN_ADDRESS:
  case VDS_ERROR_STATE_INVALID_EVENT:
    return EINVAL;
  case VDS_ERROR_REGISTER_READ_NOT_ALLOWED:
  case VDS_ERROR_REGISTER_WRITE_NOT_ALLOWED:
  case VDS_ERROR_STATE_GUARD_REJECTED:
  case VDS_ERROR_STATE_COMMAND_REJECTED:
    return EACCES;
  case VDS_ERROR_REGISTER_VALUE_OVERFLOW:
    return ERANGE;
  case VDS_ERROR_DEVICE_BUSY:
    return EBUSY;
  case VDS_ERROR_FAULT_TIMEOUT:
    return ETIMEDOUT;
  case VDS_ERROR_INTERNAL:
  case VDS_ERROR_TIMING:
  case VDS_ERROR_STATE_ACTION_FAILED:
  case VDS_ERROR_FAULT_RETURN_ERROR:
  case VDS_ERROR_FAULT_DROPPED:
  case VDS_ERROR_FAULT_ACTION_FAILED:
  default:
    return EIO;
  }
}

static int ensure_connected(vds4e_spi_handle_t *handle) {
  if (handle->connected) {
    return 0;
  }
  const vds_status_t status =
      vds_adapter_bridge_connect(&handle->client, handle->config->socket_path);
  if (status != VDS_OK) {
    handle->client.fd = -1;
    handle->connected = false;
    return status == VDS_ERR_ARGUMENT ? EINVAL : ENOTCONN;
  }
  handle->connected = true;
  return 0;
}

static void map_response(const uint8_t *payload, size_t payload_length,
                         uint8_t *receive, size_t receive_length) {
  (void)memset(receive, 0, receive_length);
  if (payload_length == 0U) {
    return;
  }
  const size_t copy_length =
      payload_length < receive_length ? payload_length : receive_length;
  const size_t offset =
      payload_length < receive_length ? receive_length - copy_length : 0U;
  (void)memcpy(receive + offset, payload, copy_length);
}

static bool
unsupported_transfer_feature(const struct spi_ioc_transfer *transfer) {
  return transfer->delay_usecs != 0U || transfer->cs_change != 0U ||
         transfer->word_delay_usecs != 0U || transfer->pad != 0U;
}

static vds_spi_lane_width_t lane_width(uint8_t nbits) {
  if (nbits == 4U) {
    return VDS_SPI_LANE_QUAD;
  }
  if (nbits == 2U) {
    return VDS_SPI_LANE_DUAL;
  }
  return VDS_SPI_LANE_SINGLE;
}

int vds4e_spi_execute_transfer(vds4e_spi_handle_t *handle,
                               const struct spi_ioc_transfer *transfer,
                               const uint8_t *transmit, uint8_t *receive) {
  if (transfer->len > VDS4E_SPI_MAX_TRANSFER_SIZE) {
    return EMSGSIZE;
  }
  if (unsupported_transfer_feature(transfer)) {
    return ENOTSUP;
  }
  const uint8_t bits = transfer->bits_per_word == 0U ? handle->bits_per_word
                                                     : transfer->bits_per_word;
  if (bits != 8U) {
    return EINVAL;
  }
  if (transfer->len == 0U) {
    return 0;
  }

  uint8_t *zero_transmit = NULL;
  if (transmit == NULL) {
    zero_transmit = calloc(transfer->len, 1U);
    if (zero_transmit == NULL) {
      return ENOMEM;
    }
    transmit = zero_transmit;
  }
  uint8_t *payload = malloc(VDS4E_SPI_MAX_RESPONSE_SIZE);
  if (payload == NULL) {
    free(zero_transmit);
    return ENOMEM;
  }
  const int connect_error = ensure_connected(handle);
  if (connect_error != 0) {
    free(zero_transmit);
    free(payload);
    return connect_error;
  }

  size_t payload_length = 0U;
  vds_error_t error;
  const vds_spi_lane_width_t tx_width = lane_width(transfer->tx_nbits);
  const vds_spi_lane_width_t rx_width = lane_width(transfer->rx_nbits);
  const vds_spi_wire_config_t wire = {
      .mode = handle->mode,
      .bits_per_word = bits,
      .max_speed_hz = transfer->speed_hz == 0U ? handle->max_speed_hz
                                               : transfer->speed_hz,
      .command_width = tx_width,
      .address_width = tx_width,
      .data_width = transfer->rx_nbits == 0U ? tx_width : rx_width,
      .rate = VDS_SPI_RATE_STR,
      .dummy_cycles = 0U,
      .lsb_first = (handle->mode & SPI_LSB_FIRST) != 0U,
  };
  const vds_status_t status = vds_spi_transfer_configured(
      &handle->client, handle->config->device_id, transmit, transfer->len, 0U,
      &wire, payload, VDS4E_SPI_MAX_RESPONSE_SIZE, &payload_length, &error);
  free(zero_transmit);
  if (status != VDS_OK) {
    if (status == VDS_ERR_IO) {
      vds_adapter_bridge_close(&handle->client);
      handle->connected = false;
    }
    free(payload);
    return errno_from_client_status(status, &error);
  }
  if (receive != NULL) {
    map_response(payload, payload_length, receive, transfer->len);
  }
  free(payload);
  return 0;
}
