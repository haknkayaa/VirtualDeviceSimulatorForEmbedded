#include "vds4e_spi_preload_internal.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

typedef struct fd_entry {
    int fd;
    vds_spi_state_t *state;
    struct fd_entry *next;
} fd_entry_t;

static pthread_mutex_t table_mutex = PTHREAD_MUTEX_INITIALIZER;
static fd_entry_t *entries;

vds_spi_state_t *vds_spi_state_create(const char *device_id) {
    if (device_id == NULL ||
        strlen(device_id) > VDS4E_MAX_DEVICE_ID_LENGTH) {
        errno = EINVAL;
        return NULL;
    }
    vds_spi_state_t *state = calloc(1U, sizeof(*state));
    if (state == NULL) {
        return NULL;
    }
    if (pthread_mutex_init(&state->mutex, NULL) != 0) {
        free(state);
        errno = EIO;
        return NULL;
    }
    atomic_init(&state->references, 1U);
    (void)strcpy(state->device_id, device_id);
    state->mode = 0U;
    state->bits_per_word = 8U;
    state->lsb_first = 0U;
    state->max_speed_hz = 1000000U;
    state->client.fd = -1;
    state->client.next_request_id = 1U;
    state->connected = false;
    return state;
}

void vds_spi_state_retain(vds_spi_state_t *state) {
    if (state != NULL) {
        (void)atomic_fetch_add_explicit(
            &state->references, 1U, memory_order_relaxed);
    }
}

void vds_spi_state_release(vds_spi_state_t *state) {
    if (state == NULL ||
        atomic_fetch_sub_explicit(
            &state->references, 1U, memory_order_acq_rel) != 1U) {
        return;
    }
    if (state->connected) {
        vds_client_close(&state->client);
    }
    (void)pthread_mutex_destroy(&state->mutex);
    free(state);
}

int vds_fd_table_insert(int fd, vds_spi_state_t *state) {
    if (fd < 0 || state == NULL) {
        errno = EINVAL;
        return -1;
    }
    fd_entry_t *entry = malloc(sizeof(*entry));
    if (entry == NULL) {
        return -1;
    }
    entry->fd = fd;
    entry->state = state;
    vds_spi_state_retain(state);

    if (pthread_mutex_lock(&table_mutex) != 0) {
        vds_spi_state_release(state);
        free(entry);
        errno = EIO;
        return -1;
    }
    fd_entry_t **cursor = &entries;
    while (*cursor != NULL && (*cursor)->fd != fd) {
        cursor = &(*cursor)->next;
    }
    fd_entry_t *replaced = *cursor;
    if (replaced != NULL) {
        entry->next = replaced->next;
        *cursor = entry;
    } else {
        entry->next = entries;
        entries = entry;
    }
    (void)pthread_mutex_unlock(&table_mutex);
    if (replaced != NULL) {
        vds_spi_state_release(replaced->state);
        free(replaced);
    }
    return 0;
}

vds_spi_state_t *vds_fd_table_acquire(int fd) {
    if (pthread_mutex_lock(&table_mutex) != 0) {
        return NULL;
    }
    vds_spi_state_t *state = NULL;
    for (fd_entry_t *entry = entries; entry != NULL; entry = entry->next) {
        if (entry->fd == fd) {
            state = entry->state;
            vds_spi_state_retain(state);
            break;
        }
    }
    (void)pthread_mutex_unlock(&table_mutex);
    return state;
}

vds_spi_state_t *vds_fd_table_remove(int fd) {
    if (pthread_mutex_lock(&table_mutex) != 0) {
        return NULL;
    }
    fd_entry_t **cursor = &entries;
    while (*cursor != NULL && (*cursor)->fd != fd) {
        cursor = &(*cursor)->next;
    }
    fd_entry_t *removed = *cursor;
    if (removed != NULL) {
        *cursor = removed->next;
    }
    (void)pthread_mutex_unlock(&table_mutex);
    if (removed == NULL) {
        return NULL;
    }
    vds_spi_state_t *state = removed->state;
    free(removed);
    return state;
}

int vds_fd_table_copy(int source_fd, int destination_fd) {
    vds_spi_state_t *state = vds_fd_table_acquire(source_fd);
    if (state == NULL) {
        errno = EBADF;
        return -1;
    }
    const int result = vds_fd_table_insert(destination_fd, state);
    vds_spi_state_release(state);
    return result;
}
