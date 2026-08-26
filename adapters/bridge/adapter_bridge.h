#ifndef VDS4E_ADAPTER_BRIDGE_H
#define VDS4E_ADAPTER_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// @brief Connection state for the VDS4E Unix-socket transaction data plane.
/// Initialize an instance with vds_adapter_bridge_connect() and release its
/// file descriptor with vds_adapter_bridge_close(). The bridge serializes
/// requests on the supplied connection; callers must provide synchronization
/// when sharing an instance between threads.
typedef struct {
    int fd;                   // Connected Unix-socket descriptor, or -1.
    uint64_t next_request_id; // Identifier assigned to the next request.
} vds_adapter_bridge_t;

/// @brief Result codes returned by adapter bridge operations.
typedef enum {
    VDS_OK = 0,                    // Operation completed successfully.
    VDS_ERR_ARGUMENT = -1,         // An argument or connection state is invalid.
    VDS_ERR_IO = -2,               // Socket, allocation, or stream I/O failed.
    VDS_ERR_PROTOCOL = -3,         // The data-plane response is malformed or mismatched.
    VDS_ERR_SERVER = -4,           // The VDS4E runtime returned a typed error.
    VDS_ERR_BUFFER_TOO_SMALL = -5  // An output buffer cannot hold the response.
} vds_status_t;

/// @brief Typed error information returned by the VDS4E runtime.
typedef struct {
    int code;          // Runtime error code.
    char message[256]; // Null-terminated diagnostic message.
} vds_error_t;

/// @brief Number of active data lanes used by an SPI transfer phase.
typedef enum {
    VDS_SPI_LANE_SINGLE = 1, // One data lane.
    VDS_SPI_LANE_DUAL = 2,   // Two data lanes.
    VDS_SPI_LANE_QUAD = 4    // Four data lanes.
} vds_spi_lane_width_t;

/// @brief Clocking rate used by an SPI transfer.
typedef enum {
    VDS_SPI_RATE_STR = 1, // Single transfer rate.
    VDS_SPI_RATE_DTR = 2  // Double transfer rate.
} vds_spi_transfer_rate_t;

/// @brief Bus configuration accompanying a configured SPI transaction.
typedef struct {
    uint8_t mode;                       // Linux SPI mode flags.
    uint8_t bits_per_word;              // Bits transferred per word.
    uint64_t max_speed_hz;              // Maximum bus clock in hertz.
    vds_spi_lane_width_t command_width; // Lane width of the command phase.
    vds_spi_lane_width_t address_width; // Lane width of the address phase.
    vds_spi_lane_width_t data_width;    // Lane width of the data phase.
    vds_spi_transfer_rate_t rate;       // STR or DTR clocking rate.
    uint16_t dummy_cycles;              // Dummy cycles before data transfer.
    uint8_t lsb_first;                  // Nonzero when words are LSB-first.
} vds_spi_wire_config_t;

/// @brief One message in an atomic Linux I2C transfer.
typedef struct {
    uint8_t read;        // Nonzero for a read message; zero for a write.
    const uint8_t *data; // Write payload; ignored for read messages.
    size_t length;       //  Write length or requested read length.
    uint16_t flags;      // Linux I2C message flags forwarded to the runtime.
} vds_i2c_message_t;

/// @brief Connect a bridge client to the VDS4E transaction data plane.
/// @param client Client state initialized on success.
/// @param socket_path Path of the VDS4E Unix-domain socket.
/// @return VDS_OK on success, VDS_ERR_ARGUMENT for invalid input, or
///         VDS_ERR_IO when the socket cannot be created or connected.
vds_status_t vds_adapter_bridge_connect(vds_adapter_bridge_t *client, const char *socket_path);

/// @brief Close a bridge connection.
/// Calling this function with NULL or an already-closed client is safe.
/// @param client Client to close.
void vds_adapter_bridge_close(vds_adapter_bridge_t *client);

/// @brief Execute a configured SPI transaction against a virtual device.
/// @param client Connected bridge client.
/// @param device_id Runtime device identifier.
/// @param tx Bytes transmitted on the SPI bus.
/// @param tx_length Number of bytes in @p tx; must be nonzero.
/// @param requested_rx_length Number of response bytes requested from the runtime.
/// @param wire SPI bus and wire configuration.
/// @param rx Buffer receiving the returned bytes.
/// @param rx_capacity Capacity of @p rx in bytes.
/// @param rx_length Number of bytes written to @p rx.
/// @param error Typed runtime error when VDS_ERR_SERVER is returned.
/// @return A vds_status_t result code.
vds_status_t vds_spi_transfer_configured(vds_adapter_bridge_t *client,
                                         const char *device_id,
                                         const uint8_t *tx,
                                         size_t tx_length,
                                         size_t requested_rx_length,
                                         const vds_spi_wire_config_t *wire,
                                         uint8_t *rx,
                                         size_t rx_capacity,
                                         size_t *rx_length,
                                         vds_error_t *error);

/// @brief Exchange host and virtual-device GPIO line states atomically.
/// @param client Connected bridge client.
/// @param device_id Runtime device identifier.
/// @param host_values Current host-visible line values.
/// @param host_outputs Per-line output indicators; nonzero means output.
/// @param line_count Number of entries in both host arrays.
/// @param device_values Buffer receiving virtual-device line values.
/// @param device_capacity Capacity of @p device_values in bytes.
/// @param device_count Number of values written to @p device_values.
/// @param error Typed runtime error when VDS_ERR_SERVER is returned.
/// @return A vds_status_t result code.
vds_status_t vds_gpio_exchange(vds_adapter_bridge_t *client,
                               const char *device_id,
                               const uint8_t *host_values,
                               const uint8_t *host_outputs,
                               size_t line_count,
                               uint8_t *device_values,
                               size_t device_capacity,
                               size_t *device_count,
                               vds_error_t *error);

/// @brief Execute an ordered, atomic I2C message sequence.
/// Read payloads are concatenated into @p read_data in message order.
/// @param client Connected bridge client.
/// @param device_id Runtime device identifier.
/// @param address Seven-bit or ten-bit I2C slave address.
/// @param messages Ordered message array.
/// @param message_count Number of messages; must be nonzero.
/// @param read_data Buffer receiving concatenated read payloads.
/// @param read_capacity Capacity of @p read_data in bytes.
/// @param read_length Number of bytes written to @p read_data.
/// @param error Typed runtime error when VDS_ERR_SERVER is returned.
/// @return A vds_status_t result code.
vds_status_t vds_i2c_transfer(vds_adapter_bridge_t *client,
                              const char *device_id,
                              uint16_t address,
                              const vds_i2c_message_t *messages,
                              size_t message_count,
                              uint8_t *read_data,
                              size_t read_capacity,
                              size_t *read_length,
                              vds_error_t *error);

/// @brief Forward bytes received from a UART PTY and collect device bytes.
vds_status_t vds_uart_transfer(vds_adapter_bridge_t *client,
                               const char *device_id,
                               const uint8_t *tx,
                               size_t tx_length,
                               uint8_t *rx,
                               size_t rx_capacity,
                               size_t *rx_length,
                               vds_error_t *error);

#ifdef __cplusplus
}
#endif

#endif
