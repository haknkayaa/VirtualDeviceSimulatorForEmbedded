#include "vds4e/client.h"

#include <arpa/inet.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define VDS_MAX_FRAME_SIZE (1024U * 1024U)
#define VDS_MAX_REQUEST_SIZE 4096U
#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

typedef struct {
    const uint8_t *data;
    size_t length;
    size_t offset;
} decoder_t;

static int write_all(int fd, const uint8_t *data, size_t length) {
    while (length > 0U) {
        const ssize_t written = send(fd, data, length, MSG_NOSIGNAL);
        if (written < 0 && errno == EINTR) {
            continue;
        }
        if (written <= 0) {
            return -1;
        }
        data += (size_t)written;
        length -= (size_t)written;
    }
    return 0;
}

static int read_all(int fd, uint8_t *data, size_t length) {
    while (length > 0U) {
        const ssize_t received = read(fd, data, length);
        if (received < 0 && errno == EINTR) {
            continue;
        }
        if (received <= 0) {
            return -1;
        }
        data += (size_t)received;
        length -= (size_t)received;
    }
    return 0;
}

static int encode_varint(uint8_t *buffer, size_t capacity, size_t *offset, uint64_t value) {
    do {
        if (*offset >= capacity) {
            return -1;
        }
        uint8_t byte = (uint8_t)(value & 0x7FU);
        value >>= 7U;
        if (value != 0U) {
            byte |= 0x80U;
        }
        buffer[(*offset)++] = byte;
    } while (value != 0U);
    return 0;
}

static int encode_bytes(uint8_t *buffer,
                        size_t capacity,
                        size_t *offset,
                        uint32_t field,
                        const uint8_t *data,
                        size_t length) {
    if (encode_varint(buffer, capacity, offset, ((uint64_t)field << 3U) | 2U) != 0 ||
        encode_varint(buffer, capacity, offset, length) != 0 ||
        length > capacity - *offset) {
        return -1;
    }
    memcpy(buffer + *offset, data, length);
    *offset += length;
    return 0;
}

static int decode_varint(decoder_t *decoder, uint64_t *value) {
    *value = 0U;
    for (unsigned shift = 0U; shift < 64U; shift += 7U) {
        if (decoder->offset >= decoder->length) {
            return -1;
        }
        const uint8_t byte = decoder->data[decoder->offset++];
        *value |= (uint64_t)(byte & 0x7FU) << shift;
        if ((byte & 0x80U) == 0U) {
            return 0;
        }
    }
    return -1;
}

static int decode_slice(decoder_t *decoder, decoder_t *slice) {
    uint64_t length = 0U;
    if (decode_varint(decoder, &length) != 0 || length > decoder->length - decoder->offset) {
        return -1;
    }
    slice->data = decoder->data + decoder->offset;
    slice->length = (size_t)length;
    slice->offset = 0U;
    decoder->offset += (size_t)length;
    return 0;
}

static int skip_field(decoder_t *decoder, uint32_t wire_type) {
    uint64_t ignored = 0U;
    decoder_t slice;
    if (wire_type == 0U) {
        return decode_varint(decoder, &ignored);
    }
    if (wire_type == 2U) {
        return decode_slice(decoder, &slice);
    }
    return -1;
}

static int parse_spi_response(decoder_t *decoder,
                              uint8_t *rx,
                              size_t rx_capacity,
                              size_t *rx_length) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (decode_varint(decoder, &tag) != 0) {
            return -1;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            decoder_t bytes;
            if (decode_slice(decoder, &bytes) != 0) {
                return -1;
            }
            *rx_length = bytes.length;
            if (bytes.length > rx_capacity) {
                return 1;
            }
            memcpy(rx, bytes.data, bytes.length);
        } else if (skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    return 0;
}

