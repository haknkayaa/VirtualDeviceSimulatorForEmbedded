#define _GNU_SOURCE

#include "spi_cuse.h"

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <unistd.h>

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

static int configure_lifecycle(vds4e_spi_config_t *config) {
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0) {
    perror("failed to configure parent-death cleanup");
    return -1;
  }
  if (config->parent_pid == 0) {
    return 0;
  }

  pthread_t watcher;
  const int result =
      pthread_create(&watcher, NULL, watch_parent, &config->parent_pid);
  if (result != 0) {
    errno = result;
    perror("failed to start parent watcher");
    return -1;
  }
  (void)pthread_detach(watcher);
  return 0;
}

int main(int argc, char **argv) {
  vds4e_spi_config_t config = {0};
  const int parsed = vds4e_spi_parse_options(argc, argv, &config);
  if (parsed != 0) {
    return parsed > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (configure_lifecycle(&config) != 0) {
    return EXIT_FAILURE;
  }
  return vds4e_spi_cuse_serve(argv[0], &config);
}
