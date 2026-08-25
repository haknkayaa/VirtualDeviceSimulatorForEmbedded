#include "adapter_bridge_internal.h"

#include <stdlib.h>
#include <string.h>

static int parse_response(vds_decoder_t *decoder, uint8_t *rx,
                          size_t capacity, size_t *length) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(decoder, &tag) != 0) return -1;
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 2U) {
            vds_decoder_t bytes;
            if (vds_bridge_decode_slice(decoder, &bytes) != 0) return -1;
            *length = bytes.length;
            if (bytes.length > capacity) return 1;
            memcpy(rx, bytes.data, bytes.length);
        } else if (vds_bridge_skip_field(decoder, wire_type) != 0) return -1;
    }
    return 0;
}

static int encode_wire(uint8_t *buffer, size_t capacity, size_t *offset,
                       const vds_spi_wire_config_t *wire) {
    uint8_t data[128];
    size_t length = 0U;
    const uint64_t values[] = {
        8U, wire->mode, 16U, wire->bits_per_word, 24U, wire->max_speed_hz,
        32U, wire->command_width, 40U, wire->address_width,
        48U, wire->data_width, 56U, wire->rate, 64U, wire->dummy_cycles,
        72U, wire->lsb_first,
    };
    for (size_t index = 0U; index < sizeof(values) / sizeof(values[0]); ++index) {
        if (vds_bridge_encode_varint(data, sizeof(data), &length,
                                     values[index]) != 0) return -1;
    }
    return vds_bridge_encode_bytes(buffer, capacity, offset, 3U, data, length);
}

vds_status_t vds_spi_transfer_configured(vds_adapter_bridge_t *client,
                                         const char *device_id,
                                         const uint8_t *tx,
                                         size_t tx_length,
                                         size_t requested_rx_length,
                                         const vds_spi_wire_config_t *wire,
                                         uint8_t *rx, size_t rx_capacity,
                                         size_t *rx_length,
                                         vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL || tx == NULL ||
        wire == NULL || tx_length == 0U || rx == NULL || rx_length == NULL ||
        error == NULL) return VDS_ERR_ARGUMENT;
    memset(error, 0, sizeof(*error));
    *rx_length = 0U;

    uint8_t spi[VDS_MAX_REQUEST_SIZE];
    size_t spi_length = 0U;
    if (vds_bridge_encode_bytes(spi, sizeof(spi), &spi_length, 1U,
                                (const uint8_t *)device_id,
                                strlen(device_id)) != 0 ||
        vds_bridge_encode_bytes(spi, sizeof(spi), &spi_length, 2U,
                                tx, tx_length) != 0 ||
        encode_wire(spi, sizeof(spi), &spi_length, wire) != 0)
        return VDS_ERR_ARGUMENT;
    if (requested_rx_length > UINT32_MAX ||
        (requested_rx_length != 0U &&
         (vds_bridge_encode_varint(spi, sizeof(spi), &spi_length, 32U) != 0 ||
          vds_bridge_encode_varint(spi, sizeof(spi), &spi_length,
                                   requested_rx_length) != 0)))
        return VDS_ERR_ARGUMENT;

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id++;
    if (vds_bridge_encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        vds_bridge_encode_varint(request, sizeof(request), &request_length,
                                 request_id) != 0 ||
        vds_bridge_encode_bytes(request, sizeof(request), &request_length,
                                10U, spi, spi_length) != 0)
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
        } else if (field == 10U && wire_type == 2U) {
            vds_decoder_t payload;
            if (vds_bridge_decode_slice(&decoder, &payload) != 0) break;
            const int parsed = parse_response(&payload, rx, rx_capacity, rx_length);
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
