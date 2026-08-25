#ifndef VDS4E_ADAPTER_BRIDGE_INTERNAL_H
#define VDS4E_ADAPTER_BRIDGE_INTERNAL_H

#include "adapter_bridge.h"

#define VDS_MAX_FRAME_SIZE (1024U * 1024U)
#define VDS_MAX_REQUEST_SIZE 4096U

typedef struct {
    const uint8_t *data;
    size_t length;
    size_t offset;
} vds_decoder_t;

int vds_bridge_encode_varint(uint8_t *buffer, size_t capacity,
                             size_t *offset, uint64_t value);
int vds_bridge_encode_bytes(uint8_t *buffer, size_t capacity,
                            size_t *offset, uint32_t field,
                            const uint8_t *data, size_t length);
int vds_bridge_decode_varint(vds_decoder_t *decoder, uint64_t *value);
int vds_bridge_decode_slice(vds_decoder_t *decoder, vds_decoder_t *slice);
int vds_bridge_skip_field(vds_decoder_t *decoder, uint32_t wire_type);
int vds_bridge_parse_error(vds_decoder_t *decoder, vds_error_t *error);
vds_status_t vds_bridge_exchange(int fd, const uint8_t *request,
                                 size_t request_length, uint8_t **response,
                                 size_t *response_length);

#endif
