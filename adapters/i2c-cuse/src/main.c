#define _GNU_SOURCE

#include "vds4e/adapter_bridge.h"

#include <cuse_lowlevel.h>
#include <errno.h>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <unistd.h>

#define DEFAULT_SOCKET "/tmp/vds4e.sock"
#define DEFAULT_NAME "i2c-0"
#define MAX_BINDINGS 128U
#define MAX_MESSAGES 42U
#define MAX_TRANSFER 4096U

typedef struct {
  uint16_t address;
  char device_id[128];
} binding_t;

typedef struct {
  char device_name[128];
  char socket_path[4096];
  pid_t parent_pid;
  binding_t bindings[MAX_BINDINGS];
  size_t binding_count;
} daemon_config_t;

typedef struct {
  pthread_mutex_t mutex;
  daemon_config_t *config;
  vds_adapter_bridge_t client;
  bool connected;
  uint16_t address;
  bool address_selected;
  bool ten_bit;
} i2c_handle_t;

static const char *usage =
    "Usage: vds4e-i2c-cuse [options]\n"
    "  --name i2c-N              Device name (default i2c-0)\n"
    "  --binding ADDR=DEVICE_ID  Repeatable address mapping\n"
    "  --socket PATH             VDS4E socket\n"
    "  --parent-pid PID          Exit with owning server\n";

static bool valid_name(const char *name) {
  if (name == NULL || strncmp(name, "i2c-", 4U) != 0 || name[4] == '\0') {
    return false;
  }
  for (const char *cursor = name + 4U; *cursor != '\0'; ++cursor) {
    if (*cursor < '0' || *cursor > '9') {
      return false;
    }
  }
  return true;
}

static bool valid_id(const char *id) {
  if (id == NULL || *id == '\0' || strlen(id) >= 128U) {
    return false;
  }
  for (; *id != '\0'; ++id) {
    if (!((*id >= 'a' && *id <= 'z') || (*id >= 'A' && *id <= 'Z') ||
          (*id >= '0' && *id <= '9') || *id == '-' || *id == '_' ||
          *id == '.')) {
      return false;
    }
  }
  return true;
}

static int add_binding(daemon_config_t *config, const char *value) {
  if (config->binding_count >= MAX_BINDINGS) {
    return -1;
  }
  const char *separator = strchr(value, '=');
  if (separator == NULL || separator == value || !valid_id(separator + 1)) {
    return -1;
  }
  char address_text[16];
  const size_t length = (size_t)(separator - value);
  if (length >= sizeof(address_text)) {
    return -1;
  }
  memcpy(address_text, value, length);
  address_text[length] = '\0';
  char *end = NULL;
  errno = 0;
  const unsigned long address = strtoul(address_text, &end, 0);
  if (errno != 0 || end == NULL || *end != '\0' || address > 0x3ffU) {
    return -1;
  }
  for (size_t index = 0U; index < config->binding_count; ++index) {
    if (config->bindings[index].address == address) {
      return -1;
    }
  }
  binding_t *binding = &config->bindings[config->binding_count++];
  binding->address = (uint16_t)address;
  strcpy(binding->device_id, separator + 1);
  return 0;
}

static int parse_arguments(int argc, char **argv, daemon_config_t *config) {
  strcpy(config->device_name, DEFAULT_NAME);
  strcpy(config->socket_path, DEFAULT_SOCKET);
  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "-h") == 0 || strcmp(argv[index], "--help") == 0) {
      fputs(usage, stdout);
      return 1;
    }
    if (strcmp(argv[index], "--name") == 0 && index + 1 < argc) {
      if (!valid_name(argv[++index])) {
        return -1;
      }
      strcpy(config->device_name, argv[index]);
    } else if (strcmp(argv[index], "--binding") == 0 && index + 1 < argc) {
      if (add_binding(config, argv[++index]) != 0) {
        return -1;
      }
    } else if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) {
      if (strlen(argv[++index]) >= sizeof(config->socket_path)) {
        return -1;
      }
      strcpy(config->socket_path, argv[index]);
    } else if (strcmp(argv[index], "--parent-pid") == 0 && index + 1 < argc) {
      char *end = NULL;
      const long value = strtol(argv[++index], &end, 10);
      if (end == NULL || *end != '\0' || value <= 0) {
        return -1;
      }
      config->parent_pid = (pid_t)value;
    } else {
      return -1;
    }
  }
  return config->binding_count == 0U ? -1 : 0;
}

static const binding_t *find_binding(const daemon_config_t *config,
                                     uint16_t address) {
  for (size_t index = 0U; index < config->binding_count; ++index) {
    if (config->bindings[index].address == address) {
      return &config->bindings[index];
    }
  }
  return NULL;
}

