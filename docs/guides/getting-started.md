# Getting started

This guide covers prerequisites, the development workspace, and the staged
build. Return to the [README](../../README.md) for the project overview.

## Prerequisites

Building or developing VDS4E from source requires:

- **C/C++ toolchain & libraries**: C11 compiler, Make, CMake, pkg-config, Protocol Buffers compiler (`protoc`), and FUSE3 (`libfuse3-dev`)
- **Rust toolchain & Cargo**: Rust 1.91.1 (selected by `rust-toolchain.toml`), installed via `rustup`
- **Node.js & npm**: Node.js 20+ (recommended: Node.js 22 LTS) for the Web UI
- **Host compatibility tools** (optional, for Linux ABI tests): `i2c-tools`, `gpiod`, and `spi-tools`

### 1. System packages (Ubuntu/Debian)

Install the C/C++ build tools, protobuf compiler, FUSE3 headers, and curl:

```shell
sudo apt-get update
sudo apt-get install -y \
  build-essential cmake pkg-config libfuse3-dev protobuf-compiler curl \
  i2c-tools libi2c-dev \
  gpiod libgpiod-dev \
  spi-tools
```

### 2. Rust and Cargo (`rustup`)

VDS4E pins Rust 1.91.1 with `clippy` and `rustfmt` in `rust-toolchain.toml`. Install the official Rust toolchain installer (`rustup`), which automatically selects the pinned toolchain when building in this repository:

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

Verify that Cargo and rustc are in your PATH:

```shell
cargo --version
rustc --version
```

### 3. Node.js and npm

The Web UI (`apps/vds-web`) requires modern Node.js (Node 20+ / Node 22 LTS). Install it via NodeSource or `nvm`:

**Via NodeSource:**

```shell
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Via nvm (Node Version Manager):**

```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

Verify that Node and npm are available:

```shell
node --version
npm --version
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

The development UI listens on `0.0.0.0` by default, allowing access from another
machine, such as a Windows PC on the same network. Start it on the Linux host with:

```shell
./run.sh
```

Open `http://<Linux-host-IP>:4174` on the other machine. Use `hostname -I` on
Linux to find its address; `0.0.0.0` is a listening address, not a browser
destination. API and WebSocket requests use the Web server's existing proxy,
so the control API can keep listening on loopback. The development UI gives
access to the control API without authentication; use this on a trusted network.
To restrict access to the Linux host, use `VDS_WEB_HOST=127.0.0.1 ./run.sh`.
If Linux runs in a VM, its network configuration must allow the Windows host
to reach port 4174 (for example, bridged networking or NAT port forwarding).

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
vds4e --check-config
vds4e
```

The package includes the server, CLI, host adapters, Web UI, schemas, bundled
device models, and example tools. It does not automatically load `cuse` or
`gpio-sim`; kernel-backed adapters still need the host modules and the same
privileges described above.

The packaged server serves the built Web UI at `http://127.0.0.1:8080/`.
A systemd unit is also installed; enable it explicitly with
`sudo systemctl enable --now vds4e` if a background service is preferred.

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
