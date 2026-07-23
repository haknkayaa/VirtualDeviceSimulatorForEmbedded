#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <ctype.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char path[VDS4E_MAX_PATH_LENGTH + 1U];
    char device_id[VDS4E_MAX_DEVICE_ID_LENGTH + 1U];
} device_mapping_t;

static pthread_mutex_t map_mutex = PTHREAD_MUTEX_INITIALIZER;
static device_mapping_t mappings[VDS4E_MAX_MAPPINGS];
static size_t mapping_count;
static bool map_initialized;
static bool map_valid;

static bool is_spidev_path(const char *path) {
    static const char prefix[] = "/dev/spidev";
    const char *cursor = path;
    if (strncmp(cursor, prefix, sizeof(prefix) - 1U) != 0) {
        return false;
    }
    cursor += sizeof(prefix) - 1U;
    if (!isdigit((unsigned char)*cursor)) {
        return false;
    }
    while (isdigit((unsigned char)*cursor)) {
        cursor++;
    }
    if (*cursor++ != '.' || !isdigit((unsigned char)*cursor)) {
        return false;
    }
    while (isdigit((unsigned char)*cursor)) {
        cursor++;
    }
    return *cursor == '\0';
}

static bool is_device_id(const char *device_id) {
    if (*device_id == '\0') {
        return false;
    }
    for (const unsigned char *cursor = (const unsigned char *)device_id;
         *cursor != '\0';
         cursor++) {
        if (!isalnum(*cursor) && *cursor != '-' && *cursor != '_' &&
            *cursor != '.' && *cursor != ':') {
            return false;
        }
    }
    return true;
}

static void invalidate_map(const char *message) {
    map_valid = false;
    mapping_count = 0U;
    vds_log_message("invalid VDS4E_SPI_MAP: %s", message);
}

static void initialize_map(void) {
    map_initialized = true;
    map_valid = true;
    mapping_count = 0U;

    const char *environment = getenv("VDS4E_SPI_MAP");
    if (environment == NULL || *environment == '\0') {
        return;
    }
    const size_t length = strlen(environment);
    if (length > VDS4E_MAX_MAP_LENGTH) {
        invalidate_map("value exceeds 16384 bytes");
        return;
    }

    char *copy = strdup(environment);
    if (copy == NULL) {
        invalidate_map("allocation failed");
        return;
    }
    char *entry = copy;
    while (entry != NULL) {
        char *next = strchr(entry, ';');
        if (next != NULL) {
            *next++ = '\0';
        }
        if (*entry == '\0') {
            invalidate_map("empty mapping entry");
            break;
        }
        char *separator = strchr(entry, '=');
        if (separator == NULL || strchr(separator + 1, '=') != NULL) {
            invalidate_map("each entry must contain exactly one '='");
            break;
        }
        *separator++ = '\0';
        const size_t path_length = strlen(entry);
        const size_t id_length = strlen(separator);
        if (path_length == 0U || path_length > VDS4E_MAX_PATH_LENGTH ||
            !is_spidev_path(entry)) {
            invalidate_map("path must match /dev/spidev<bus>.<chip-select>");
            break;
        }
        if (id_length == 0U || id_length > VDS4E_MAX_DEVICE_ID_LENGTH ||
            !is_device_id(separator)) {
            invalidate_map("device ID is empty, oversized, or contains invalid characters");
            break;
        }
        if (mapping_count == VDS4E_MAX_MAPPINGS) {
            invalidate_map("too many mappings");
            break;
        }
        bool duplicate = false;
        for (size_t index = 0U; index < mapping_count; index++) {
            if (strcmp(mappings[index].path, entry) == 0) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            invalidate_map("duplicate device path");
            break;
        }
        (void)memcpy(mappings[mapping_count].path, entry, path_length + 1U);
        (void)memcpy(
            mappings[mapping_count].device_id, separator, id_length + 1U);
        mapping_count++;
        entry = next;
    }
    free(copy);
}

int vds_device_map_lookup(const char *path,
                          char *device_id,
                          size_t device_id_capacity) {
    if (path == NULL || device_id == NULL || device_id_capacity == 0U) {
        errno = EINVAL;
        return -1;
    }
    if (pthread_mutex_lock(&map_mutex) != 0) {
        errno = EIO;
        return -1;
    }
    if (!map_initialized) {
        initialize_map();
    }
    if (!map_valid) {
        (void)pthread_mutex_unlock(&map_mutex);
        errno = EINVAL;
        return -1;
    }
    int result = 0;
    for (size_t index = 0U; index < mapping_count; index++) {
        if (strcmp(mappings[index].path, path) != 0) {
            continue;
        }
        const size_t length = strlen(mappings[index].device_id);
        if (length >= device_id_capacity) {
            errno = ENOSPC;
            result = -1;
        } else {
            (void)memcpy(device_id, mappings[index].device_id, length + 1U);
            result = 1;
        }
        break;
    }
    (void)pthread_mutex_unlock(&map_mutex);
    return result;
}

#ifdef VDS4E_TESTING
void vds_device_map_reset_for_tests(void) {
    (void)pthread_mutex_lock(&map_mutex);
    mapping_count = 0U;
    map_initialized = false;
    map_valid = false;
    (void)memset(mappings, 0, sizeof(mappings));
    (void)pthread_mutex_unlock(&map_mutex);
}
#endif
