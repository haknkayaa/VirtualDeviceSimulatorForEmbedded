#include "adapter_bridge.h"

#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

vds_status_t vds_adapter_bridge_connect(vds_adapter_bridge_t *client,
                                        const char *socket_path) {
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

void vds_adapter_bridge_close(vds_adapter_bridge_t *client) {
    if (client != NULL && client->fd >= 0) {
        (void)close(client->fd);
        client->fd = -1;
    }
}
