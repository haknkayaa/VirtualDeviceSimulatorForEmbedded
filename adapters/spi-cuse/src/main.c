#define _GNU_SOURCE

#include "vds4e/adapter_bridge.h"

#include <cuse_lowlevel.h>
#include <errno.h>
#include <linux/spi/spidev.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/uio.h>
#include <unistd.h>

#define VDS4E_DEFAULT_SOCKET "/tmp/vds4e.sock"
#define VDS4E_DEFAULT_DEVICE_NAME "spidev0.0"
#define VDS4E_MAX_DEVICE_NAME_LENGTH 127U
#define VDS4E_MAX_DEVICE_ID_LENGTH 127U
#define VDS4E_MAX_SOCKET_PATH_LENGTH 4095U
#define VDS4E_MAX_TRANSFER_SIZE 3900U
#define VDS4E_MAX_RESPONSE_SIZE (1024U * 1024U)

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

typedef struct {
  char device_name[VDS4E_MAX_DEVICE_NAME_LENGTH + 1U];
  char device_id[VDS4E_MAX_DEVICE_ID_LENGTH + 1U];
  char socket_path[VDS4E_MAX_SOCKET_PATH_LENGTH + 1U];
  pid_t parent_pid;
} daemon_config_t;

typedef struct {
  pthread_mutex_t mutex;
  daemon_config_t *config;
  vds_adapter_bridge_t client;
  bool connected;
  uint8_t mode;
  uint8_t bits_per_word;
  uint8_t lsb_first;
  uint32_t max_speed_hz;
} spi_handle_t;

static const char *usage =
    "Usage: vds4e-spi-cuse [options]\n"
    "\n"
    "Creates a real CUSE character device under /dev and forwards Linux\n"
    "spidev ioctl calls to a VDS4E runtime device.\n"
    "\n"
    "Options:\n"
    "  --name NAME       Character device name (default: spidev0.0)\n"
    "  --device-id ID    VDS4E runtime device ID (required)\n"
    "  --socket PATH     VDS4E Unix socket (default: /tmp/vds4e.sock)\n"
    "  --parent-pid PID  Exit when the owning VDS server exits\n"
    "  -h, --help        Show this help\n";

static bool valid_component(const char *value, size_t max_length) {
  if (value == NULL || *value == '\0') {
    return false;
  }
  const size_t length = strlen(value);
  if (length > max_length) {
    return false;
  }
  for (size_t index = 0U; index < length; ++index) {
    const char character = value[index];
    const bool valid = (character >= 'A' && character <= 'Z') ||
                       (character >= 'a' && character <= 'z') ||
                       (character >= '0' && character <= '9') ||
                       character == '.' || character == '_' || character == '-';
    if (!valid) {
      return false;
    }
  }
  return true;
}

static bool valid_spidev_name(const char *name) {
  if (!valid_component(name, VDS4E_MAX_DEVICE_NAME_LENGTH) ||
      strncmp(name, "spidev", 6U) != 0) {
    return false;
  }
  const char *cursor = name + 6U;
  if (*cursor < '0' || *cursor > '9') {
    return false;
  }
  while (*cursor >= '0' && *cursor <= '9') {
    ++cursor;
  }
  if (*cursor++ != '.') {
    return false;
  }
  if (*cursor < '0' || *cursor > '9') {
    return false;
  }
  while (*cursor >= '0' && *cursor <= '9') {
    ++cursor;
  }
  return *cursor == '\0';
}

