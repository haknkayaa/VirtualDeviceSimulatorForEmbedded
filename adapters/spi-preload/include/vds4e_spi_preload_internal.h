#ifndef VDS4E_SPI_PRELOAD_INTERNAL_H
#define VDS4E_SPI_PRELOAD_INTERNAL_H

#include "vds4e/client.h"

#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define VDS4E_DEFAULT_SOCKET "/tmp/vds4e.sock"
#define VDS4E_MAX_MAP_LENGTH 16384U
#define VDS4E_MAX_MAPPINGS 256U
#define VDS4E_MAX_PATH_LENGTH 255U
#define VDS4E_MAX_DEVICE_ID_LENGTH 127U
#define VDS4E_MAX_TRANSFER_SIZE 3900U
#define VDS4E_MAX_RESPONSE_SIZE (1024U * 1024U)

#if defined(__GNUC__)
#define VDS4E_EXPORT __attribute__((visibility("default")))
#else
#define VDS4E_EXPORT
#endif

typedef struct vds_spi_state {
    pthread_mutex_t mutex;
    atomic_size_t references;
    char device_id[VDS4E_MAX_DEVICE_ID_LENGTH + 1U];
    uint8_t mode;
    uint8_t bits_per_word;
    uint8_t lsb_first;
    uint32_t max_speed_hz;
    vds_client_t client;
    bool connected;
} vds_spi_state_t;

typedef struct {
    int (*open_fn)(const char *path, int flags, ...);
    int (*open64_fn)(const char *path, int flags, ...);
    int (*close_fn)(int fd);
    int (*dup_fn)(int oldfd);
    int (*dup2_fn)(int oldfd, int newfd);
    int (*dup3_fn)(int oldfd, int newfd, int flags);
    int (*fcntl_fn)(int fd, int command, ...);
    int (*ioctl_fn)(int fd, unsigned long request, ...);
} vds_real_symbols_t;

const vds_real_symbols_t *vds_real_symbols(void);

int vds_device_map_lookup(const char *path,
                          char *device_id,
                          size_t device_id_capacity);
#ifdef VDS4E_TESTING
void vds_device_map_reset_for_tests(void);
#endif

vds_spi_state_t *vds_spi_state_create(const char *device_id);
void vds_spi_state_retain(vds_spi_state_t *state);
void vds_spi_state_release(vds_spi_state_t *state);
int vds_fd_table_insert(int fd, vds_spi_state_t *state);
vds_spi_state_t *vds_fd_table_acquire(int fd);
vds_spi_state_t *vds_fd_table_remove(int fd);
int vds_fd_table_copy(int source_fd, int destination_fd);

int vds_spi_ioctl(vds_spi_state_t *state,
                  unsigned long request,
                  unsigned long argument);
int vds_errno_from_client_status(vds_status_t status, const vds_error_t *error);
void vds_map_response(const uint8_t *payload,
                      size_t payload_length,
                      uint8_t *receive,
                      size_t receive_length);

bool vds_log_enabled(void);
bool vds_payload_log_enabled(void);
void vds_log_message(const char *format, ...);

#endif
