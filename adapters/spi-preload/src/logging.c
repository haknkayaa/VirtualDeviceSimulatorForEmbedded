#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static bool env_enabled(const char *name) {
    const char *value = getenv(name);
    return value != NULL && value[0] != '\0' && strcmp(value, "0") != 0 &&
           strcmp(value, "false") != 0;
}

bool vds_log_enabled(void) {
    return env_enabled("VDS4E_PRELOAD_LOG");
}

bool vds_payload_log_enabled(void) {
    return env_enabled("VDS4E_PRELOAD_LOG_PAYLOAD");
}

void vds_log_message(const char *format, ...) {
    if (!vds_log_enabled()) {
        return;
    }

    char buffer[768];
    const char prefix[] = "vds4e-spi-preload: ";
    size_t offset = sizeof(prefix) - 1U;
    (void)memcpy(buffer, prefix, offset);

    va_list arguments;
    va_start(arguments, format);
    const int written =
        vsnprintf(buffer + offset, sizeof(buffer) - offset, format, arguments);
    va_end(arguments);
    if (written < 0) {
        return;
    }

    size_t length = offset + (size_t)written;
    if (length >= sizeof(buffer) - 1U) {
        length = sizeof(buffer) - 2U;
    }
    buffer[length++] = '\n';
    const ssize_t emitted = write(STDERR_FILENO, buffer, length);
    (void)emitted;
}