static int parse_gpio_response(decoder_t *decoder,
                               uint8_t *values,
                               size_t capacity,
                               size_t *count) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (decode_varint(decoder, &tag) != 0) {
            return -1;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            decoder_t packed;
            if (decode_slice(decoder, &packed) != 0) {
                return -1;
            }
            size_t index = 0U;
            while (packed.offset < packed.length) {
                uint64_t value = 0U;
                if (decode_varint(&packed, &value) != 0) {
                    return -1;
                }
                if (index >= capacity) {
                    return 1;
                }
                values[index++] = value != 0U ? 1U : 0U;
            }
            *count = index;
        } else if (skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    return 0;
}

static int parse_i2c_response(decoder_t *decoder,
                              uint8_t *data,
                              size_t capacity,
                              size_t *length) {
    size_t written = 0U;
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (decode_varint(decoder, &tag) != 0) {
            return -1;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            decoder_t bytes;
            if (decode_slice(decoder, &bytes) != 0) {
                return -1;
            }
            if (bytes.length > capacity - written) {
                *length = written + bytes.length;
                return 1;
            }
            memcpy(data + written, bytes.data, bytes.length);
            written += bytes.length;
        } else if (skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    *length = written;
    return 0;
}

static int parse_error_response(decoder_t *decoder, vds_error_t *error) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (decode_varint(decoder, &tag) != 0) {
            return -1;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            uint64_t code = 0U;
            if (decode_varint(decoder, &code) != 0) {
                return -1;
            }
            error->code = (int)code;
        } else if (field == 2U && wire_type == 2U) {
            decoder_t message;
            if (decode_slice(decoder, &message) != 0) {
                return -1;
            }
            const size_t copy_length =
                message.length < sizeof(error->message) - 1U ? message.length
                                                             : sizeof(error->message) - 1U;
            memcpy(error->message, message.data, copy_length);
            error->message[copy_length] = '\0';
        } else if (skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    return 0;
}

vds_status_t vds_client_connect(vds_client_t *client, const char *socket_path) {
    if (client == NULL || socket_path == NULL) {
        return VDS_ERR_ARGUMENT;
    }
    if (strlen(socket_path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
        return VDS_ERR_ARGUMENT;
    }

    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return VDS_ERR_IO;
    }

    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    (void)snprintf(address.sun_path, sizeof(address.sun_path), "%s", socket_path);
    if (connect(fd, (const struct sockaddr *)&address, sizeof(address)) != 0) {
        (void)close(fd);
        return VDS_ERR_IO;
    }

    client->fd = fd;
    client->next_request_id = 1U;
    return VDS_OK;
}

void vds_client_close(vds_client_t *client) {
    if (client != NULL && client->fd >= 0) {
        (void)close(client->fd);
        client->fd = -1;
    }
}

vds_status_t vds_spi_transfer_configured(vds_client_t *client,
                                         const char *device_id,
                                         const uint8_t *tx,
                                         size_t tx_length,
                                         size_t requested_rx_length,
                                         const vds_spi_wire_config_t *wire,
                                         uint8_t *rx,
                                         size_t rx_capacity,
                                         size_t *rx_length,
                                         vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL || tx == NULL || wire == NULL ||
        tx_length == 0U || rx == NULL || rx_length == NULL || error == NULL) {
        return VDS_ERR_ARGUMENT;
    }
    memset(error, 0, sizeof(*error));
    *rx_length = 0U;

    uint8_t spi[VDS_MAX_REQUEST_SIZE];
    size_t spi_length = 0U;
    if (encode_bytes(spi,
                     sizeof(spi),
                     &spi_length,
                     1U,
                     (const uint8_t *)device_id,
                     strlen(device_id)) != 0 ||
        encode_bytes(spi, sizeof(spi), &spi_length, 2U, tx, tx_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }
    {
        uint8_t encoded_wire[128];
        size_t wire_length = 0U;
        if (encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 8U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->mode) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 16U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->bits_per_word) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 24U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->max_speed_hz) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 32U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->command_width) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 40U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->address_width) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 48U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->data_width) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 56U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->rate) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 64U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->dummy_cycles) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, 72U) != 0 ||
            encode_varint(encoded_wire, sizeof(encoded_wire), &wire_length, wire->lsb_first) != 0 ||
            encode_bytes(spi, sizeof(spi), &spi_length, 26U, encoded_wire, wire_length) != 0) {
            return VDS_ERR_ARGUMENT;
        }
    }
    if (requested_rx_length > UINT32_MAX ||
        (requested_rx_length != 0U &&
         (encode_varint(spi, sizeof(spi), &spi_length, 32U) != 0 ||
          encode_varint(spi, sizeof(spi), &spi_length, requested_rx_length) != 0))) {
        return VDS_ERR_ARGUMENT;
    }

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        encode_varint(request, sizeof(request), &request_length, request_id) != 0 ||
        encode_bytes(request, sizeof(request), &request_length, 10U, spi, spi_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }

    const uint32_t network_length = htonl((uint32_t)request_length);
    if (write_all(client->fd, (const uint8_t *)&network_length, sizeof(network_length)) != 0 ||
        write_all(client->fd, request, request_length) != 0) {
        return VDS_ERR_IO;
    }

    uint32_t response_network_length = 0U;
    if (read_all(client->fd,
                 (uint8_t *)&response_network_length,
                 sizeof(response_network_length)) != 0) {
        return VDS_ERR_IO;
    }
    const uint32_t response_length = ntohl(response_network_length);
    if (response_length > VDS_MAX_FRAME_SIZE) {
        return VDS_ERR_PROTOCOL;
    }
    uint8_t *response = malloc(response_length == 0U ? 1U : response_length);
    if (response == NULL) {
        return VDS_ERR_IO;
    }
    if (read_all(client->fd, response, response_length) != 0) {
        free(response);
        return VDS_ERR_IO;
    }

    vds_status_t status = VDS_ERR_PROTOCOL;
    decoder_t decoder = {response, response_length, 0U};
    uint64_t response_request_id = 0U;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (decode_varint(&decoder, &tag) != 0) {
            break;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            if (decode_varint(&decoder, &response_request_id) != 0) {
                break;
            }
        } else if (field == 10U && wire_type == 2U) {
            decoder_t spi_response;
            if (decode_slice(&decoder, &spi_response) != 0) {
                break;
            }
            const int parsed = parse_spi_response(&spi_response, rx, rx_capacity, rx_length);
            status = parsed == 0 ? VDS_OK
                                 : (parsed == 1 ? VDS_ERR_BUFFER_TOO_SMALL : VDS_ERR_PROTOCOL);
        } else if (field == 11U && wire_type == 2U) {
            decoder_t error_response;
            if (decode_slice(&decoder, &error_response) != 0 ||
                parse_error_response(&error_response, error) != 0) {
                break;
            }
            status = VDS_ERR_SERVER;
        } else if (skip_field(&decoder, wire_type) != 0) {
            break;
        }
    }
    free(response);

    if (response_request_id != request_id) {
        return VDS_ERR_PROTOCOL;
    }
    return status;
}

