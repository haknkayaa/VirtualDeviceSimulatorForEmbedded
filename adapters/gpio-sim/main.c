#include "gpio_sim.h"

#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  vds4e_gpio_config_t config = {0};
  const int parsed = vds4e_gpio_parse_options(argc, argv, &config);
  if (parsed != 0) {
    return parsed > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  }

  vds4e_gpio_chip_t chip = {.chip_fd = -1};
  int result = EXIT_FAILURE;
  if (vds4e_gpio_chip_provision(&config, &chip) != 0) {
    goto cleanup_chip;
  }

  vds_adapter_bridge_t client = {.fd = -1, .next_request_id = 1U};
  if (vds_adapter_bridge_connect(&client, config.socket_path) != VDS_OK) {
    fprintf(stderr, "cannot connect to VDS4E data plane '%s'\n",
            config.socket_path);
    goto cleanup_chip;
  }

  printf("%s\n", chip.device_path);
  fflush(stdout);
  result = vds4e_gpio_sync_run(&config, &chip, &client) == 0
               ? EXIT_SUCCESS
               : EXIT_FAILURE;
  vds_adapter_bridge_close(&client);

cleanup_chip:
  if (vds4e_gpio_chip_destroy(&config, &chip) != 0) {
    result = EXIT_FAILURE;
  }
  return result;
}
