#include "adapter_bridge_internal.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define VDS_ETHERNET_HEADER_SIZE 14U

// EthernetFrameResponse.frames is repeated bytes. For now one request may
// produce no frame or a single frame; accepting multiple would silently drop
// replies if the TAP helper only consumed the first one.
static int parse_frames(vds_decoder_t *payload, const uint8_t **frame,
                        size_t *frame_length) {
    bool has_frame = false;
    while (payload->offset < payload->length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(payload, &tag) != 0 || tag == 0U) return -1;
        const uint64_t field = tag >> 3U;
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U) {
            if (wire_type != 2U || has_frame) return -1;
            vds_decoder_t bytes;
            if (vds_bridge_decode_slice(payload, &bytes) != 0 ||
                bytes.length < VDS_ETHERNET_HEADER_SIZE ||
                bytes.length > VDS_ETHERNET_MAX_FRAME_SIZE) return -1;
            *frame = bytes.data;
            *frame_length = bytes.length;
            has_frame = true;
        } else if (vds_bridge_skip_field(payload, wire_type) != 0) {
            return -1;
        }
    }
    return 0;
}

vds_status_t vds_ethernet_exchange(vds_adapter_bridge_t *client,
                                   const char *device_id,
                                   const uint8_t *frame,
                                   size_t frame_length,
                                   uint8_t *response_frame,
                                   size_t response_capacity,
                                   size_t *response_length,
                                   vds_error_t *error) {
    if (client == NULL || client->fd < 0 || device_id == NULL ||
        device_id[0] == '\0' || frame == NULL || response_frame == NULL ||
        response_length == NULL || error == NULL ||
        frame_length < VDS_ETHERNET_HEADER_SIZE ||
        frame_length > VDS_ETHERNET_MAX_FRAME_SIZE) return VDS_ERR_ARGUMENT;

    memset(error, 0, sizeof(*error));
    *response_length = 0U;

    uint8_t ethernet[VDS_MAX_REQUEST_SIZE];
    size_t ethernet_length = 0U;
    if (vds_bridge_encode_bytes(ethernet, sizeof(ethernet), &ethernet_length,
                                1U, (const uint8_t *)device_id,
                                strlen(device_id)) != 0 ||
        vds_bridge_encode_bytes(ethernet, sizeof(ethernet), &ethernet_length,
                                2U, frame, frame_length) != 0)
        return VDS_ERR_ARGUMENT;

    uint8_t request[VDS_MAX_REQUEST_SIZE];
    size_t request_length = 0U;
    const uint64_t request_id = client->next_request_id;
    if (vds_bridge_encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
        vds_bridge_encode_varint(request, sizeof(request), &request_length,
                                 request_id) != 0 ||
        vds_bridge_encode_bytes(request, sizeof(request), &request_length,
                                14U, ethernet, ethernet_length) != 0)
        return VDS_ERR_ARGUMENT;
    ++client->next_request_id;

    uint8_t *response = NULL;
    size_t response_size = 0U;
    vds_status_t status = vds_bridge_exchange(client->fd, request,
                                              request_length, &response,
                                              &response_size);
    if (status != VDS_OK) return status;

    status = VDS_ERR_PROTOCOL;
    uint64_t response_id = 0U;
    bool has_request_id = false;
    bool has_result = false;
    bool has_error = false;
    const uint8_t *outbound_frame = NULL;
    size_t outbound_length = 0U;
    vds_decoder_t decoder = {response, response_size, 0U};
    bool valid = true;
    while (decoder.offset < decoder.length) {
        uint64_t tag = 0U;
        if (vds_bridge_decode_varint(&decoder, &tag) != 0 || tag == 0U) {
            valid = false;
            break;
        }
        const uint64_t field = tag >> 3U;
        const uint32_t wire_type = (uint32_t)(tag & 7U);
        if (field == 1U) {
            if (wire_type != 0U || has_request_id ||
                vds_bridge_decode_varint(&decoder, &response_id) != 0) {
                valid = false;
                break;
            }
            has_request_id = true;
        } else if (field == 15U) {
            vds_decoder_t payload;
            if (wire_type != 2U || has_result ||
                vds_bridge_decode_slice(&decoder, &payload) != 0 ||
                parse_frames(&payload, &outbound_frame, &outbound_length) != 0) {
                valid = false;
                break;
            }
            has_result = true;
        } else if (field == 11U) {
            vds_decoder_t payload;
            if (wire_type != 2U || has_error ||
                vds_bridge_decode_slice(&decoder, &payload) != 0 ||
                vds_bridge_parse_error(&payload, error) != 0) {
                valid = false;
                break;
            }
            has_error = true;
        } else if (vds_bridge_skip_field(&decoder, wire_type) != 0) {
            valid = false;
            break;
        }
    }

    if (valid && has_request_id && response_id == request_id &&
        (has_result != has_error)) {
        if (has_error) {
            status = VDS_ERR_SERVER;
        } else if (outbound_length > response_capacity) {
            *response_length = outbound_length;
            status = VDS_ERR_BUFFER_TOO_SMALL;
        } else {
            if (outbound_length > 0U)
                memcpy(response_frame, outbound_frame, outbound_length);
            *response_length = outbound_length;
            status = VDS_OK;
        }
    }
    free(response);
    return status;
}
