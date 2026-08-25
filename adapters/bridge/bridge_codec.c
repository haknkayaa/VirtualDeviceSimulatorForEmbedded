#include "adapter_bridge_internal.h"

#include <string.h>

int vds_bridge_encode_varint(uint8_t *buffer, size_t capacity,
                             size_t *offset, uint64_t value) {
    do {
        if (*offset >= capacity) return -1;
        uint8_t byte = (uint8_t)(value & 0x7FU);
        value >>= 7U;
        if (value != 0U) byte |= 0x80U;
        buffer[(*offset)++] = byte;
    } while (value != 0U);
    return 0;
}

int vds_bridge_encode_bytes(uint8_t *buffer, size_t capacity,
                            size_t *offset, uint32_t field,
                            const uint8_t *data, size_t length) {
    if (vds_bridge_encode_varint(buffer, capacity, offset,
                                 ((uint64_t)field << 3U) | 2U) != 0 ||
        vds_bridge_encode_varint(buffer, capacity, offset, length) != 0 ||
        length > capacity - *offset) return -1;
    memcpy(buffer + *offset, data, length);
    *offset += length;
    return 0;
}

int vds_bridge_decode_varint(vds_decoder_t *decoder, uint64_t *value) {
    *value = 0U;
    for (unsigned shift = 0U; shift < 64U; shift += 7U) {
        if (decoder->offset >= decoder->length) return -1;
        const uint8_t byte = decoder->data[decoder->offset++];
        *value |= (uint64_t)(byte & 0x7FU) << shift;
        if ((byte & 0x80U) == 0U) return 0;
    }
    return -1;
}

int vds_bridge_decode_slice(vds_decoder_t *decoder, vds_decoder_t *slice) {
    uint64_t length = 0U;
    if (vds_bridge_decode_varint(decoder, &length) != 0 ||
        length > decoder->length - decoder->offset) return -1;
    slice->data = decoder->data + decoder->offset;
    slice->length = (size_t)length;
    slice->offset = 0U;
    decoder->offset += (size_t)length;
    return 0;
}

int vds_bridge_skip_field(vds_decoder_t *decoder, uint32_t wire_type) {
    uint64_t ignored = 0U;
    vds_decoder_t slice;
    if (wire_type == 0U) return vds_bridge_decode_varint(decoder, &ignored);
    if (wire_type == 2U) return vds_bridge_decode_slice(decoder, &slice);
    return -1;
}

int vds_bridge_parse_error(vds_decoder_t *decoder, vds_error_t *error) {
    while (decoder->offset < decoder->length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(decoder, &tag) != 0) return -1;
        const uint32_t field = (uint32_t)(tag >> 3U);
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U && wire_type == 0U) {
            uint64_t code = 0U;
            if (vds_bridge_decode_varint(decoder, &code) != 0) return -1;
            error->code = (int)code;
        } else if (field == 2U && wire_type == 2U) {
            vds_decoder_t message;
            if (vds_bridge_decode_slice(decoder, &message) != 0) return -1;
            const size_t copy_length = message.length < sizeof(error->message) - 1U
                                           ? message.length
                                           : sizeof(error->message) - 1U;
            memcpy(error->message, message.data, copy_length);
            error->message[copy_length] = '\0';
        } else if (vds_bridge_skip_field(decoder, wire_type) != 0) {
            return -1;
        }
    }
    return 0;
}