static int parse_arguments(int argc, char **argv, daemon_config_t *config) {
  (void)strcpy(config->device_name, VDS4E_DEFAULT_DEVICE_NAME);
  (void)strcpy(config->socket_path, VDS4E_DEFAULT_SOCKET);

  for (int index = 1; index < argc; ++index) {
    const char *argument = argv[index];
    if (strcmp(argument, "-h") == 0 || strcmp(argument, "--help") == 0) {
      fputs(usage, stdout);
      return 1;
    }
    if (strcmp(argument, "--name") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (!valid_spidev_name(value)) {
        fprintf(
            stderr,
            "invalid device name '%s'; expected spidev<bus>.<chip-select>\n",
            value);
        return -1;
      }
      (void)strcpy(config->device_name, value);
      continue;
    }
    if (strcmp(argument, "--device-id") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (!valid_component(value, VDS4E_MAX_DEVICE_ID_LENGTH)) {
        fprintf(stderr, "invalid VDS4E device ID '%s'\n", value);
        return -1;
      }
      (void)strcpy(config->device_id, value);
      continue;
    }
    if (strcmp(argument, "--socket") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (*value == '\0' || strlen(value) > VDS4E_MAX_SOCKET_PATH_LENGTH) {
        fputs("invalid Unix socket path\n", stderr);
        return -1;
      }
      (void)strcpy(config->socket_path, value);
      continue;
    }
    if (strcmp(argument, "--parent-pid") == 0 && index + 1 < argc) {
      char *end = NULL;
      errno = 0;
      const long value = strtol(argv[++index], &end, 10);
      if (errno != 0 || end == NULL || *end != '\0' || value <= 0) {
        fputs("invalid parent PID\n", stderr);
        return -1;
      }
      config->parent_pid = (pid_t)value;
      continue;
    }
    fprintf(stderr, "unknown or incomplete option '%s'\n", argument);
    return -1;
  }

  if (config->device_id[0] == '\0') {
    fputs("--device-id is required\n", stderr);
    return -1;
  }
  return 0;
}

static void *watch_parent(void *argument) {
  const pid_t parent_pid = *(const pid_t *)argument;
  while (kill(parent_pid, 0) == 0 || errno == EPERM) {
    sleep(1U);
  }
  if (errno == ESRCH) {
    (void)kill(getpid(), SIGTERM);
  }
  return NULL;
}

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

