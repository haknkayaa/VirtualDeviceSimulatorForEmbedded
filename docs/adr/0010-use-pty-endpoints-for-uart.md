# ADR 0010: Use pseudoterminal endpoints for UART integration

## Status

Accepted

## Context

Embedded Linux applications normally access UARTs through the TTY API using
`open`, `read`, `write`, and termios. A simulator-specific serial API would
require application changes, while a userspace PTY already provides the
relevant standard Linux byte-stream interface without kernel privileges.

UART is a stream rather than a transaction-framed bus. PTY reads may split one
application write or combine several writes, so runtime behavior cannot depend
on adapter read boundaries.

## Decision

One loaded UART adapter owns one pseudoterminal pair and binds exactly one UART
runtime device. The adapter reports the kernel-assigned slave path such as
`/dev/pts/7`; unmodified applications open that path and configure it through
termios. A managed, unprivileged helper reads the PTY master, forwards byte
chunks over the framed Protobuf data plane, and writes returned bytes back to
the master.

The first `generic-uart-responder` runtime incrementally buffers received bytes
and matches declarative request sequences independent of PTY chunk boundaries.
Request patterns are unique and prefix-free so matching remains deterministic.
Baud rate, data bits, parity, and stop bits document the intended interface but
do not introduce wall-clock bit timing.

## Consequences

- Applications use the standard Linux TTY API without VDS4E headers or mocks.
- UART adapters require no CUSE module, configfs access, or elevated process.
- The runtime, not the PTY helper, owns device-specific request/response rules.
- The v1 slice does not model electrical timing, parity/framing errors, breaks,
  modem-control pins, or unsolicited runtime output.
- The assigned `/dev/pts/N` path is ephemeral and is rediscovered after every
  adapter load.
