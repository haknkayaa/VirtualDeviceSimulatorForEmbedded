# Testing VDS4E

VDS4E has several test layers because no single test proves both device-model
semantics and Linux ABI compatibility.

## Fast local checks

Run these from the repository root before handing off a change:

```shell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked

npm --prefix apps/vds-web ci
npm --prefix apps/vds-web run lint
npm --prefix apps/vds-web run typecheck
npm --prefix apps/vds-web run test:run
npm --prefix apps/vds-web run build
```

The Rust tests cover model parsing, register/state behavior, scheduling,
scenarios, event handling and server integration. The Web checks cover
TypeScript, linting, component behavior and production bundling.

## Native adapters and C examples

The regular GitHub workflow also builds the Linux adapters in normal and
ASan/UBSan configurations and runs their CTest suites. To exercise the complete
root build locally:

```shell
./configure
./build.sh
```

The root build includes the native adapters and bundled example applications.
Use focused CMake builds while developing one adapter; use the root build before
a release or when changes span multiple components.

## Configuration validation

Validate the repository example configuration with:

```shell
cargo run --locked -p vds-server -- \
  --config config/vds-server.yaml \
  --check-config
```

Device-package authors should also validate the package directly:

```shell
cargo run --locked -p vds-cli -- device-package validate ./path/to/package
```

## Real Linux ABI end-to-end tests

The privileged signal tests under `tests/e2e/drdy/` exercise actual Linux
userspace interfaces rather than a simulator-specific client.

They cover these chains:

```text
SPI sensor -> signal router -> gpio-sim -> /dev/gpiochipN -> gpiomon
          -> /dev/spidevX.Y read -> read-clear -> falling GPIO edge

I2C sensor -> signal router -> gpio-sim -> /dev/gpiochipN -> gpiomon
          -> /dev/i2c-N read -> read-clear -> falling GPIO edge
```

The application-side tools are unmodified distribution tools such as
`spidev_test`, `i2cdetect`, `i2cget`, `i2ctransfer`, `gpioget` and
`gpiomon`.

Run directly on a suitable Linux host:

```shell
sudo -E env "PATH=$PATH" tests/e2e/drdy/run-native.sh
```

Or run the QEMU harness when the host kernel does not provide the required
CUSE/gpio-sim environment:

```shell
sudo -E env "PATH=$PATH" tests/e2e/drdy/run-qemu.sh
```

See [the E2E README](../../tests/e2e/drdy/README.md) for host requirements.

## GitHub Actions policy

The normal **Build and Test** workflow runs automatically on pushes to
`main` and can also be started manually. Feature-branch pushes do not run the
normal workflow automatically; contributors are expected to run the relevant
local checks before the final main integration.

The privileged **Device ABI E2E** workflow is manual. It supports a hosted QEMU
target and a privileged self-hosted target.

Release tags are handled by the separate **Release Debian package** workflow.
A `v*` tag does not run the normal Build and Test workflow.

## What each layer proves

| Layer | Main purpose |
| --- | --- |
| Rust unit/integration tests | deterministic runtime and server semantics |
| Web tests | control-plane UI behavior and contracts |
| Native adapter CTests | adapter implementation and memory-safety checks |
| Root build | repository-wide build/install inputs are coherent |
| Real ABI E2E | normal Linux tools can traverse the complete host-adapter/runtime path |
| Release smoke install | the generated Debian package installs and exposes expected commands/files |

Passing the real ABI tests does not prove physical-controller timing, DMA,
interrupt latency, electrical behavior or target-board integration. Those
remain real-target/HIL concerns.
