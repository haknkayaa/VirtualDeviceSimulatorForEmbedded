#include "adapter_bridge_internal.h"

#include <arpa/inet.h>
#include <errno.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

static int write_all(int fd, const uint8_t *data, size_t length) {
    while (length > 0U) {
        const ssize_t written = send(fd, data, length, MSG_NOSIGNAL);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return -1;
        data += (size_t)written;
        length -= (size_t)written;
    }
    return 0;
}

static int read_all(int fd, uint8_t *data, size_t length) {
    while (length > 0U) {
        const ssize_t received = read(fd, data, length);
        if (received < 0 && errno == EINTR) continue;
        if (received <= 0) return -1;
        data += (size_t)received;
        length -= (size_t)received;
    }
    return 0;
}

vds_status_t vds_bridge_exchange(int fd, const uint8_t *request,
                                 size_t request_length, uint8_t **response,
                                 size_t *response_length) {
    const uint32_t network_length = htonl((uint32_t)request_length);
    if (write_all(fd, (const uint8_t *)&network_length,
                  sizeof(network_length)) != 0 ||
        write_all(fd, request, request_length) != 0) return VDS_ERR_IO;

    uint32_t response_network_length = 0U;
    if (read_all(fd, (uint8_t *)&response_network_length,
                 sizeof(response_network_length)) != 0) return VDS_ERR_IO;
    const uint32_t frame_length = ntohl(response_network_length);
    if (frame_length > VDS_MAX_FRAME_SIZE) return VDS_ERR_PROTOCOL;

    uint8_t *frame = malloc(frame_length == 0U ? 1U : frame_length);
    if (frame == NULL) return VDS_ERR_IO;
    if (read_all(fd, frame, frame_length) != 0) {
        free(frame);
        return VDS_ERR_IO;
    }
    *response = frame;
    *response_length = frame_length;
    return VDS_OK;
}
