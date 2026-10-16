# Ethernet TAP host adapter

Linux `/dev/net/tun` TAP helper for Ethernet II traffic. Opens `vdsN`
as a transient TAP device, connects to VDS4E's Unix-socket Protobuf data plane,
forwards complete Ethernet frames, and injects the response returned by the
declarative runtime.

The helper requires `CAP_NET_ADMIN` when creating the TAP interface.
Normal applications and tools access the interface through the Linux network
stack; they do not use the VDS4E C transport API.

Run it through the Web UI adapter manager, which owns startup, privileges and
cleanup. The executable accepts `--device-id`, `--socket`, `--ifname` or
`--bus-number`, and optionally `--parent-pid`. Its first stdout line is the
created interface name.

See [Ethernet guide](../../docs/guides/ethernet.md) for IP setup and `ping`
verification.