vds_status_t vds_gpio_exchange(vds_client_t *client,
                               const char *device_id,
                               const uint8_t *host_values,
                               size_t line_count,
                               uint8_t *device_values,
                               size_t device_capacity,
                               size_t *device_count,
                               vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL ||
        host_values == NULL || line_count == 0U || device_values == NULL ||
        device_count == NULL || error == NULL || line_count > VDS_MAX_REQUEST_SIZE) {
        return VDS_ERR_ARGUMENT;
    }
    memset(error, 0, sizeof(*error));
    *device_count = 0U;

    uint8_t packed_values[VDS_MAX_REQUEST_SIZE];
    size_t packed_length = 0U;
    for (size_t index = 0U; index < line_count; ++index) {
        if (encode_varint(packed_values, sizeof(packed_values), &packed_length,
                          host_values[index] != 0U ? 1U : 0U) != 0) {
            return VDS_ERR_ARGUMENT;
        }
    }

    uint8_t gpio[VDS_MAX_REQUEST_SIZE];
    size_t gpio_length = 0U;
    if (encode_bytes(gpio, sizeof(gpio), &gpio_length, 1U,
                     (const uint8_t *)device_id, strlen(device_id)) != 0 ||
        encode_bytes(gpio, sizeof(gpio), &gpio_length, 2U, packed_values,
                     packed_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        encode_varint(request, sizeof(request), &request_length, request_id) != 0 ||
        encode_bytes(request, sizeof(request), &request_length, 11U, gpio,
                     gpio_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }

    const uint32_t network_length = htonl((uint32_t)request_length);
    if (write_all(client->fd, (const uint8_t *)&network_length,
                  sizeof(network_length)) != 0 ||
        write_all(client->fd, request, request_length) != 0) {
        return VDS_ERR_IO;
    }

    uint32_t response_network_length = 0U;
    if (read_all(client->fd, (uint8_t *)&response_network_length,
                 sizeof(response_network_length)) != 0) {
        return VDS_ERR_IO;
    }
    const uint32_t response_length = ntohl(response_network_length);
    if (response_length > VDS_MAX_FRAME_SIZE) {
        return VDS_ERR_PROTOCOL;
    }
    uint8_t *response = malloc(response_length == 0U ? 1U : response_length);
    if (response == NULL) {
        return VDS_ERR_IO;
    }
    if (read_all(client->fd, response, response_length) != 0) {
        free(response);
        return VDS_ERR_IO;
    }

    vds_status_t status = VDS_ERR_PROTOCOL;
    decoder_t decoder = {response, response_length, 0U};
    uint64_t response_request_id = 0U;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (decode_varint(&decoder, &tag) != 0) {
            break;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            if (decode_varint(&decoder, &response_request_id) != 0) {
                break;
            }
        } else if (field == 12U && wire_type == 2U) {
            decoder_t gpio_response;
            if (decode_slice(&decoder, &gpio_response) != 0) {
                break;
            }
            const int parsed = parse_gpio_response(
                &gpio_response, device_values, device_capacity, device_count);
            status = parsed == 0 ? VDS_OK
                                 : (parsed == 1 ? VDS_ERR_BUFFER_TOO_SMALL
                                                : VDS_ERR_PROTOCOL);
        } else if (field == 11U && wire_type == 2U) {
            decoder_t error_response;
            if (decode_slice(&decoder, &error_response) != 0 ||
                parse_error_response(&error_response, error) != 0) {
                break;
            }
            status = VDS_ERR_SERVER;
        } else if (skip_field(&decoder, wire_type) != 0) {
            break;
        }
    }
    free(response);
    if (response_request_id != request_id) {
        return VDS_ERR_PROTOCOL;
    }
    return status;
}

