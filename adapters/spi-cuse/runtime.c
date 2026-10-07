#define _GNU_SOURCE

#include "adapter_bridge.h"
#include "runtime.h"
#include "spi_cuse.h"

#include <cuse_lowlevel.h>
#include <errno.h>
#include <linux/spi/spidev.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/uio.h>

#define VDS4E_MAX_DEVICE_NAME_LENGTH VDS4E_SPI_MAX_DEVICE_NAME_LENGTH
#define VDS4E_MAX_TRANSFER_SIZE VDS4E_SPI_MAX_TRANSFER_SIZE
static vds4e_spi_handle_t *request_handle(struct fuse_file_info *file_info) {
  return (vds4e_spi_handle_t *)(uintptr_t)file_info->fh;
}

static void spi_open(fuse_req_t request, struct fuse_file_info *file_info) {
  vds4e_spi_config_t *config = fuse_req_userdata(request);
  vds4e_spi_handle_t *handle = calloc(1U, sizeof(*handle));
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
  vds4e_spi_handle_t *handle = request_handle(file_info);
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
                                       vds4e_spi_handle_t *handle,
                                       const void *input,
                                       size_t input_size, size_t output_size) {
  uint8_t value8;
  uint32_t value32;
  switch (command) {
  case SPI_IOC_RD_MODE:
    reply_read_ioctl(request, argument, &handle->mode, sizeof(handle->mode),
                     output_size);
    return;
  case SPI_IOC_RD_MODE32:
    /* spidev_test and libraries use the 32-bit mode ioctls; the low byte is
     * the same value that SPI_IOC_RD_MODE reports. */
    value32 = handle->mode;
    reply_read_ioctl(request, argument, &value32, sizeof(value32),
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

  if (command == SPI_IOC_WR_MODE32) {
    if (!acquire_write_value(request, argument, input, input_size,
                             sizeof(value32))) {
      return;
    }
    (void)memcpy(&value32, input, sizeof(value32));
    /* Same contract as SPI_IOC_WR_MODE: only mode 0 without extra flags. */
    if (value32 != 0U) {
      fuse_reply_err(request, EINVAL);
    } else {
      handle->mode = 0U;
      fuse_reply_ioctl(request, 0, NULL, 0U);
    }
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
                                 void *argument, vds4e_spi_handle_t *handle,
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
  const int error =
      vds4e_spi_execute_transfer(handle, &transfer, transmit, receive);
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
  vds4e_spi_handle_t *handle = request_handle(file_info);
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

int vds4e_spi_cuse_serve(const char *program, vds4e_spi_config_t *config) {
  char device_info[VDS4E_MAX_DEVICE_NAME_LENGTH + sizeof("DEVNAME=")];
  const int written = snprintf(device_info, sizeof(device_info), "DEVNAME=%s",
                               config->device_name);
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
  char *cuse_arguments[] = {(char *)program, "-f", NULL};

  fprintf(stderr, "VDS4E CUSE: /dev/%s -> %s via %s\n", config->device_name,
          config->device_id, config->socket_path);
  return cuse_lowlevel_main(2, cuse_arguments, &info, &spi_operations, config);
}
