#include <stdlib.h>
#include <string.h>

#include "adapter_bridge_internal.h"

vds_status_t vds_uart_transfer(vds_adapter_bridge_t *client, const char *device_id, const uint8_t *tx, size_t tx_length, uint8_t *rx,
                               size_t rx_capacity, size_t *rx_length, vds_error_t *error) {
	if (client == NULL || client->fd < 0 || device_id == NULL || tx == NULL || tx_length == 0U || rx == NULL || rx_length == NULL || error == NULL) {
		return VDS_ERR_ARGUMENT;
	}
	memset(error, 0, sizeof(*error));
	*rx_length = 0U;

	uint8_t uart[VDS_MAX_REQUEST_SIZE];
	size_t uart_length = 0U;
	if (vds_bridge_encode_bytes(uart, sizeof(uart), &uart_length, 1U, (const uint8_t *) device_id, strlen(device_id)) != 0 ||
	    vds_bridge_encode_bytes(uart, sizeof(uart), &uart_length, 2U, tx, tx_length) != 0) {
		return VDS_ERR_ARGUMENT;
	}

	uint8_t request[VDS_MAX_REQUEST_SIZE];
	size_t request_length = 0U;
	const uint64_t request_id = client->next_request_id++;
	if (vds_bridge_encode_varint(request, sizeof(request), &request_length, 8U) != 0 ||
	    vds_bridge_encode_varint(request, sizeof(request), &request_length, request_id) != 0 ||
	    vds_bridge_encode_bytes(request, sizeof(request), &request_length, 13U, uart, uart_length) != 0) {
		return VDS_ERR_ARGUMENT;
	}

	uint8_t *response = NULL;
	size_t response_length = 0U;
	vds_status_t status = vds_bridge_exchange(client->fd, request, request_length, &response, &response_length);
	if (status != VDS_OK) return status;

	status = VDS_ERR_PROTOCOL;
	uint64_t response_request_id = 0U;
	vds_decoder_t decoder = { response, response_length, 0U };
	while (decoder.offset < decoder.length) {
		uint64_t tag = 0U;
		if (vds_bridge_decode_varint(&decoder, &tag) != 0) break;
		const uint32_t field = (uint32_t) (tag >> 3U);
		const uint32_t wire_type = (uint32_t) (tag & 7U);
		if (field == 1U && wire_type == 0U) {
			if (vds_bridge_decode_varint(&decoder, &response_request_id) != 0) break;
		} else if (field == 14U && wire_type == 2U) {
			vds_decoder_t uart_response;
			if (vds_bridge_decode_slice(&decoder, &uart_response) != 0) break;
			status = VDS_OK;
			while (uart_response.offset < uart_response.length) {
				uint64_t inner_tag = 0U;
				if (vds_bridge_decode_varint(&uart_response, &inner_tag) != 0) break;
				if ((inner_tag >> 3U) == 1U && (inner_tag & 7U) == 2U) {
					vds_decoder_t bytes;
					if (vds_bridge_decode_slice(&uart_response, &bytes) != 0) break;
					*rx_length = bytes.length;
					if (bytes.length > rx_capacity) {
						status = VDS_ERR_BUFFER_TOO_SMALL;
					} else {
						memcpy(rx, bytes.data, bytes.length);
						status = VDS_OK;
					}
				} else if (vds_bridge_skip_field(&uart_response, (uint32_t) (inner_tag & 7U)) != 0) {
					break;
				}
			}
		} else if (field == 11U && wire_type == 2U) {
			vds_decoder_t error_response;
			if (vds_bridge_decode_slice(&decoder, &error_response) != 0 || vds_bridge_parse_error(&error_response, error) != 0) break;
			status = VDS_ERR_SERVER;
		} else if (vds_bridge_skip_field(&decoder, wire_type) != 0) {
			break;
		}
	}
	free(response);
	return response_request_id == request_id ? status : VDS_ERR_PROTOCOL;
}
