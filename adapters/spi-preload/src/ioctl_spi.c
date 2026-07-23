#define _GNU_SOURCE
#include "vds4e_spi_preload_internal.h"

#include <errno.h>
#include <linux/spi/spidev.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

enum {
    VDS_ERROR_DEVICE_NOT_FOUND = 1,
    VDS_ERROR_UNKNOWN_OPCODE = 2,
    VDS_ERROR_INVALID_REQUEST = 3,
    VDS_ERROR_INTERNAL = 4,
    VDS_ERROR_REGISTER_UNKNOWN_ADDRESS = 5,
    VDS_ERROR_REGISTER_READ_NOT_ALLOWED = 6,
    VDS_ERROR_REGISTER_WRITE_NOT_ALLOWED = 7,
    VDS_ERROR_REGISTER_VALUE_OVERFLOW = 8,
    VDS_ERROR_DEVICE_BUSY = 9,
    VDS_ERROR_TIMING = 10,
    VDS_ERROR_STATE_INVALID_EVENT = 11,
    VDS_ERROR_STATE_GUARD_REJECTED = 12,
    VDS_ERROR_STATE_COMMAND_REJECTED = 13,
    VDS_ERROR_STATE_ACTION_FAILED = 14,
    VDS_ERROR_FAULT_TIMEOUT = 15,
    VDS_ERROR_FAULT_RETURN_ERROR = 16,
    VDS_ERROR_FAULT_DROPPED = 17,
    VDS_ERROR_FAULT_ACTION_FAILED = 18
};

static int copy_from_application(void *destination,
                                 const void *source,
                                 size_t length) {
    if (length == 0U) {
        return 0;
    }
    int descriptors[2];
    if (pipe2(descriptors, O_CLOEXEC) != 0) {
        return -1;
    }
    const ssize_t accepted = write(descriptors[1], source, length);
    const int write_errno = errno;
    (void)close(descriptors[1]);
    if (accepted != (ssize_t)length) {
        (void)close(descriptors[0]);
        errno = accepted < 0 ? write_errno : EFAULT;
        return -1;
    }
    const ssize_t copied = read(descriptors[0], destination, length);
    const int read_errno = errno;
    (void)close(descriptors[0]);
    if (copied != (ssize_t)length) {
        errno = copied < 0 ? read_errno : EFAULT;
        return -1;
    }
    return 0;
}

static int copy_to_application(void *destination,
                               const void *source,
                               size_t length) {
    if (length == 0U) {
        return 0;
    }
    int descriptors[2];
    if (pipe2(descriptors, O_CLOEXEC) != 0) {
        return -1;
    }
    const ssize_t accepted = write(descriptors[1], source, length);
    const int write_errno = errno;
    (void)close(descriptors[1]);
    if (accepted != (ssize_t)length) {
        (void)close(descriptors[0]);
        errno = accepted < 0 ? write_errno : EFAULT;
        return -1;
    }
    const ssize_t copied = read(descriptors[0], destination, length);
    const int read_errno = errno;
    (void)close(descriptors[0]);
    if (copied != (ssize_t)length) {
        errno = EFAULT;
        if (copied < 0 && read_errno != 0) {
            errno = read_errno;
        }
        return -1;
    }
    return 0;
}

void vds_map_response(const uint8_t *payload,
                      size_t payload_length,
                      uint8_t *receive,
                      size_t receive_length) {
    if (receive == NULL || receive_length == 0U) {
        return;
    }
    (void)memset(receive, 0, receive_length);
    if (payload == NULL || payload_length == 0U) {
        return;
    }
    const size_t copy_length =
        payload_length < receive_length ? payload_length : receive_length;
    const size_t destination_offset =
        payload_length < receive_length ? receive_length - copy_length : 0U;
    (void)memcpy(receive + destination_offset, payload, copy_length);
}

