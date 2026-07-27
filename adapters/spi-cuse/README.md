# Linux SPI CUSE adapter

`vds4e-spi-cuse` creates a real character device such as
`/dev/spidev0.0`. Dynamically and statically linked applications can open that
node normally; no `LD_PRELOAD` configuration is required. Linux spidev ioctls
are forwarded to a VDS4E runtime device over the existing Unix socket data
plane.

## Requirements

- Linux with the `cuse` kernel module
- FUSE3 development files (`fuse3` through `pkg-config`)
- root privileges to load CUSE and run the daemon

## Build

```sh
cmake -S adapters/spi-cuse -B build/spi-cuse
cmake --build build/spi-cuse
ctest --test-dir build/spi-cuse --output-on-failure
```

## Run

Start `vds-server`, then in a second terminal:

```sh
sudo modprobe cuse
sudo build/spi-cuse/vds4e-spi-cuse \
  --name spidev0.0 \
  --device-id spi-flash-0 \
  --socket /tmp/vds4e.sock
```

While the daemon is running:

```sh
ls -l /dev/spidev0.0
sudo build/spi-preload/native-spidev-read-id /dev/spidev0.0
```

The node is removed automatically when the daemon stops. Its default
permissions are controlled by the host's device manager. Use an appropriate
udev rule for persistent non-root access; do not make production device nodes
world-writable.

## Supported ABI

The CUSE adapter intentionally matches the SPI preload v1 subset:

- mode 0
- 8 bits per word
- MSB first
- positive maximum-speed configuration
- `SPI_IOC_MESSAGE(0)` and `SPI_IOC_MESSAGE(1)`
- transfers up to 3900 bytes

`read()`, `write()`, multi-transfer messages, nonzero delay/chip-select
changes, multi-lane fields, MODE32 ioctls, and 32-bit compatibility ioctls are
not supported.
