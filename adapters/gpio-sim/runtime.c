#define _POSIX_C_SOURCE 200809L

#include "gpio_sim.h"

#include <errno.h>
#include <linux/gpio.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>

static volatile sig_atomic_t stop_requested;

static void handle_signal(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
}

static int synchronize_lines(const vds4e_gpio_config_t *config,
                             const vds4e_gpio_chip_t *chip,
                             vds_adapter_bridge_t *client,
                             uint8_t *applied_values) {
  uint8_t host_values[VDS4E_GPIO_SIM_MAX_LINES];
  uint8_t host_outputs[VDS4E_GPIO_SIM_MAX_LINES];
  uint8_t device_values[VDS4E_GPIO_SIM_MAX_LINES];
  char path[768];
  char value[16];
  size_t device_count = 0U;
  vds_error_t error;

  for (size_t index = 0U; index < config->line_count; ++index) {
    struct gpio_v2_line_info line_info;
    memset(&line_info, 0, sizeof(line_info));
    line_info.offset = (uint32_t)index;
    if (ioctl(chip->chip_fd, GPIO_V2_GET_LINEINFO_IOCTL, &line_info) != 0) {
      return -1;
    }
    host_outputs[index] =
        (line_info.flags & GPIO_V2_LINE_FLAG_OUTPUT) != 0U ? 1U : 0U;
    if (snprintf(path, sizeof(path), "%s/%s/%s/sim_gpio%zu/value",
                 config->sysfs_root, chip->platform_name, chip->chip_name,
                 index) >= (int)sizeof(path) ||
        vds4e_gpio_read_attribute(path, value, sizeof(value)) != 0) {
      return -1;
    }
    host_values[index] = strcmp(value, "1") == 0 ? 1U : 0U;
  }

  const vds_status_t status = vds_gpio_exchange(
      client, config->device_id, host_values, host_outputs, config->line_count,
      device_values, sizeof(device_values), &device_count, &error);
  if (status != VDS_OK || device_count != config->line_count) {
    if (status == VDS_ERR_SERVER) {
      fprintf(stderr, "GPIO runtime exchange failed: %s\n", error.message);
    }
    errno = EPROTO;
    return -1;
  }

  for (size_t index = 0U; index < config->line_count; ++index) {
    if (applied_values[index] == device_values[index]) {
      continue;
    }
    if (snprintf(path, sizeof(path), "%s/%s/%s/sim_gpio%zu/pull",
                 config->sysfs_root, chip->platform_name, chip->chip_name,
                 index) >= (int)sizeof(path) ||
        vds4e_gpio_write_attribute(
            path, device_values[index] != 0U ? "pull-up" : "pull-down") != 0) {
      return -1;
    }
    applied_values[index] = device_values[index];
  }
  return 0;
}

int vds4e_gpio_sync_run(const vds4e_gpio_config_t *config,
                        const vds4e_gpio_chip_t *chip,
                        vds_adapter_bridge_t *client) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = handle_signal;
  (void)sigemptyset(&action.sa_mask);
  (void)sigaction(SIGINT, &action, NULL);
  (void)sigaction(SIGTERM, &action, NULL);

  uint8_t applied_values[VDS4E_GPIO_SIM_MAX_LINES];
  memset(applied_values, 0xFF, sizeof(applied_values));
  stop_requested = 0;

  while (!stop_requested) {
    const struct timespec delay = {.tv_sec = 0, .tv_nsec = 10000000L};
    if (synchronize_lines(config, chip, client, applied_values) != 0) {
      fprintf(stderr, "GPIO line synchronization failed: %s\n",
              strerror(errno));
      return -1;
    }
    (void)nanosleep(&delay, NULL);
  }
  return 0;
}
