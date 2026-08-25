#include "adapter_bridge_internal.h"

#include <stdlib.h>
#include <string.h>

static int parse_i2c_response(vds_decoder_t *decoder, uint8_t *data,
                              size_t capacity, size_t *length) {
    size_t written = 0U;
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(decoder, &tag) != 0) {
            return -1;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            vds_decoder_t bytes;
            if (vds_bridge_decode_slice(decoder, &bytes) != 0) {
                return -1;
            }
            if (bytes.length > capacity - written) {
                *length = written + bytes.length;
                return 1;
            }
            memcpy(data + written, bytes.data, bytes.length);
            written += bytes.length;
        } else if (vds_bridge_skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    *length = written;
    return 0;
}
vds_status_t vds_i2c_transfer(vds_adapter_bridge_t *client,
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
    if (vds_bridge_encode_bytes(i2c, sizeof(i2c), &i2c_length, 1U,
                     (const uint8_t *)device_id, strlen(device_id)) != 0 ||
        vds_bridge_encode_varint(i2c, sizeof(i2c), &i2c_length, 16U) != 0 ||
        vds_bridge_encode_varint(i2c, sizeof(i2c), &i2c_length, address) != 0) {
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
            (vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length, 8U) != 0 ||
             vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length, 1U) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (!message->read && message->length > 0U &&
            vds_bridge_encode_bytes(encoded, sizeof(encoded), &encoded_length, 2U,
                         message->data, message->length) != 0) {
            return VDS_ERR_ARGUMENT;
        }
        if (message->read &&
            (vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length, 24U) != 0 ||
             vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length,
                           message->length) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (message->flags != 0U &&
            (vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length, 32U) != 0 ||
             vds_bridge_encode_varint(encoded, sizeof(encoded), &encoded_length,
                           message->flags) != 0)) {
            return VDS_ERR_ARGUMENT;
        }
        if (vds_bridge_encode_bytes(i2c, sizeof(i2c), &i2c_length, 3U, encoded,
                         encoded_length) != 0) {
            return VDS_ERR_ARGUMENT;
        }
    }

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (vds_bridge_encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        vds_bridge_encode_varint(request, sizeof(request), &request_length, request_id) != 0 ||
        vds_bridge_encode_bytes(request, sizeof(request), &request_length, 12U, i2c,
                     i2c_length) != 0) {
        return VDS_ERR_ARGUMENT;
    }
    uint8_t *response = NULL;
    size_t response_length = 0U;
    const vds_status_t exchange_status =
        vds_bridge_exchange(client->fd, request, request_length, &response,
                            &response_length);
    if (exchange_status != VDS_OK) {
        return exchange_status;
    }

    vds_status_t status = VDS_ERR_PROTOCOL;
    vds_decoder_t decoder = {response, response_length, 0U};
    uint64_t response_request_id = 0U;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(&decoder, &tag) != 0) {
            break;
        }
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            if (vds_bridge_decode_varint(&decoder, &response_request_id) != 0) {
                break;
            }
        } else if (field == 13U && wire_type == 2U) {
            vds_decoder_t i2c_response;
            if (vds_bridge_decode_slice(&decoder, &i2c_response) != 0) {
                break;
            }
            const int parsed = parse_i2c_response(
                &i2c_response, read_data, read_capacity, read_length);
            status = parsed == 0 ? VDS_OK
                                 : (parsed == 1 ? VDS_ERR_BUFFER_TOO_SMALL
                                                : VDS_ERR_PROTOCOL);
        } else if (field == 11U && wire_type == 2U) {
            vds_decoder_t error_response;
            if (vds_bridge_decode_slice(&decoder, &error_response) != 0 ||
                vds_bridge_parse_error(&error_response, error) != 0) {
                break;
            }
            status = VDS_ERR_SERVER;
        } else if (vds_bridge_skip_field(&decoder, wire_type) != 0) {
            break;
        }
    }
    free(response);
    if (response_request_id != request_id) {
        return VDS_ERR_PROTOCOL;
    }
    return status;
}
