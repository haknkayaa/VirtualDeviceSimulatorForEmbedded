# ADR 0006: Manage host adapters as top-level resources

## Status

Accepted

## Context

Runtime devices and host bus endpoints have different lifecycles. One SPI
controller can expose several chip-select endpoints, one I2C controller can
address several devices, and one GPIO chip owns several lines. Treating a
host adapter as a property inside one device prevents correct multi-device
topology and makes privileged driver lifecycle operations ambiguous.

Browser-delivered sudo passwords would also cross the web/control-plane trust
boundary and must not be accepted or stored by VDS4E.

## Decision

Adapters are top-level control-plane resources. A device may have at most one
adapter binding, while an adapter may own several unique endpoints.

The v1 REST surface is:

- `GET /api/v1/adapters`
- `POST /api/v1/adapters`
- `POST /api/v1/adapters/{id}/bindings`
- `DELETE /api/v1/adapters/{id}/bindings/{device_id}`
- `POST /api/v1/adapters/{id}/load`
- `POST /api/v1/adapters/{id}/unload`

Topology can change only while an adapter is unloaded. The SPI CUSE driver
starts one managed daemon per binding, producing paths such as
`/dev/spidev0.0` and `/dev/spidev0.1`. Process identifiers and startup errors
are reflected in adapter snapshots.

The I²C CUSE driver starts one daemon per bus, producing `/dev/i2c-N`. Every
binding on that adapter is passed to the daemon as a unique slave-address to
device-ID mapping. Address selection through `I2C_SLAVE` is local to each open
file descriptor, while `I2C_RDWR` preserves Linux combined-message ordering in
one atomic runtime request. Bus topology changes require unloading the daemon.

Privileged operations remain behind the adapter-driver boundary. The HTTP API
returns `adapter_authorization_required` when the server cannot access CUSE.
The UI presents an authorization-required dialog but never contains a
password field. Production installation should grant the narrowly scoped
helper through Polkit or a root-owned system service.

The local simulator persists logical adapter topology in
`~/.vds4e/adapters.json`. `VDS4E_ADAPTER_STATE` may override that location.
Writes replace the file atomically. The store includes adapter configuration,
bindings, and whether an adapter should be loaded on the next start; it does
not persist process IDs or kernel-assigned device paths. After the Unix-socket
data plane is ready, startup recreates adapters marked for loading and
rediscovers their actual host paths.

## Consequences

- Several devices can share one logical SPI adapter through distinct
  chip-select endpoints.
- Several devices can share one logical I²C adapter through distinct slave
  addresses, and standard `i2c-tools` remain the compatibility clients.
- Device configuration views resolve their host path from authoritative
  adapter bindings instead of assuming `/dev/spidev0.0`.
- Load/unload and attach/detach are independently testable through a fake
  adapter driver without changing the host.
- Adapter topology and bindings survive local server restarts. Runtime process
  state remains ephemeral and is reconstructed from the stored load intent.
- An unreadable, malformed, or unsupported topology file stops startup instead
  of silently discarding the user's configuration.
