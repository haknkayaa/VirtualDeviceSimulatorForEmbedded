#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <errno.h>
#include <stdarg.h>
#include <string.h>
#include <sys/eventfd.h>
#include <sys/ioctl.h>
#include <unistd.h>

static bool open_has_mode(int flags) {
    if ((flags & O_CREAT) != 0) {
        return true;
    }
#ifdef O_TMPFILE
    return (flags & O_TMPFILE) == O_TMPFILE;
#else
    return false;
#endif
}

static int forward_open(bool use_open64,
                        const char *path,
                        int flags,
                        mode_t mode,
                        bool has_mode) {
    const vds_real_symbols_t *real = vds_real_symbols();
    if (use_open64) {
        return has_mode ? real->open64_fn(path, flags, mode)
                        : real->open64_fn(path, flags);
    }
    return has_mode ? real->open_fn(path, flags, mode)
                    : real->open_fn(path, flags);
}

static int intercepted_open(bool use_open64,
                            const char *path,
                            int flags,
                            mode_t mode,
                            bool has_mode) {
    char device_id[VDS4E_MAX_DEVICE_ID_LENGTH + 1U];
    const int mapping =
        vds_device_map_lookup(path, device_id, sizeof(device_id));
    if (mapping == 0) {
        return forward_open(use_open64, path, flags, mode, has_mode);
    }
    if (mapping < 0) {
        if (path == NULL || strncmp(path, "/dev/spidev", 12U) == 0) {
            errno = EINVAL;
            return -1;
        }
        return forward_open(use_open64, path, flags, mode, has_mode);
    }

    int event_flags = EFD_NONBLOCK;
    if ((flags & O_CLOEXEC) != 0) {
        event_flags |= EFD_CLOEXEC;
    }
    const int fd = eventfd(0U, event_flags);
    if (fd < 0) {
        return -1;
    }
    vds_spi_state_t *state = vds_spi_state_create(device_id);
    if (state == NULL || vds_fd_table_insert(fd, state) != 0) {
        const int saved_errno = errno;
        vds_spi_state_release(state);
        (void)vds_real_symbols()->close_fn(fd);
        errno = saved_errno;
        return -1;
    }
    vds_spi_state_release(state);
    vds_log_message("path=%s device=%s open result=%d", path, device_id, fd);
    return fd;
}

VDS4E_EXPORT int open(const char *path, int flags, ...) {
    mode_t mode = 0;
    const bool has_mode = open_has_mode(flags);
    if (has_mode) {
        va_list arguments;
        va_start(arguments, flags);
        mode = (mode_t)va_arg(arguments, int);
        va_end(arguments);
    }
    return intercepted_open(false, path, flags, mode, has_mode);
}

VDS4E_EXPORT int open64(const char *path, int flags, ...) {
    mode_t mode = 0;
    const bool has_mode = open_has_mode(flags);
    if (has_mode) {
        va_list arguments;
        va_start(arguments, flags);
        mode = (mode_t)va_arg(arguments, int);
        va_end(arguments);
    }
    return intercepted_open(true, path, flags, mode, has_mode);
}

VDS4E_EXPORT int close(int fd) {
    vds_spi_state_t *state = vds_fd_table_remove(fd);
    const int result = vds_real_symbols()->close_fn(fd);
    if (state != NULL) {
        vds_spi_state_release(state);
    }
    return result;
}

static void update_duplicate_mapping(int destination_fd,
                                     vds_spi_state_t *source_state) {
    vds_spi_state_t *old = vds_fd_table_remove(destination_fd);
    if (old != NULL) {
        vds_spi_state_release(old);
    }
    if (source_state != NULL &&
        vds_fd_table_insert(destination_fd, source_state) != 0) {
        vds_log_message("failed to track duplicated fd=%d", destination_fd);
    }
}

VDS4E_EXPORT int dup(int oldfd) {
    vds_spi_state_t *state = vds_fd_table_acquire(oldfd);
    const int result = vds_real_symbols()->dup_fn(oldfd);
    if (result >= 0 && state != NULL) {
        update_duplicate_mapping(result, state);
    }
    vds_spi_state_release(state);
    return result;
}

