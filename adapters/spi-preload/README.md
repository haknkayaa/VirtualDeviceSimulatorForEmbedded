# Linux SPI ABI adapter

`libvds4e-spi-preload.so` lets a dynamically linked Linux program use the
documented subset of `spidev` against VDS4E without including a VDS4E header or
calling its client API. The library intercepts mapped `open`, `ioctl`,
descriptor-duplication, and `close` calls. SPI traffic continues to use the
existing Unix-domain-socket and Protobuf data plane.

The adapter contains no opcodes, registers, device timing, state-machine
behavior, or fault behavior. Those remain authoritative in the VDS4E runtime.

## Build and test

```sh
cmake -S adapters/spi-preload -B build/spi-preload
cmake --build build/spi-preload
ctest --test-dir build/spi-preload --output-on-failure
```

To include the end-to-end test against a previously built server:

```sh
cargo build -p vds-server
cmake -S adapters/spi-preload -B build/spi-preload \
  -DVDS4E_SERVER_EXECUTABLE="$PWD/target/debug/vds-server"
cmake --build build/spi-preload
ctest --test-dir build/spi-preload --output-on-failure
```

Sanitizer-enabled unit tests can be built with
`-DVDS4E_SPI_PRELOAD_SANITIZERS=ON`. Preloading an ASan-instrumented library
may require the ASan runtime to appear first in `LD_PRELOAD`.

## Run a native application

```sh
VDS4E_SPI_MAP='/dev/spidev0.0=micron-mt25ql256aba8esf-0sit' \
VDS4E_SOCKET=/tmp/vds4e.sock \
LD_PRELOAD="$PWD/build/spi-preload/libvds4e-spi-preload.so" \
./ordinary-linux-application
```

`VDS4E_SPI_MAP` is a semicolon-separated list of exact mappings:

```text
/dev/spidev0.0=micron-mt25ql256aba8esf-0sit;/dev/spidev0.1=adc-0
```

Paths must have the canonical `/dev/spidev<bus>.<chip-select>` form. Duplicate
paths, empty device IDs, invalid characters, oversized values, and malformed
entries invalidate the mapping. `VDS4E_SOCKET` defaults to
`/tmp/vds4e.sock`.

Diagnostics are quiet by default. Set `VDS4E_PRELOAD_LOG=1` for bounded
operational messages. Payloads are never logged by the v1 implementation.

## Supported ABI subset

The adapter supports:

- `open`, `open64`, `close`, `dup`, `dup2`, `dup3`
- `fcntl` duplication through `F_DUPFD` and `F_DUPFD_CLOEXEC`
- mode read/write for mode 0
- bits-per-word read/write for 8 bits (`0` is accepted as the Linux alias)
- max-speed read/write for positive values
- bit-order read/write for MSB first
- `SPI_IOC_MESSAGE(0)` and `SPI_IOC_MESSAGE(1)`

One transfer is synchronous and serialized with all duplicates of the same
virtual descriptor. Different descriptors may be used concurrently. A
single transfer is bounded to 3900 bytes so its device ID and Protobuf
envelope remain within the existing C client's request limit. Configured and
per-transfer speed values are retained for ABI compatibility but do not model
electrical clock timing. A transport failure returns `EIO`, invalidates that
connection, and is never retried. A later transfer may reconnect. Initial connection failure returns
`ENOTCONN`.

The current runtime returns a variable-length payload, while Linux SPI always
clocks a fixed transfer length. V1 initializes RX to zero and right-aligns a
short runtime payload. A payload longer than RX is truncated from its end by
retaining the first `len` bytes. For example:

```text
TX: 9F 00 00 00
runtime payload: 20 BA 19
RX: 00 20 BA 19
```

This is a deterministic compatibility convention, not an electrical SPI
model. Null TX clocks zero bytes; null RX discards the result.

The following are deliberately unsupported:

- `SPI_IOC_MESSAGE(N)` for `N > 1` (`ENOTSUP`)
- nonzero chip-select changes, transfer/word delays, or multi-lane fields
- modes other than mode 0, LSB-first, or word sizes other than 8 bits
- `read()` and `write()` transfers, `openat`, and MODE32 ioctls

## Error mapping

Important runtime mappings are:

- unknown device: `ENODEV`
- invalid request or configuration: `EINVAL`
- unsupported ioctl: `ENOTTY`
- unsupported transfer feature: `ENOTSUP`
- runtime timeout: `ETIMEDOUT`
- runtime busy: `EBUSY`
- transport disconnect after submission: `EIO`
- initial connection failure: `ENOTCONN`

Other structured runtime errors are mapped deterministically to `EPROTO`,
`EACCES`, `ERANGE`, or `EIO`.

## Limitations and troubleshooting

`LD_PRELOAD` only affects compatible dynamically linked programs. It does not
work for static binaries, is restricted for secure-execution/setuid programs,
and may be bypassed by applications that issue direct syscalls or call
unintercepted APIs such as `openat`. Inherited connections across `fork()` are
not supported; open the virtual descriptor in the child.

If an open is not intercepted, verify that its path exactly matches the map
and that the application calls `open` or `open64`. If a transfer returns
`ENOTCONN`, verify the Unix socket path and that `vds-server` is running. Enable
`VDS4E_PRELOAD_LOG=1` for diagnostics.

This adapter validates application-to-simulator integration only. It does not
validate a real kernel SPI controller driver, DMA, interrupts, chip-select
electrical behavior, signal integrity, voltage levels, or physical hardware.
