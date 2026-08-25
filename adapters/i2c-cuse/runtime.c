#define _GNU_SOURCE

#include "adapter_bridge.h"
#include "i2c_cuse.h"
#include "runtime.h"

#include <cuse_lowlevel.h>
#include <errno.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/uio.h>

#define MAX_MESSAGES VDS4E_I2C_MAX_MESSAGES
#define MAX_TRANSFER VDS4E_I2C_MAX_TRANSFER

static vds4e_i2c_handle_t *get_handle(struct fuse_file_info *info) {
  return (vds4e_i2c_handle_t *)(uintptr_t)info->fh;
}

static void i2c_open(fuse_req_t request, struct fuse_file_info *info) {
  vds4e_i2c_handle_t *handle = calloc(1U, sizeof(*handle));
  if (handle == NULL || pthread_mutex_init(&handle->mutex, NULL) != 0) {
    free(handle);
    fuse_reply_err(request, ENOMEM);
    return;
  }
  handle->config = fuse_req_userdata(request);
  handle->client.fd = -1;
  handle->client.next_request_id = 1U;
  info->fh = (uint64_t)(uintptr_t)handle;
  info->direct_io = 1U;
  info->nonseekable = 1U;
  fuse_reply_open(request, info);
}

static void i2c_release(fuse_req_t request, struct fuse_file_info *info) {
  vds4e_i2c_handle_t *handle = get_handle(info);
  if (handle != NULL) {
    if (handle->connected)
      vds_adapter_bridge_close(&handle->client);
    pthread_mutex_destroy(&handle->mutex);
    free(handle);
  }
  fuse_reply_err(request, 0);
}

static void reply_pointer(fuse_req_t request, void *argument, const void *value,
                          size_t size, size_t output_size) {
  if (output_size < size) {
    const struct iovec output = {argument, size};
    fuse_reply_ioctl_retry(request, NULL, 0U, &output, 1U);
  } else {
    fuse_reply_ioctl(request, 0, value, size);
  }
}

static void handle_rdwr(fuse_req_t request, void *argument,
                        vds4e_i2c_handle_t *handle, const void *input,
                        size_t input_size, size_t output_size) {
  if (input_size < sizeof(struct i2c_rdwr_ioctl_data)) {
    const struct iovec vector = {argument, sizeof(struct i2c_rdwr_ioctl_data)};
    fuse_reply_ioctl_retry(request, &vector, 1U, NULL, 0U);
    return;
  }
  struct i2c_rdwr_ioctl_data data;
  memcpy(&data, input, sizeof(data));
  if (data.nmsgs == 0U || data.nmsgs > MAX_MESSAGES) {
    fuse_reply_err(request, EINVAL);
    return;
  }
  const size_t headers_size = data.nmsgs * sizeof(struct i2c_msg);
  if (input_size < sizeof(data) + headers_size) {
    const struct iovec vectors[2] = {{argument, sizeof(data)},
                                     {data.msgs, headers_size}};
    fuse_reply_ioctl_retry(request, vectors, 2U, NULL, 0U);
    return;
  }
  struct i2c_msg headers[MAX_MESSAGES];
  memcpy(headers, (const uint8_t *)input + sizeof(data), headers_size);
  size_t required_input = sizeof(data) + headers_size;
  size_t required_output = 0U;
  struct iovec inputs[MAX_MESSAGES + 2U];
  struct iovec outputs[MAX_MESSAGES];
  inputs[0] = (struct iovec){argument, sizeof(data)};
  inputs[1] = (struct iovec){data.msgs, headers_size};
  size_t input_count = 2U;
  size_t output_count = 0U;
  uint16_t address = headers[0].addr;
  for (size_t index = 0U; index < data.nmsgs; ++index) {
    if (headers[index].addr != address || headers[index].len > MAX_TRANSFER ||
        (headers[index].flags & ~(I2C_M_RD | I2C_M_TEN)) != 0U) {
      fuse_reply_err(request, ENOTSUP);
      return;
    }
    if ((headers[index].flags & I2C_M_RD) != 0U) {
      outputs[output_count++] =
          (struct iovec){headers[index].buf, headers[index].len};
      required_output += headers[index].len;
    } else {
      inputs[input_count++] =
          (struct iovec){headers[index].buf, headers[index].len};
      required_input += headers[index].len;
    }
  }
  if (input_size < required_input || output_size < required_output) {
    fuse_reply_ioctl_retry(request, inputs, input_count, outputs, output_count);
    return;
  }
  vds_i2c_message_t messages[MAX_MESSAGES];
  size_t offset = sizeof(data) + headers_size;
  for (size_t index = 0U; index < data.nmsgs; ++index) {
    const bool read = (headers[index].flags & I2C_M_RD) != 0U;
    messages[index] = (vds_i2c_message_t){
        .read = read ? 1U : 0U,
        .data = read ? NULL : (const uint8_t *)input + offset,
        .length = headers[index].len,
        .flags = headers[index].flags,
    };
    if (!read)
      offset += headers[index].len;
  }
  uint8_t *reads = malloc(required_output == 0U ? 1U : required_output);
  if (reads == NULL) {
    fuse_reply_err(request, ENOMEM);
    return;
  }
  size_t read_length = 0U;
  const int error = vds4e_i2c_execute(handle, address, messages, data.nmsgs,
                                      reads, required_output, &read_length);
  if (error != 0) {
    free(reads);
    fuse_reply_err(request, error);
    return;
  }
  fuse_reply_ioctl(request, (int)data.nmsgs, reads, read_length);
  free(reads);
}

