#define _GNU_SOURCE

#include "i2c_cuse.h"

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

static void *watch_parent(void *argument) {
  const pid_t pid = *(const pid_t *)argument;
  while (kill(pid, 0) == 0 || errno == EPERM) {
    sleep(1U);
  }
  if (errno == ESRCH) {
    (void)kill(getpid(), SIGTERM);
  }
  return NULL;
}

static void *make_device_accessible(void *argument) {
  const vds4e_i2c_config_t *config = argument;
  char path[sizeof(config->device_name) + sizeof("/dev/")];
  const int written =
      snprintf(path, sizeof(path), "/dev/%s", config->device_name);
  if (written < 0 || (size_t)written >= sizeof(path)) {
    return NULL;
  }
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

  for (unsigned int attempt = 0U; attempt < 12000U; ++attempt) {
    if (chown(path, owner, group) == 0 && chmod(path, 0660) == 0) {
      return NULL;
    }
    if (errno != ENOENT) {
      return NULL;
    }
    usleep(10000U);
  }
  return NULL;
}

static int configure_lifecycle(vds4e_i2c_config_t *config) {
  if (config->parent_pid > 0) {
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0 ||
        getppid() != config->parent_pid) {
      return -1;
    }
    pthread_t watcher;
    if (pthread_create(&watcher, NULL, watch_parent, &config->parent_pid) != 0) {
      return -1;
    }
    (void)pthread_detach(watcher);
  }

  pthread_t permissions;
  if (pthread_create(&permissions, NULL, make_device_accessible, config) != 0) {
    return -1;
  }
  (void)pthread_detach(permissions);
  return 0;
}

int main(int argc, char **argv) {
  vds4e_i2c_config_t config = {0};
  const int parsed = vds4e_i2c_parse_options(argc, argv, &config);
  if (parsed != 0) {
    if (parsed < 0) {
      vds4e_i2c_print_usage();
    }
    return parsed > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
  }
  if (configure_lifecycle(&config) != 0) {
    return EXIT_FAILURE;
  }
  return vds4e_i2c_cuse_serve(argv[0], &config);
}
