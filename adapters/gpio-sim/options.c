#include "gpio_sim.h"

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void usage(FILE *stream, const char *program) {
  fprintf(stream,
          "Usage: %s --name NAME --label LABEL --lines COUNT "
          "--device-id ID --socket PATH [--configfs-root PATH] "
          "[--sysfs-root PATH]\n",
          program);
}

static bool valid_name(const char *value) {
  size_t index;
  if (value == NULL || value[0] == '\0') {
    return false;
  }
  for (index = 0U; value[index] != '\0'; ++index) {
    const char character = value[index];
    const bool alpha_numeric =
        (character >= 'a' && character <= 'z') ||
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9');
    if (!alpha_numeric && character != '-' && character != '_') {
      return false;
    }
  }
  return index <= 64U;
}

int vds4e_gpio_parse_options(int argc, char **argv,
                             vds4e_gpio_config_t *config) {
  config->configfs_root = VDS4E_GPIO_SIM_DEFAULT_CONFIGFS_ROOT;
  config->sysfs_root = "/sys/devices/platform";

  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "--help") == 0) {
      usage(stdout, argv[0]);
      return 1;
    }
    if (index + 1 >= argc) {
      usage(stderr, argv[0]);
      return -1;
    }
    if (strcmp(argv[index], "--name") == 0) {
      config->name = argv[++index];
    } else if (strcmp(argv[index], "--label") == 0) {
      config->label = argv[++index];
    } else if (strcmp(argv[index], "--lines") == 0) {
      char *end = NULL;
      errno = 0;
      const unsigned long line_count = strtoul(argv[++index], &end, 10);
      if (errno != 0 || end == NULL || *end != '\0' ||
          line_count > VDS4E_GPIO_SIM_MAX_LINES) {
        config->line_count = 0U;
      } else {
        config->line_count = (size_t)line_count;
      }
    } else if (strcmp(argv[index], "--configfs-root") == 0) {
      config->configfs_root = argv[++index];
    } else if (strcmp(argv[index], "--sysfs-root") == 0) {
      config->sysfs_root = argv[++index];
    } else if (strcmp(argv[index], "--device-id") == 0) {
      config->device_id = argv[++index];
    } else if (strcmp(argv[index], "--socket") == 0) {
      config->socket_path = argv[++index];
    } else if (strcmp(argv[index], "--line-name") == 0) {
      if (config->supplied_line_names >= VDS4E_GPIO_SIM_MAX_LINES) {
        fputs("too many GPIO line names\n", stderr);
        return -1;
      }
      config->line_names[config->supplied_line_names++] = argv[++index];
    } else {
      usage(stderr, argv[0]);
      return -1;
    }
  }

  if (!valid_name(config->name) || config->label == NULL ||
      config->label[0] == '\0' || config->device_id == NULL ||
      config->device_id[0] == '\0' || config->socket_path == NULL ||
      config->socket_path[0] == '\0' || config->line_count == 0U) {
    fprintf(stderr,
            "name must be safe and line count must be between 1 and %u\n",
            VDS4E_GPIO_SIM_MAX_LINES);
    return -1;
  }
  if (config->supplied_line_names != 0U &&
      config->supplied_line_names != config->line_count) {
    fputs("line-name count must match --lines\n", stderr);
    return -1;
  }
  for (size_t line = 0U; line < config->supplied_line_names; ++line) {
    const size_t length = strlen(config->line_names[line]);
    if (length == 0U || length > 31U) {
      fputs("GPIO line names must contain 1-31 characters\n", stderr);
      return -1;
    }
  }
  return 0;
}