static int ensure_connected(spi_handle_t *handle) {
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

static int execute_transfer(spi_handle_t *handle,
                            const struct spi_ioc_transfer *transfer,
                            const uint8_t *transmit, uint8_t *receive) {
  if (transfer->len > VDS4E_MAX_TRANSFER_SIZE) {
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
  uint8_t *payload = malloc(VDS4E_MAX_RESPONSE_SIZE);
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
      &wire, payload, VDS4E_MAX_RESPONSE_SIZE, &payload_length, &error);
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

static spi_handle_t *request_handle(struct fuse_file_info *file_info) {
  return (spi_handle_t *)(uintptr_t)file_info->fh;
}

static void spi_open(fuse_req_t request, struct fuse_file_info *file_info) {
  daemon_config_t *config = fuse_req_userdata(request);
  spi_handle_t *handle = calloc(1U, sizeof(*handle));
  if (handle == NULL) {
    fuse_reply_err(request, ENOMEM);
    return;
  }
  if (pthread_mutex_init(&handle->mutex, NULL) != 0) {
    free(handle);
    fuse_reply_err(request, EIO);
    return;
  }
  handle->config = config;
  handle->client.fd = -1;
  handle->client.next_request_id = 1U;
  handle->bits_per_word = 8U;
  handle->max_speed_hz = 1000000U;
  file_info->fh = (uint64_t)(uintptr_t)handle;
  file_info->direct_io = 1U;
  file_info->nonseekable = 1U;
  fuse_reply_open(request, file_info);
}

static void spi_release(fuse_req_t request, struct fuse_file_info *file_info) {
  spi_handle_t *handle = request_handle(file_info);
  if (handle != NULL) {
    if (handle->connected) {
      vds_adapter_bridge_close(&handle->client);
    }
    (void)pthread_mutex_destroy(&handle->mutex);
    free(handle);
    file_info->fh = 0U;
  }
  fuse_reply_err(request, 0);
}

static void reply_read_ioctl(fuse_req_t request, void *argument,
                             const void *value, size_t value_size,
                             size_t output_size) {
  if (output_size < value_size) {
    const struct iovec output = {argument, value_size};
    fuse_reply_ioctl_retry(request, NULL, 0U, &output, 1U);
    return;
  }
  fuse_reply_ioctl(request, 0, value, value_size);
}

static bool acquire_write_value(fuse_req_t request, void *argument,
                                const void *input, size_t input_size,
                                size_t value_size) {
  if (input_size >= value_size) {
    return true;
  }
  const struct iovec input_vector = {argument, value_size};
  fuse_reply_ioctl_retry(request, &input_vector, 1U, NULL, 0U);
  (void)input;
  return false;
}

static void reply_error_or_success(fuse_req_t request, int error) {
  if (error != 0) {
    fuse_reply_err(request, error);
  } else {
    fuse_reply_ioctl(request, 0, NULL, 0U);
  }
}

static void handle_configuration_ioctl(fuse_req_t request,
                                       unsigned long command, void *argument,
                                       spi_handle_t *handle, const void *input,
                                       size_t input_size, size_t output_size) {
  uint8_t value8;
  uint32_t value32;
  switch (command) {
  case SPI_IOC_RD_MODE:
    reply_read_ioctl(request, argument, &handle->mode, sizeof(handle->mode),
                     output_size);
    return;
  case SPI_IOC_RD_BITS_PER_WORD:
    reply_read_ioctl(request, argument, &handle->bits_per_word,
                     sizeof(handle->bits_per_word), output_size);
    return;
  case SPI_IOC_RD_MAX_SPEED_HZ:
    reply_read_ioctl(request, argument, &handle->max_speed_hz,
                     sizeof(handle->max_speed_hz), output_size);
    return;
  case SPI_IOC_RD_LSB_FIRST:
    reply_read_ioctl(request, argument, &handle->lsb_first,
                     sizeof(handle->lsb_first), output_size);
    return;
  default:
    break;
  }

  if (command == SPI_IOC_WR_MODE || command == SPI_IOC_WR_BITS_PER_WORD ||
      command == SPI_IOC_WR_LSB_FIRST) {
    if (!acquire_write_value(request, argument, input, input_size,
                             sizeof(value8))) {
      return;
    }
    (void)memcpy(&value8, input, sizeof(value8));
    int error = 0;
    if (command == SPI_IOC_WR_MODE) {
      if (value8 != 0U) {
        error = EINVAL;
      } else {
        handle->mode = value8;
      }
    } else if (command == SPI_IOC_WR_BITS_PER_WORD) {
      if (value8 != 0U && value8 != 8U) {
        error = EINVAL;
      } else {
        handle->bits_per_word = 8U;
      }
    } else if (value8 != 0U) {
      error = EINVAL;
    } else {
      handle->lsb_first = value8;
    }
    reply_error_or_success(request, error);
    return;
  }

  if (command == SPI_IOC_WR_MAX_SPEED_HZ) {
    if (!acquire_write_value(request, argument, input, input_size,
                             sizeof(value32))) {
      return;
    }
    (void)memcpy(&value32, input, sizeof(value32));
    if (value32 == 0U) {
      fuse_reply_err(request, EINVAL);
    } else {
      handle->max_speed_hz = value32;
      fuse_reply_ioctl(request, 0, NULL, 0U);
    }
    return;
  }
  fuse_reply_err(request, ENOTTY);
}

static bool is_message_command(unsigned long command) {
  return _IOC_TYPE(command) == SPI_IOC_MAGIC &&
         _IOC_NR(command) == _IOC_NR(SPI_IOC_MESSAGE(0)) &&
         _IOC_DIR(command) == _IOC_WRITE;
}

static void handle_message_ioctl(fuse_req_t request, unsigned long command,
                                 void *argument, spi_handle_t *handle,
                                 const void *input, size_t input_size,
                                 size_t output_size) {
  const size_t encoded_size = _IOC_SIZE(command);
  if (encoded_size % sizeof(struct spi_ioc_transfer) != 0U) {
    fuse_reply_err(request, EINVAL);
    return;
  }
  const size_t transfer_count = encoded_size / sizeof(struct spi_ioc_transfer);
  if (transfer_count == 0U) {
    fuse_reply_ioctl(request, 0, NULL, 0U);
    return;
  }
  if (transfer_count > 1U) {
    fuse_reply_err(request, ENOTSUP);
    return;
  }
  if (input_size < sizeof(struct spi_ioc_transfer)) {
    const struct iovec input_vector = {argument,
                                       sizeof(struct spi_ioc_transfer)};
    fuse_reply_ioctl_retry(request, &input_vector, 1U, NULL, 0U);
    return;
  }

  struct spi_ioc_transfer transfer;
  (void)memcpy(&transfer, input, sizeof(transfer));
  if (transfer.len > VDS4E_MAX_TRANSFER_SIZE) {
    fuse_reply_err(request, EMSGSIZE);
    return;
  }

  const bool needs_transmit = transfer.tx_buf != 0U && transfer.len > 0U;
  const bool needs_receive = transfer.rx_buf != 0U && transfer.len > 0U;
  const size_t required_input =
      sizeof(transfer) + (needs_transmit ? transfer.len : 0U);
  const size_t required_output = needs_receive ? transfer.len : 0U;
  if (input_size < required_input || output_size < required_output) {
    struct iovec inputs[2] = {
        {argument, sizeof(transfer)},
        {(void *)(uintptr_t)transfer.tx_buf, transfer.len},
    };
    const struct iovec output = {(void *)(uintptr_t)transfer.rx_buf,
                                 transfer.len};
    fuse_reply_ioctl_retry(request, inputs, needs_transmit ? 2U : 1U,
                           needs_receive ? &output : NULL,
                           needs_receive ? 1U : 0U);
    return;
  }

  const uint8_t *transmit =
      needs_transmit ? (const uint8_t *)input + sizeof(struct spi_ioc_transfer)
                     : NULL;
  uint8_t *receive = needs_receive ? malloc(transfer.len) : NULL;
  if (needs_receive && receive == NULL) {
    fuse_reply_err(request, ENOMEM);
    return;
  }
  const int error = execute_transfer(handle, &transfer, transmit, receive);
  if (error != 0) {
    free(receive);
    fuse_reply_err(request, error);
    return;
  }
  fuse_reply_ioctl(request, (int)transfer.len, receive,
                   needs_receive ? transfer.len : 0U);
  free(receive);
}

static void spi_ioctl(fuse_req_t request, int command, void *argument,
                      struct fuse_file_info *file_info, unsigned int flags,
                      const void *input, size_t input_size,
                      size_t output_size) {
  if ((flags & FUSE_IOCTL_COMPAT) != 0U) {
    fuse_reply_err(request, ENOSYS);
    return;
  }
  spi_handle_t *handle = request_handle(file_info);
  if (handle == NULL) {
    fuse_reply_err(request, EBADF);
    return;
  }
  if (pthread_mutex_lock(&handle->mutex) != 0) {
    fuse_reply_err(request, EIO);
    return;
  }
  const unsigned long unsigned_command = (unsigned int)command;
  if (is_message_command(unsigned_command)) {
    handle_message_ioctl(request, unsigned_command, argument, handle, input,
                         input_size, output_size);
  } else {
    handle_configuration_ioctl(request, unsigned_command, argument, handle,
                               input, input_size, output_size);
  }
  (void)pthread_mutex_unlock(&handle->mutex);
}

static void unsupported_read(fuse_req_t request, size_t size, off_t offset,
                             struct fuse_file_info *file_info) {
  (void)size;
  (void)offset;
  (void)file_info;
  fuse_reply_err(request, ENOTSUP);
}

static void unsupported_write(fuse_req_t request, const char *buffer,
                              size_t size, off_t offset,
                              struct fuse_file_info *file_info) {
  (void)buffer;
  (void)size;
  (void)offset;
  (void)file_info;
  fuse_reply_err(request, ENOTSUP);
}

static const struct cuse_lowlevel_ops spi_operations = {
    .open = spi_open,
    .read = unsupported_read,
    .write = unsupported_write,
    .release = spi_release,
    .ioctl = spi_ioctl,
};

int main(int argc, char **argv) {
  daemon_config_t config = {0};
  const int parse_result = parse_arguments(argc, argv, &config);
  if (parse_result != 0) {
    return parse_result > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0) {
    perror("failed to configure parent-death cleanup");
    return EXIT_FAILURE;
  }
  if (config.parent_pid > 0) {
    pthread_t watcher;
    const int watcher_result =
        pthread_create(&watcher, NULL, watch_parent, &config.parent_pid);
    if (watcher_result != 0) {
      errno = watcher_result;
      perror("failed to start parent watcher");
      return EXIT_FAILURE;
    }
    (void)pthread_detach(watcher);
  }

  char device_info[VDS4E_MAX_DEVICE_NAME_LENGTH + sizeof("DEVNAME=")];
  const int written = snprintf(device_info, sizeof(device_info), "DEVNAME=%s",
                               config.device_name);
  if (written < 0 || (size_t)written >= sizeof(device_info)) {
    fputs("device name is too long\n", stderr);
    return EXIT_FAILURE;
  }
  const char *device_info_arguments[] = {device_info};
  const struct cuse_info info = {
      .dev_major = 0U,
      .dev_minor = 0U,
      .dev_info_argc = 1U,
      .dev_info_argv = device_info_arguments,
      .flags = CUSE_UNRESTRICTED_IOCTL,
  };
  char *cuse_arguments[] = {argv[0], "-f", NULL};

  fprintf(stderr, "VDS4E CUSE: /dev/%s -> %s via %s\n", config.device_name,
          config.device_id, config.socket_path);
  return cuse_lowlevel_main(2, cuse_arguments, &info, &spi_operations, &config);
}
