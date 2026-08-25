#ifndef VDS4E_GPIO_SIM_H
#define VDS4E_GPIO_SIM_H

#include "adapter_bridge.h"

#include <stdbool.h>
#include <stddef.h>

#define VDS4E_GPIO_SIM_DEFAULT_CONFIGFS_ROOT "/sys/kernel/config/gpio-sim"
#define VDS4E_GPIO_SIM_MAX_LINES 1024U

typedef struct {
  const char *name;
  const char *label;
  const char *device_id;
  const char *socket_path;
  const char *configfs_root;
  const char *sysfs_root;
  size_t line_count;
  const char *line_names[VDS4E_GPIO_SIM_MAX_LINES];
  size_t supplied_line_names;
} vds4e_gpio_config_t;

typedef struct {
  char device_dir[512];
  char bank_dir[544];
  char chip_name[128];
  char platform_name[128];
  char device_path[160];
  int chip_fd;
  bool created;
  bool live;
} vds4e_gpio_chip_t;

/* Returns 0 on success, 1 when help was printed, and -1 on invalid input. */
int vds4e_gpio_parse_options(int argc, char **argv,
                             vds4e_gpio_config_t *config);
int vds4e_gpio_chip_provision(const vds4e_gpio_config_t *config,
                              vds4e_gpio_chip_t *chip);
int vds4e_gpio_chip_destroy(const vds4e_gpio_config_t *config,
                            vds4e_gpio_chip_t *chip);
int vds4e_gpio_sync_run(const vds4e_gpio_config_t *config,
                        const vds4e_gpio_chip_t *chip,
                        vds_adapter_bridge_t *client);
int vds4e_gpio_read_attribute(const char *path, char *buffer, size_t capacity);
int vds4e_gpio_write_attribute(const char *path, const char *value);

#endif