static int ensure_connected(i2c_handle_t *handle) {
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
  if (status == VDS_OK)
    return 0;
  if (status == VDS_ERR_SERVER && error != NULL &&
      (error->code == 1 || error->code == 9))
    return ENXIO; /* Missing targets and EEPROM write-cycle NACKs. */
  if (status == VDS_ERR_ARGUMENT)
    return EINVAL;
  if (status == VDS_ERR_BUFFER_TOO_SMALL)
    return EMSGSIZE;
  return EIO;
}

static int execute(i2c_handle_t *handle, uint16_t address,
                   const vds_i2c_message_t *messages, size_t count,
                   uint8_t *reads, size_t capacity, size_t *read_length) {
  const binding_t *binding = find_binding(handle->config, address);
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

static i2c_handle_t *get_handle(struct fuse_file_info *info) {
  return (i2c_handle_t *)(uintptr_t)info->fh;
}

static void i2c_open(fuse_req_t request, struct fuse_file_info *info) {
  i2c_handle_t *handle = calloc(1U, sizeof(*handle));
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
  i2c_handle_t *handle = get_handle(info);
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
                        i2c_handle_t *handle, const void *input,
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
  const int error = execute(handle, address, messages, data.nmsgs, reads,
                            required_output, &read_length);
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
                         i2c_handle_t *handle, const void *input,
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
    error = execute(handle, handle->address, messages, count, read_data,
                    sizeof(read_data), &actual_read);
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
  i2c_handle_t *handle = get_handle(info);
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

static void *watch_parent(void *argument) {
  const pid_t pid = *(const pid_t *)argument;
  while (kill(pid, 0) == 0 || errno == EPERM)
    sleep(1U);
  if (errno == ESRCH)
    kill(getpid(), SIGTERM);
  return NULL;
}

static void *make_device_accessible(void *argument) {
  const daemon_config_t *config = argument;
  char path[sizeof(config->device_name) + sizeof("/dev/")];
  const int written =
      snprintf(path, sizeof(path), "/dev/%s", config->device_name);
  if (written < 0 || (size_t)written >= sizeof(path))
    return NULL;
  uid_t owner = getuid();
  gid_t group = getgid();
  if (config->parent_pid > 0) {
    char parent_path[64];
    const int parent_written = snprintf(parent_path, sizeof(parent_path),
                                        "/proc/%ld", (long)config->parent_pid);
    struct stat parent_status;
    if (parent_written > 0 && (size_t)parent_written < sizeof(parent_path) &&
        stat(parent_path, &parent_status) == 0) {
      owner = parent_status.st_uid;
      group = parent_status.st_gid;
    }
  }

  for (unsigned int attempt = 0; attempt < 12000U; ++attempt) {
    if (chown(path, owner, group) == 0 && chmod(path, 0660) == 0)
      return NULL;
    if (errno != ENOENT)
      return NULL;
    usleep(10000U);
  }
  return NULL;
}

static const struct cuse_lowlevel_ops operations = {
    .open = i2c_open, .release = i2c_release, .ioctl = i2c_ioctl};

int main(int argc, char **argv) {
  daemon_config_t config;
  memset(&config, 0, sizeof(config));
  const int parsed = parse_arguments(argc, argv, &config);
  if (parsed != 0) {
    if (parsed < 0)
      fputs(usage, stderr);
    return parsed > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (config.parent_pid > 0) {
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 ||
        getppid() != config.parent_pid) {
      return EXIT_FAILURE;
    }
    pthread_t watcher;
    if (pthread_create(&watcher, NULL, watch_parent, &config.parent_pid) != 0) {
      return EXIT_FAILURE;
    }
    pthread_detach(watcher);
  }
  pthread_t permissions;
  if (pthread_create(&permissions, NULL, make_device_accessible, &config) !=
      0) {
    return EXIT_FAILURE;
  }
  pthread_detach(permissions);
  char device_info[160];
  snprintf(device_info, sizeof(device_info), "DEVNAME=%s", config.device_name);
  const char *device_info_arguments[] = {device_info};
  struct cuse_info information;
  memset(&information, 0, sizeof(information));
  information.dev_major = 0U;
  information.dev_minor = 0U;
  information.dev_info_argc = 1U;
  information.dev_info_argv = device_info_arguments;
  information.flags = CUSE_UNRESTRICTED_IOCTL;
  char *fuse_arguments[] = {argv[0], "-f"};
  return cuse_lowlevel_main(2, fuse_arguments, &information, &operations,
                            &config);
}
