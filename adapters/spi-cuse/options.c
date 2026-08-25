#include "spi_cuse.h"

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
  if (!valid_component(name, VDS4E_SPI_MAX_DEVICE_NAME_LENGTH) ||
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

int vds4e_spi_parse_options(int argc, char **argv,
                            vds4e_spi_config_t *config) {
  (void)strcpy(config->device_name, VDS4E_SPI_DEFAULT_DEVICE_NAME);
  (void)strcpy(config->socket_path, VDS4E_SPI_DEFAULT_SOCKET);

  for (int index = 1; index < argc; ++index) {
    const char *argument = argv[index];
    if (strcmp(argument, "-h") == 0 || strcmp(argument, "--help") == 0) {
      fputs(usage, stdout);
      return 1;
    }
    if (strcmp(argument, "--name") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (!valid_spidev_name(value)) {
        fprintf(stderr,
                "invalid device name '%s'; expected spidev<bus>.<chip-select>\n",
                value);
        return -1;
      }
      (void)strcpy(config->device_name, value);
      continue;
    }
    if (strcmp(argument, "--device-id") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (!valid_component(value, VDS4E_SPI_MAX_DEVICE_ID_LENGTH)) {
        fprintf(stderr, "invalid VDS4E device ID '%s'\n", value);
        return -1;
      }
      (void)strcpy(config->device_id, value);
      continue;
    }
    if (strcmp(argument, "--socket") == 0 && index + 1 < argc) {
      const char *value = argv[++index];
      if (*value == '\0' || strlen(value) > VDS4E_SPI_MAX_SOCKET_PATH_LENGTH) {
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