int vds_errno_from_client_status(vds_status_t status, const vds_error_t *error) {
    if (status == VDS_ERR_ARGUMENT) {
        return EINVAL;
    }
    if (status == VDS_ERR_IO) {
        return EIO;
    }
    if (status == VDS_ERR_PROTOCOL) {
        return EPROTO;
    }
    if (status == VDS_ERR_BUFFER_TOO_SMALL) {
        return EMSGSIZE;
    }
    if (status != VDS_ERR_SERVER || error == NULL) {
        return EIO;
    }
    switch (error->code) {
        case VDS_ERROR_DEVICE_NOT_FOUND:
            return ENODEV;
        case VDS_ERROR_UNKNOWN_OPCODE:
            return EPROTO;
        case VDS_ERROR_INVALID_REQUEST:
        case VDS_ERROR_REGISTER_UNKNOWN_ADDRESS:
        case VDS_ERROR_STATE_INVALID_EVENT:
            return EINVAL;
        case VDS_ERROR_REGISTER_READ_NOT_ALLOWED:
        case VDS_ERROR_REGISTER_WRITE_NOT_ALLOWED:
        case VDS_ERROR_STATE_GUARD_REJECTED:
        case VDS_ERROR_STATE_COMMAND_REJECTED:
            return EACCES;
        case VDS_ERROR_REGISTER_VALUE_OVERFLOW:
            return ERANGE;
        case VDS_ERROR_DEVICE_BUSY:
            return EBUSY;
        case VDS_ERROR_FAULT_TIMEOUT:
            return ETIMEDOUT;
        case VDS_ERROR_INTERNAL:
        case VDS_ERROR_TIMING:
        case VDS_ERROR_STATE_ACTION_FAILED:
        case VDS_ERROR_FAULT_RETURN_ERROR:
        case VDS_ERROR_FAULT_DROPPED:
        case VDS_ERROR_FAULT_ACTION_FAILED:
        default:
            return EIO;
    }
}

static int read_u8(unsigned long argument, uint8_t *value) {
    if (argument == 0U) {
        errno = EFAULT;
        return -1;
    }
    return copy_from_application(
        value, (const void *)(uintptr_t)argument, sizeof(*value));
}

static int write_u8(unsigned long argument, uint8_t value) {
    if (argument == 0U) {
        errno = EFAULT;
        return -1;
    }
    return copy_to_application(
        (void *)(uintptr_t)argument, &value, sizeof(value));
}

static int read_u32(unsigned long argument, uint32_t *value) {
    if (argument == 0U) {
        errno = EFAULT;
        return -1;
    }
    return copy_from_application(
        value, (const void *)(uintptr_t)argument, sizeof(*value));
}

static int write_u32(unsigned long argument, uint32_t value) {
    if (argument == 0U) {
        errno = EFAULT;
        return -1;
    }
    return copy_to_application(
        (void *)(uintptr_t)argument, &value, sizeof(value));
}

static int ensure_connected(vds_spi_state_t *state) {
    if (state->connected) {
        return 0;
    }
    const char *socket_path = getenv("VDS4E_SOCKET");
    if (socket_path == NULL || *socket_path == '\0') {
        socket_path = VDS4E_DEFAULT_SOCKET;
    }
    const vds_status_t status =
        vds_client_connect(&state->client, socket_path);
    if (status != VDS_OK) {
        state->client.fd = -1;
        state->connected = false;
        errno = status == VDS_ERR_ARGUMENT ? EINVAL : ENOTCONN;
        return -1;
    }
    state->connected = true;
    return 0;
}

static bool unsupported_transfer_feature(
    const struct spi_ioc_transfer *transfer) {
    return transfer->delay_usecs != 0U || transfer->cs_change != 0U ||
           transfer->tx_nbits != 0U || transfer->rx_nbits != 0U ||
           transfer->word_delay_usecs != 0U || transfer->pad != 0U;
}

