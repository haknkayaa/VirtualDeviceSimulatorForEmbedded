# 0005: Linux SPI preload v1 ABI boundary

- Status: Accepted
- Date: 2026-07-23

## Context

Linux applications use `SPI_IOC_MESSAGE(N)` to submit one or more SPI transfer
segments under kernel-managed chip-select semantics. The current VDS4E data
plane carries one flat SPI byte request and one variable-length response. It
does not carry segment boundaries, chip-select changes, per-segment delays,
word sizes, lane widths, or speed overrides.

Flattening a multi-segment message would silently change Linux SPI semantics.
Adding device command knowledge to an ABI adapter would also violate the
architecture: device behavior belongs in the existing runtime.

## Decision

The first LD_PRELOAD SPI adapter supports `SPI_IOC_MESSAGE(1)` only.
`SPI_IOC_MESSAGE(N)` with `N > 1` returns `ENOTSUP`. Unsupported segment
features also return `ENOTSUP`.

The adapter sends the segment's complete transmitted byte sequence through the
existing C client and Unix socket data plane. A null transmit pointer produces
zero bytes, matching spidev.

The current runtime response is a payload, not a fixed-length full-duplex
sample stream. The adapter maps it into the Linux fixed-length receive buffer
using this transport-only rule:

1. Initialize all `len` receive bytes to zero.
2. If the payload is shorter than `len`, right-align it in the receive buffer.
3. If the payload is at least `len`, copy its first `len` bytes.

Thus a four-byte transfer `9F 00 00 00` with runtime payload `EF 40 18`
produces `00 EF 40 18`. The rule contains no opcode or device-specific logic.

Mapped opens return a real anonymous backing descriptor. Duplicates share one
reference-counted SPI configuration and serialized client connection. A
transport failure never causes the completed-or-unknown transfer to be retried;
the next transfer may reconnect.

## Alternatives

- **Flatten all message segments:** rejected because it loses chip-select,
  delay, and per-segment configuration semantics.
- **Infer command and dummy phases in the adapter:** rejected because this
  requires device-specific protocol knowledge.
- **Add a segmented Protobuf request now:** deferred until the runtime has a
  reviewed generic segmented SPI transaction model.
- **Use REST for transfers:** rejected because REST is the control plane; the
  Unix socket and Protobuf transport remain the application data plane.

## Consequences

Ordinary dynamically linked applications using the documented v1 subset run
without source changes. Multi-segment applications fail explicitly instead of
receiving subtly incorrect behavior. Response alignment is deterministic but
is a compatibility convention, not a complete electrical SPI model.

The adapter does not validate kernel drivers, controller timing, interrupts,
DMA, chip-select electrical behavior, or physical hardware.

## Migration impact

Existing Protobuf and C clients remain byte-for-byte compatible. A future
segmented request must be additive, preserve the existing `spi_transfer`
request, and be introduced through a new ADR before `SPI_IOC_MESSAGE(N > 1)`
is enabled.