static int smbus_messages(const struct i2c_smbus_ioctl_data *request,
                          const union i2c_smbus_data *data,
                          vds_i2c_message_t messages[2], uint8_t write[34],
                          size_t *count, size_t *read_length) {
  *count = 1U;
  *read_length = 0U;
  const bool read = request->read_write == I2C_SMBUS_READ;
  switch (request->size) {
  case I2C_SMBUS_QUICK:
    messages[0] = (vds_i2c_message_t){.read = 0U, .data = NULL, .length = 0U};
    return 0;
  case I2C_SMBUS_BYTE:
    if (read) {
      messages[0] = (vds_i2c_message_t){.read = 1U, .length = 1U};
      *read_length = 1U;
    } else {
      write[0] = request->command;
      messages[0] = (vds_i2c_message_t){.data = write, .length = 1U};
    }
    return 0;
  case I2C_SMBUS_BYTE_DATA:
  case I2C_SMBUS_WORD_DATA:
    write[0] = request->command;
    if (read) {
      messages[0] = (vds_i2c_message_t){.data = write, .length = 1U};
      *read_length = request->size == I2C_SMBUS_WORD_DATA ? 2U : 1U;
      messages[1] = (vds_i2c_message_t){.read = 1U, .length = *read_length};
      *count = 2U;
    } else {
      write[1] = data->byte;
      size_t length = 2U;
      if (request->size == I2C_SMBUS_WORD_DATA) {
        write[1] = (uint8_t)data->word;
        write[2] = (uint8_t)(data->word >> 8U);
        length = 3U;
      }
      messages[0] = (vds_i2c_message_t){.data = write, .length = length};
    }
    return 0;
  case I2C_SMBUS_I2C_BLOCK_DATA:
    write[0] = request->command;
    if (read) {
      const size_t length = data->block[0];
      if (length == 0U || length > I2C_SMBUS_BLOCK_MAX)
        return EINVAL;
      messages[0] = (vds_i2c_message_t){.data = write, .length = 1U};
      messages[1] = (vds_i2c_message_t){.read = 1U, .length = length};
      *count = 2U;
      *read_length = length;
    } else {
      const size_t length = data->block[0];
      if (length > I2C_SMBUS_BLOCK_MAX)
        return EINVAL;
      memcpy(write + 1U, data->block + 1U, length);
      messages[0] = (vds_i2c_message_t){.data = write, .length = length + 1U};
    }
    return 0;
  default:
    return ENOTSUP;
  }
}

