#include "adapter_bridge_internal.h"

#include <stdlib.h>
#include <string.h>

static int parse_response(vds_decoder_t *decoder, uint8_t *values,
                          size_t capacity, size_t *count) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(decoder, &tag) != 0) return -1;
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            vds_decoder_t packed;
            if (vds_bridge_decode_slice(decoder, &packed) != 0) return -1;
            size_t index = 0U;
            while (packed.offset < packed.length) {
                uint64_t value = 0U;
                if (vds_bridge_decode_varint(&packed, &value) != 0) return -1;
                if (index >= capacity) return 1;
                values[index++] = value != 0U ? 1U : 0U;
            }
            *count = index;
        } else if (vds_bridge_skip_field(decoder, wire_type) != 0) return -1;
    }
    return 0;
}

vds_status_t vds_gpio_exchange(vds_adapter_bridge_t *client,
                               const char *device_id,
                               const uint8_t *host_values,
                               const uint8_t *host_outputs,
                               size_t line_count, uint8_t *device_values,
                               size_t device_capacity, size_t *device_count,
                               vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL ||
        host_values == NULL || host_outputs == NULL || line_count == 0U ||
        device_values == NULL || device_count == NULL || error == NULL ||
        line_count > VDS_MAX_REQUEST_SIZE) return VDS_ERR_ARGUMENT;
    memset(error, 0, sizeof(*error));
    *device_count = 0U;

    uint8_t values[VDS_MAX_REQUEST_SIZE];
    uint8_t outputs[VDS_MAX_REQUEST_SIZE];
    size_t values_length = 0U;
    size_t outputs_length = 0U;
    for (size_t index = 0U; index < line_count; ++index) {
        if (vds_bridge_encode_varint(values, sizeof(values), &values_length,
                                     host_values[index] != 0U) != 0 ||
            vds_bridge_encode_varint(outputs, sizeof(outputs), &outputs_length,
                                     host_outputs[index] != 0U) != 0)
            return VDS_ERR_ARGUMENT;
    }

    uint8_t gpio[VDS_MAX_REQUEST_SIZE];
    size_t gpio_length = 0U;
    if (vds_bridge_encode_bytes(gpio, sizeof(gpio), &gpio_length, 1U,
                                (const uint8_t *)device_id,
                                strlen(device_id)) != 0 ||
        vds_bridge_encode_bytes(gpio, sizeof(gpio), &gpio_length, 2U,
                                values, values_length) != 0 ||
        vds_bridge_encode_bytes(gpio, sizeof(gpio), &gpio_length, 3U,
                                outputs, outputs_length) != 0)
        return VDS_ERR_ARGUMENT;

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (vds_bridge_encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        vds_bridge_encode_varint(request, sizeof(request), &request_length,
                                 request_id) != 0 ||
        vds_bridge_encode_bytes(request, sizeof(request), &request_length,
                                11U, gpio, gpio_length) != 0)
        return VDS_ERR_ARGUMENT;

    uint8_t *response = NULL;
    size_t response_length = 0U;
    vds_status_t status = vds_bridge_exchange(client->fd, request,
        request_length, &response, &response_length);
    if (status != VDS_OK) return status;
    status = VDS_ERR_PROTOCOL;
    vds_decoder_t decoder = {response, response_length, 0U};
    uint64_t response_id = 0U;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(&decoder, &tag) != 0) break;
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            if (vds_bridge_decode_varint(&decoder, &response_id) != 0) break;
        } else if (field == 12U && wire_type == 2U) {
            vds_decoder_t payload;
            if (vds_bridge_decode_slice(&decoder, &payload) != 0) break;
            const int parsed = parse_response(&payload, device_values,
                                               device_capacity, device_count);
            status = parsed == 0 ? VDS_OK :
                     (parsed == 1 ? VDS_ERR_BUFFER_TOO_SMALL : VDS_ERR_PROTOCOL);
        } else if (field == 11U && wire_type == 2U) {
            vds_decoder_t payload;
            if (vds_bridge_decode_slice(&decoder, &payload) != 0 ||
                vds_bridge_parse_error(&payload, error) != 0) break;
            status = VDS_ERR_SERVER;
        } else if (vds_bridge_skip_field(&decoder, wire_type) != 0) break;
    }
    free(response);
    return response_id == request_id ? status : VDS_ERR_PROTOCOL;
}