VDS4E_EXPORT int dup2(int oldfd, int newfd) {
    vds_spi_state_t *state = vds_fd_table_acquire(oldfd);
    const int result = vds_real_symbols()->dup2_fn(oldfd, newfd);
    if (result >= 0 && oldfd != newfd) {
        update_duplicate_mapping(result, state);
    }
    vds_spi_state_release(state);
    return result;
}

VDS4E_EXPORT int dup3(int oldfd, int newfd, int flags) {
    vds_spi_state_t *state = vds_fd_table_acquire(oldfd);
    const int result = vds_real_symbols()->dup3_fn(oldfd, newfd, flags);
    if (result >= 0) {
        update_duplicate_mapping(result, state);
    }
    vds_spi_state_release(state);
    return result;
}

static bool fcntl_has_no_argument(int command) {
    switch (command) {
        case F_GETFD:
        case F_GETFL:
        case F_GETOWN:
#ifdef F_GETSIG
        case F_GETSIG:
#endif
#ifdef F_GETLEASE
        case F_GETLEASE:
#endif
#ifdef F_GETPIPE_SZ
        case F_GETPIPE_SZ:
#endif
#ifdef F_GET_SEALS
        case F_GET_SEALS:
#endif
            return true;
        default:
            return false;
    }
}

static bool fcntl_has_pointer_argument(int command) {
    if (command == F_GETLK || command == F_SETLK || command == F_SETLKW) {
        return true;
    }
#ifdef F_OFD_GETLK
    if (command == F_OFD_GETLK || command == F_OFD_SETLK ||
        command == F_OFD_SETLKW) {
        return true;
    }
#endif
#ifdef F_GETOWN_EX
    if (command == F_GETOWN_EX || command == F_SETOWN_EX) {
        return true;
    }
#endif
#ifdef F_GET_RW_HINT
    if (command == F_GET_RW_HINT || command == F_SET_RW_HINT ||
        command == F_GET_FILE_RW_HINT || command == F_SET_FILE_RW_HINT) {
        return true;
    }
#endif
    return false;
}

VDS4E_EXPORT int fcntl(int fd, int command, ...) {
    const vds_real_symbols_t *real = vds_real_symbols();
    if (fcntl_has_no_argument(command)) {
        return real->fcntl_fn(fd, command);
    }

    va_list arguments;
    va_start(arguments, command);
    int result;
    if (fcntl_has_pointer_argument(command)) {
        void *argument = va_arg(arguments, void *);
        result = real->fcntl_fn(fd, command, argument);
    } else {
        const int argument = va_arg(arguments, int);
        vds_spi_state_t *state = NULL;
        if (command == F_DUPFD
#ifdef F_DUPFD_CLOEXEC
            || command == F_DUPFD_CLOEXEC
#endif
        ) {
            state = vds_fd_table_acquire(fd);
        }
        result = real->fcntl_fn(fd, command, argument);
        if (result >= 0 && state != NULL) {
            update_duplicate_mapping(result, state);
        }
        vds_spi_state_release(state);
    }
    va_end(arguments);
    return result;
}

VDS4E_EXPORT int ioctl(int fd, unsigned long request, ...) {
    vds_spi_state_t *state = vds_fd_table_acquire(fd);
    if (state == NULL) {
        va_list arguments;
        va_start(arguments, request);
        const unsigned long argument = va_arg(arguments, unsigned long);
        va_end(arguments);
        return vds_real_symbols()->ioctl_fn(fd, request, argument);
    }

    unsigned long argument = 0U;
    if (_IOC_DIR(request) != _IOC_NONE || _IOC_SIZE(request) != 0U) {
        va_list arguments;
        va_start(arguments, request);
        argument = va_arg(arguments, unsigned long);
        va_end(arguments);
    }
    const int result = vds_spi_ioctl(state, request, argument);
    vds_spi_state_release(state);
    return result;
}