static void handle_smbus(fuse_req_t request, void *argument,
                         vds4e_i2c_handle_t *handle, const void *input,
                         size_t input_size, size_t output_size) {
  if (!handle->address_selected) {
    fuse_reply_err(request, EDESTADDRREQ);
    return;
  }
  if (input_size < sizeof(struct i2c_smbus_ioctl_data)) {
    const struct iovec vector = {argument, sizeof(struct i2c_smbus_ioctl_data)};
    fuse_reply_ioctl_retry(request, &vector, 1U, NULL, 0U);
    return;
  }
  struct i2c_smbus_ioctl_data operation;
  memcpy(&operation, input, sizeof(operation));
  const bool needs_data = operation.size != I2C_SMBUS_QUICK;
  const bool reads = operation.read_write == I2C_SMBUS_READ;
  if (needs_data &&
      (input_size < sizeof(operation) + sizeof(union i2c_smbus_data) ||
       (reads && output_size < sizeof(union i2c_smbus_data)))) {
    const struct iovec inputs[2] = {
        {argument, sizeof(operation)},
        {operation.data, sizeof(union i2c_smbus_data)}};
    const struct iovec output = {operation.data, sizeof(union i2c_smbus_data)};
    fuse_reply_ioctl_retry(request, inputs, 2U, reads ? &output : NULL,
                           reads ? 1U : 0U);
    return;
  }
  union i2c_smbus_data data;
  memset(&data, 0, sizeof(data));
  if (needs_data) {
    memcpy(&data, (const uint8_t *)input + sizeof(operation), sizeof(data));
  }
  vds_i2c_message_t messages[2];
  uint8_t write[34];
  size_t count = 0U;
  size_t expected_read = 0U;
  int error = smbus_messages(&operation, &data, messages, write, &count,
                             &expected_read);
  uint8_t read_data[34];
  size_t actual_read = 0U;
  if (error == 0) {
    error = vds4e_i2c_execute(handle, handle->address, messages, count,
                              read_data, sizeof(read_data), &actual_read);
  }
  if (error != 0) {
    fuse_reply_err(request, error);
    return;
  }
  if (reads) {
    if (actual_read != expected_read) {
      fuse_reply_err(request, EPROTO);
      return;
    }
    if (operation.size == I2C_SMBUS_WORD_DATA) {
      data.word = (uint16_t)read_data[0] | ((uint16_t)read_data[1] << 8U);
    } else if (operation.size == I2C_SMBUS_I2C_BLOCK_DATA) {
      data.block[0] = (uint8_t)actual_read;
      memcpy(data.block + 1U, read_data, actual_read);
    } else {
      data.byte = read_data[0];
    }
    fuse_reply_ioctl(request, 0, &data, sizeof(data));
  } else {
    fuse_reply_ioctl(request, 0, NULL, 0U);
  }
}

static void i2c_ioctl(fuse_req_t request, int command, void *argument,
                      struct fuse_file_info *info, unsigned int flags,
                      const void *input, size_t input_size,
                      size_t output_size) {
  if ((flags & FUSE_IOCTL_COMPAT) != 0U) {
    fuse_reply_err(request, ENOSYS);
    return;
  }
  vds4e_i2c_handle_t *handle = get_handle(info);
  if (handle == NULL || pthread_mutex_lock(&handle->mutex) != 0) {
    fuse_reply_err(request, EBADF);
    return;
  }
  switch (command) {
  case I2C_FUNCS: {
    const unsigned long functions =
        I2C_FUNC_I2C | I2C_FUNC_SMBUS_QUICK | I2C_FUNC_SMBUS_BYTE |
        I2C_FUNC_SMBUS_BYTE_DATA | I2C_FUNC_SMBUS_WORD_DATA |
        I2C_FUNC_SMBUS_I2C_BLOCK;
    reply_pointer(request, argument, &functions, sizeof(functions),
                  output_size);
    break;
  }
  case I2C_SLAVE:
  case I2C_SLAVE_FORCE: {
    const uintptr_t address = (uintptr_t)argument;
    if (address > (handle->ten_bit ? 0x3ffU : 0x7fU)) {
      fuse_reply_err(request, EINVAL);
    } else {
      handle->address = (uint16_t)address;
      handle->address_selected = true;
      fuse_reply_ioctl(request, 0, NULL, 0U);
    }
    break;
  }
  case I2C_TENBIT:
    handle->ten_bit = (uintptr_t)argument != 0U;
    fuse_reply_ioctl(request, 0, NULL, 0U);
    break;
  case I2C_RETRIES:
  case I2C_TIMEOUT:
    fuse_reply_ioctl(request, 0, NULL, 0U);
    break;
  case I2C_RDWR:
    handle_rdwr(request, argument, handle, input, input_size, output_size);
    break;
  case I2C_SMBUS:
    handle_smbus(request, argument, handle, input, input_size, output_size);
    break;
  default:
    fuse_reply_err(request, ENOTTY);
    break;
  }
  pthread_mutex_unlock(&handle->mutex);
}

static const struct cuse_lowlevel_ops operations = {
    .open = i2c_open, .release = i2c_release, .ioctl = i2c_ioctl};

int vds4e_i2c_cuse_serve(const char *program, vds4e_i2c_config_t *config) {
  char device_info[160];
  snprintf(device_info, sizeof(device_info), "DEVNAME=%s", config->device_name);
  const char *device_info_arguments[] = {device_info};
  struct cuse_info information;
  memset(&information, 0, sizeof(information));
  information.dev_major = 0U;
  information.dev_minor = 0U;
  information.dev_info_argc = 1U;
  information.dev_info_argv = device_info_arguments;
  information.flags = CUSE_UNRESTRICTED_IOCTL;
  char *fuse_arguments[] = {(char *)program, "-f"};
  return cuse_lowlevel_main(2, fuse_arguments, &information, &operations,
                            config);
}
