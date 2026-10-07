# Getting started

This guide covers prerequisites, the development workspace, and the staged
build. Return to the [README](../../README.md) for the project overview.

## Prerequisites

- Rust 1.91.1, selected by `rust-toolchain.toml`
- Node.js and npm
- Protocol Buffers compiler (`protoc`)
- C11 compiler, Make, CMake, and pkg-config
- FUSE3 development files for CUSE adapters
- optional host compatibility tools: `i2c-tools`, `gpiod`, and `spi-tools`

Ubuntu/Debian:

```shell
sudo apt-get update
sudo apt-get install -y \
  build-essential cmake pkg-config libfuse3-dev protobuf-compiler \
  i2c-tools libi2c-dev \
  gpiod libgpiod-dev \
  spi-tools
```

Kernel-backed adapters additionally require the host's `cuse` or `gpio-sim`
module and operating-system authorization.

## Start the development workspace

From the repository root:

```shell
./dev.sh
```

For the usual local workflow, use the one-time-authorization launcher instead:

```shell
./run.sh
```

It requests your administrator password once through `sudo`, then uses that
short-lived authorization to start the SPI, I²C, and GPIO adapter helpers as
needed. Keep that terminal open: the authorization is tied to its development
session. The VDS4E server and Web UI still run as your normal user. Use
`VDS4E_ADAPTER_AUTH=pkexec ./run.sh` to retain separate Polkit prompts, or run
`./dev.sh` directly.

The script starts:

- Web UI: `http://127.0.0.1:4174`
- Control API: `http://127.0.0.1:8080/api/v1/health`
- Transaction data plane: `/tmp/vds4e.sock`

Keep the terminal open and press `Ctrl+C` to stop both processes. If port 4174
is occupied, either stop the existing workspace or select another UI port:

```shell
VDS_WEB_PORT=4200 ./dev.sh
```

`dev.sh` installs missing Web dependencies and prepares the development SPI and
I²C CUSE helpers. It is not the staged production build.

## Install a release package

GitHub Releases provide an `amd64` Debian package. After downloading the release
asset, install it with:

```shell
sudo apt install ./vds4e_<version>_amd64.deb
vds-server --config /etc/vds4e/vds-server.yaml --check-config
```

The package includes the server, CLI, host adapters, Web UI, schemas, bundled
device models, and example tools. It does not automatically load `cuse` or
`gpio-sim`; kernel-backed adapters still need the host modules and the same
privileges described above.

Each release also publishes a matching `.deb.sha256` file. Verify it with:

```shell
sha256sum --check vds4e_<version>_amd64.deb.sha256
```

## Staged build and installation

The root pipeline is deliberately ordered:

```shell
./configure
./build.sh
sudo ./install
```

- `./build.sh` refuses to run before a successful `./configure`.
- `./install` refuses to run before a successful `./build.sh`.
- all generated build output is stored under `build/`.
- `PREFIX` selects the installation prefix.
- `DESTDIR` stages a filesystem package.

Examples:

```shell
PREFIX="$HOME/.local" ./install
DESTDIR="$PWD/package-root" PREFIX=/usr ./install
```

Focused module builds remain available during development; the full root
pipeline does not need to run after every isolated change.


## Next steps

- [Build your first virtual I²C device](../tutorials/first-virtual-device.md).
- [Use the control-plane API and WebSocket event stream](api.md).
- Choose a host-interface guide: [SPI](spi.md), [I²C](i2c.md),
  [GPIO](gpio.md) or [UART](uart.md).