vds_status_t vds_i2c_transfer(vds_client_t *client,
                              const char *device_id,
                              uint16_t address,
                              const vds_i2c_message_t *messages,
                              size_t message_count,
                              uint8_t *read_data,
                              size_t read_capacity,
                              size_t *read_length,
                              vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL ||
        messages == NULL || message_count == 0U || read_data == NULL ||
        read_length == NULL || error == NULL || address > 0x3ffU) {
        return VDS_ERR_ARGUMENT;
    }
    memset(error, 0, sizeof(*error));
    *read_length = 0U;

    uint8_t i2c[VDS_MAX_REQUEST_SIZE];
    size_t i2c_length = 0U;
    if (encode_bytes(i2c, sizeof(i2c), &i2c_length, 1U,
                     (const uint8_t *)device_id, strlen(device_id)) != 0 ||
        encode_varint(i2c, sizeof(i2c), &i2c_length, 16U) != 0 ||
        encode_varint(i2c, sizeof(i2c), &i2c_length, address) != 0) {
        return VDS_ERR_ARGUMENT;
    }
    for (size_t index = 0U; index < message_count; ++index) {
        const vds_i2c_message_t *message = &messages[index];
        if ((!message->read && message->length > 0U && message->data == NULL) ||
            message->length > 1024U) {
            return VDS_ERR_ARGUMENT;
        }
        uint8_t encoded[1152];
        size_t encoded_length = 0U;
        if (message->read &&
            (encode_varint(encoded, sizeof(encoded), &encoded_length, 8U) != 0 ||
             encode_varint(encoded, sizeof(encoded), &encoded_length, 1U) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (!message->read && message->length > 0U &&
            encode_bytes(encoded, sizeof(encoded), &encoded_length, 2U,
                         message->data, message->length) != 0) {
            return VDS_ERR_ARGUMENT;
        }
        if (message->read &&
            (encode_varint(encoded, sizeof(encoded), &encoded_length, 24U) != 0 ||
             encode_varint(encoded, sizeof(encoded), &encoded_length,
                           message->length) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (message->flags != 0U &&
            (encode_varint(encoded, sizeof(encoded), &encoded_length, 32U) != 0 ||
             encode_varint(encoded, sizeof(encoded), &encoded_length,
                           message->flags) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (encode_bytes(i2c, sizeof(i2c), &i2c_length, 3U, encoded,
                         encoded_length) != 0) {
            return VDS_ERR_ARGUMENT;
        }
    }

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        encode_varint(request, sizeof(request), &request_length, request_id) != 0 ||
        encode_bytes(request, sizeof(request), &request_length, 12U, i2c,
                     i2c_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }
    const uint32_t network_length = htonl((uint32_t)request_length);
    if (write_all(client->fd, (const uint8_t *)&network_length,
                  sizeof(network_length)) != 0 ||
        write_all(client->fd, request, request_length) != 0) {
        return VDS_ERR_IO;
    }
    uint32_t response_network_length = 0U;
    if (read_all(client->fd, (uint8_t *)&response_network_length,
                 sizeof(response_network_length)) != 0) {
        return VDS_ERR_IO;
    }
    const uint32_t response_length = ntohl(response_network_length);
    if (response_length > VDS_MAX_FRAME_SIZE) {
        return VDS_ERR_PROTOCOL;
    }
    uint8_t *response = malloc(response_length == 0U ? 1U : response_length);
    if (response == NULL) {
        return VDS_ERR_IO;
    }
    if (read_all(client->fd, response, response_length) != 0) {
        free(response);
        return VDS_ERR_IO;
    }

    vds_status_t status = VDS_ERR_PROTOCOL;
    decoder_t decoder = {response, response_length, 0U};
    uint64_t response_request_id = 0U;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (decode_varint(&decoder, &tag) != 0) {
            break;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            if (decode_varint(&decoder, &response_request_id) != 0) {
                break;
            }
        } else if (field == 13U && wire_type == 2U) {
            decoder_t i2c_response;
            if (decode_slice(&decoder, &i2c_response) != 0) {
                break;
            }
            const int parsed = parse_i2c_response(
                &i2c_response, read_data, read_capacity, read_length);
            status = parsed == 0 ? VDS_OK
                                 : (parsed == 1 ? VDS_ERR_BUFFER_TOO_SMALL
                                                : VDS_ERR_PROTOCOL);
        } else if (field == 11U && wire_type == 2U) {
            decoder_t error_response;
            if (decode_slice(&decoder, &error_response) != 0 ||
                parse_error_response(&error_response, error) != 0) {
                break;
            }
            status = VDS_ERR_SERVER;
        } else if (skip_field(&decoder, wire_type) != 0) {
            break;
        }
    }
    free(response);
    if (response_request_id != request_id) {
        return VDS_ERR_PROTOCOL;
    }
    return status;
}