static int execute_transfer(vds_spi_state_t *state,
                            unsigned long argument) {
    if (argument == 0U) {
        errno = EFAULT;
        return -1;
    }
    struct spi_ioc_transfer transfer;
    if (copy_from_application(
            &transfer,
            (const void *)(uintptr_t)argument,
            sizeof(transfer)) != 0) {
        return -1;
    }
    if (transfer.len > VDS4E_MAX_TRANSFER_SIZE) {
        errno = EMSGSIZE;
        return -1;
    }
    if (unsupported_transfer_feature(&transfer)) {
        errno = ENOTSUP;
        return -1;
    }
    const uint8_t bits =
        transfer.bits_per_word == 0U ? state->bits_per_word
                                     : transfer.bits_per_word;
    if (bits != 8U) {
        errno = EINVAL;
        return -1;
    }
    if (transfer.len == 0U) {
        return 0;
    }

    uint8_t *transmit = calloc(transfer.len, 1U);
    uint8_t *payload = malloc(VDS4E_MAX_RESPONSE_SIZE);
    uint8_t *receive = malloc(transfer.len);
    if (transmit == NULL || payload == NULL || receive == NULL) {
        free(transmit);
        free(payload);
        free(receive);
        errno = ENOMEM;
        return -1;
    }
    if (transfer.tx_buf != 0U &&
        copy_from_application(
            transmit,
            (const void *)(uintptr_t)transfer.tx_buf,
            transfer.len) != 0) {
        free(transmit);
        free(payload);
        free(receive);
        return -1;
    }
    if (ensure_connected(state) != 0) {
        free(transmit);
        free(payload);
        free(receive);
        return -1;
    }

    size_t payload_length = 0U;
    vds_error_t error;
    const vds_status_t status = vds_spi_transfer(&state->client,
                                                 state->device_id,
                                                 transmit,
                                                 transfer.len,
                                                 payload,
                                                 VDS4E_MAX_RESPONSE_SIZE,
                                                 &payload_length,
                                                 &error);
    free(transmit);
    if (status != VDS_OK) {
        if (status == VDS_ERR_IO) {
            vds_client_close(&state->client);
            state->connected = false;
        }
        const int mapped_errno = vds_errno_from_client_status(status, &error);
        vds_log_message("device=%s ioctl=SPI_IOC_MESSAGE len=%u result=-1 errno=%d",
                        state->device_id,
                        transfer.len,
                        mapped_errno);
        free(payload);
        free(receive);
        errno = mapped_errno;
        return -1;
    }

    vds_map_response(payload, payload_length, receive, transfer.len);
    free(payload);
    if (transfer.rx_buf != 0U &&
        copy_to_application(
            (void *)(uintptr_t)transfer.rx_buf, receive, transfer.len) != 0) {
        free(receive);
        return -1;
    }
    free(receive);
    vds_log_message("device=%s ioctl=SPI_IOC_MESSAGE len=%u result=%u",
                    state->device_id,
                    transfer.len,
                    transfer.len);
    return (int)transfer.len;
}

static int handle_ioctl_locked(vds_spi_state_t *state,
                               unsigned long request,
                               unsigned long argument) {
    uint8_t value8;
    uint32_t value32;
    switch (request) {
        case SPI_IOC_RD_MODE:
            return write_u8(argument, state->mode);
        case SPI_IOC_WR_MODE:
            if (read_u8(argument, &value8) != 0) {
                return -1;
            }
            if (value8 != 0U) {
                errno = EINVAL;
                return -1;
            }
            state->mode = value8;
            return 0;
        case SPI_IOC_RD_BITS_PER_WORD:
            return write_u8(argument, state->bits_per_word);
        case SPI_IOC_WR_BITS_PER_WORD:
            if (read_u8(argument, &value8) != 0) {
                return -1;
            }
            if (value8 != 0U && value8 != 8U) {
                errno = EINVAL;
                return -1;
            }
            state->bits_per_word = 8U;
            return 0;
        case SPI_IOC_RD_MAX_SPEED_HZ:
            return write_u32(argument, state->max_speed_hz);
        case SPI_IOC_WR_MAX_SPEED_HZ:
            if (read_u32(argument, &value32) != 0) {
                return -1;
            }
            if (value32 == 0U) {
                errno = EINVAL;
                return -1;
            }
            state->max_speed_hz = value32;
            return 0;
        case SPI_IOC_RD_LSB_FIRST:
            return write_u8(argument, state->lsb_first);
        case SPI_IOC_WR_LSB_FIRST:
            if (read_u8(argument, &value8) != 0) {
                return -1;
            }
            if (value8 != 0U) {
                errno = EINVAL;
                return -1;
            }
            state->lsb_first = value8;
            return 0;
        default:
            break;
    }

    if (_IOC_TYPE(request) != SPI_IOC_MAGIC ||
        _IOC_NR(request) != _IOC_NR(SPI_IOC_MESSAGE(0)) ||
        _IOC_DIR(request) != _IOC_WRITE) {
        errno = ENOTTY;
        return -1;
    }
    const size_t encoded_size = _IOC_SIZE(request);
    if (encoded_size % sizeof(struct spi_ioc_transfer) != 0U) {
        errno = EINVAL;
        return -1;
    }
    const size_t transfer_count =
        encoded_size / sizeof(struct spi_ioc_transfer);
    if (transfer_count == 0U) {
        return 0;
    }
    if (transfer_count > 1U) {
        errno = ENOTSUP;
        return -1;
    }
    return execute_transfer(state, argument);
}

int vds_spi_ioctl(vds_spi_state_t *state,
                  unsigned long request,
                  unsigned long argument) {
    if (state == NULL) {
        errno = EBADF;
        return -1;
    }
    if (pthread_mutex_lock(&state->mutex) != 0) {
        errno = EIO;
        return -1;
    }
    const int result = handle_ioctl_locked(state, request, argument);
    (void)pthread_mutex_unlock(&state->mutex);
    return result;
}
