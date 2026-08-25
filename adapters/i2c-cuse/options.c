#include "i2c_cuse.h"

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *usage =
    "Usage: vds4e-i2c-cuse [options]\n"
    "  --name i2c-N              Device name (default i2c-0)\n"
    "  --binding ADDR=DEVICE_ID  Repeatable address mapping\n"
    "  --socket PATH             VDS4E socket\n"
    "  --parent-pid PID          Exit with owning server\n";

void vds4e_i2c_print_usage(void) { fputs(usage, stderr); }

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

static int add_binding(vds4e_i2c_config_t *config, const char *value) {
  if (config->binding_count >= VDS4E_I2C_MAX_BINDINGS) {
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
  vds4e_i2c_binding_t *binding = &config->bindings[config->binding_count++];
  binding->address = (uint16_t)address;
  (void)strcpy(binding->device_id, separator + 1);
  return 0;
}

int vds4e_i2c_parse_options(int argc, char **argv,
                            vds4e_i2c_config_t *config) {
  (void)strcpy(config->device_name, VDS4E_I2C_DEFAULT_NAME);
  (void)strcpy(config->socket_path, VDS4E_I2C_DEFAULT_SOCKET);
  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "-h") == 0 || strcmp(argv[index], "--help") == 0) {
      fputs(usage, stdout);
      return 1;
    }
    if (strcmp(argv[index], "--name") == 0 && index + 1 < argc) {
      if (!valid_name(argv[++index])) {
        return -1;
      }
      (void)strcpy(config->device_name, argv[index]);
    } else if (strcmp(argv[index], "--binding") == 0 && index + 1 < argc) {
      if (add_binding(config, argv[++index]) != 0) {
        return -1;
      }
    } else if (strcmp(argv[index], "--socket") == 0 && index + 1 < argc) {
      if (strlen(argv[++index]) >= sizeof(config->socket_path)) {
        return -1;
      }
      (void)strcpy(config->socket_path, argv[index]);
    } else if (strcmp(argv[index], "--parent-pid") == 0 &&
               index + 1 < argc) {
      char *end = NULL;
      errno = 0;
      const long value = strtol(argv[++index], &end, 10);
      if (errno != 0 || end == NULL || *end != '\0' || value <= 0) {
        return -1;
      }
      config->parent_pid = (pid_t)value;
    } else {
      return -1;
    }
  }
  return config->binding_count == 0U ? -1 : 0;
}
