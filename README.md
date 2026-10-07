# Virtual Device Simulator for Embedded (VDS4E)

[![Build and Test](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml)

VDS4E is an observable virtual hardware laboratory for Embedded Linux
application development. It exposes virtual SPI, I2C, GPIO, and UART devices
through the normal Linux userspace interfaces (`/dev/spidevX.Y`, `/dev/i2c-N`,
`/dev/gpiochipX`, and a PTY), so an unmodified x86_64 build of a production
application and standard tools such as `i2cget` or `gpiomon` can run on a
workstation without the physical board.

```text
Application or standard Linux tool
    -> VDS4E host adapter (CUSE, gpio-sim, PTY)
    -> Unix-socket transaction data plane
    -> declarative virtual device runtime
```

The authoritative system design is
[VDS4E_ARCHITECTURE.md](VDS4E_ARCHITECTURE.md). Planned work is kept separately
in [docs/ROADMAP.md](docs/ROADMAP.md).

## What works today

| Area | Implemented support |
| --- | --- |
| Device packages | Versioned package manifest, runtime model, behavior flow, scenarios, fixtures, documentation, and assets |
| Runtime drivers | `generic-spi-command`, `generic-i2c-register`, `generic-gpio-bank`, `generic-uart-responder` |
| Device behavior | Registers, bitfields, memory, state machines, virtual time, scheduled operations, faults, reset |
| Automation | CLI package validation/scaffolding, SPI transfer, scenario execution, JSON and JUnit results |
| Control plane | REST API, WebSocket replay/live events, React Web UI |
| Native data plane | Length-prefixed Protobuf over `/tmp/vds4e.sock`, Rust CLI, Linux host adapters |
| Linux SPI | Managed CUSE `/dev/spidevX.Y` adapter |
| Linux I²C | Privileged CUSE `/dev/i2c-N` adapter with `I2C_RDWR` and common SMBus operations |
| Linux GPIO | Kernel `gpio-sim` integration exposing a real `/dev/gpiochipX` |
| Linux UART | Unprivileged PTY adapter exposing a standard `/dev/pts/N` TTY |
| Observability | Transactions, registers, state, faults, runs, telemetry, bounded replay, optional SQLite persistence |

## Interface support

| Interface | Runtime driver | Linux host interface | Compatible clients | Status |
| --- | --- | --- | --- | --- |
| SPI / spidev | `generic-spi-command` | `/dev/spidevX.Y` through CUSE | Normal spidev applications and upstream `spidev_test` | Supported |
| I2C / i2c-dev | `generic-i2c-register`, `at24c-eeprom` | `/dev/i2c-N` through CUSE | `i2cdetect`, `i2cget`, `i2cset`, `i2ctransfer`, libi2c applications | Supported |
| GPIO | `generic-gpio-bank` | Real `/dev/gpiochipX` through kernel `gpio-sim` | `gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, `gpiomon`, libgpiod applications | Supported |
| UART / TTY | `generic-uart-responder` | Kernel-assigned `/dev/pts/N` through PTY | Applications using `open`, `read`, `write`, and termios | Supported (functional byte stream; no bit timing) |
| QSPI multi-lane / DTR | SPI command and wire-setting validation | No dedicated host adapter | VDS4E native transaction clients | Runtime only |
| Ethernet, CAN, USB | None | None | n/a | Not implemented |

`generic-spidev` is a transport-test device for spidev compatibility. It does
not model flash memory, JEDEC identity, registers, or vendor-specific
behavior. Use a concrete package such as the bundled Micron MT25QL256 model
when device-specific flash behavior is required.

VDS4E provides functional simulation. It does not simulate electrical
characteristics, controller DMA/IRQ timing, CPU execution, or a complete target
board, and it does not replace real-target or hardware-in-the-loop testing.

## Timing and determinism

Determinism in VDS4E applies to the runtime's virtual-time domain, not to the
whole system:

- Device behavior (state machines, scheduled operations such as the AT24C
  write-cycle NACK window, faults) is driven by a simulator clock.
- Headless scenario runs, the run API, and the CLI use a manual virtual clock
  that advances only when a scenario step advances it. Results are
  reproducible and independent of host speed.
- The live server that serves host adapters uses a wall-clock-backed clock
  (`RealTimeClock`). A real application or shell script, for example one that
  calls `sleep 0.01` after an EEPROM write, observes device timing in real
  time and is subject to normal scheduler jitter. Such runs are not
  bit-for-bit deterministic.
- Checkpoint/restore and record/replay are not implemented (see the
  [roadmap](docs/ROADMAP.md)).

## Hardware import

The `vds-importer` crate drafts declarative models from existing hardware
descriptions: CMSIS-SVD register maps and Device Tree source (buses, addresses,
compatible strings). Its output is a starting point for a device package, not a
finished behavioral model; review and complete it before use.

## How VDS4E compares with related tools

VDS4E is not a CPU or full-system emulator and cannot boot Linux; it is not a
substitute for Renode, QEMU, or commercial virtual platforms, which can be
combined with it later. The closest alternatives for the same job (running
application code against fake device nodes on a workstation) are:

| Capability | VDS4E | umockdev | `i2c-stub` | `gpio-mockup` / `gpio-sim` | `LD_PRELOAD` mocks |
| --- | --- | --- | --- | --- | --- |
| Unmodified application | Yes | Yes (runs under its wrapper) | Yes | Yes | Yes, but only dynamically linked |
| Works with static binaries | Yes (kernel-visible nodes) | No (preload based) | Yes | Yes | No |
| Real kernel-visible device node | Yes (CUSE, `gpio-sim`, PTY) | No (emulated per process) | Yes | Yes | No |
| Stateful device behavior (registers, state machines, timed operations) | Yes, declarative packages | Replays recorded traffic; custom behavior needs code | Simple SMBus register file | GPIO lines only | Whatever the mock author codes |
| Multiple buses | SPI, I2C, GPIO, UART | Many device classes via ioctl record/replay | I2C only | GPIO only | Per mock |
| Needs root or kernel modules | Yes for CUSE and `gpio-sim`; UART PTY does not | No | Yes (module) | Yes (module) | No |
| Fault injection and bus/transaction tracing | Built in | Via recording and custom handling | No | No | Custom |
| Web UI and REST API | Yes | No | No | No | No |

### Why VDS4E rather than umockdev?

umockdev is a mature, lightweight choice and is often the better one. It needs
no root access or kernel modules, it records real hardware ioctl traffic, and
it replays it deterministically in unit tests. If you already have a recording
from real hardware and want fast, unprivileged tests of one application,
use it.

Consider VDS4E when you need one or more of the following:

- a device that responds to transactions it has never seen recorded (a modeled
  register map, memory, state machine, timed write or erase), rather than a
  fixed replay;
- kernel-visible nodes that work for static binaries, other processes, and
  stock tools such as `i2ctransfer`, `gpiomon`, and `spidev_test` at the same
  time;
- a shared, inspectable device state with fault injection, a transaction
  trace, and headless scenarios with JUnit output.

The cost is that VDS4E is heavier: the CUSE and `gpio-sim` adapters need root
and kernel modules, and its device models cover only the ABI subset documented
in each adapter README.

## Quick start

```shell
./run.sh        # or ./dev.sh; see the getting-started guide
```

This starts the Web UI at `http://127.0.0.1:4174`, the control API at
`http://127.0.0.1:8080/api/v1/health`, and the transaction data plane at
`/tmp/vds4e.sock`. Prerequisites, the one-time-authorization launcher, and the
staged `./configure`, `./build.sh`, `./install` pipeline are described in
[docs/guides/getting-started.md](docs/guides/getting-started.md).

## Debian package

Tagged releases build an `amd64` Debian package and attach it to the GitHub
Release together with a SHA-256 checksum. Install a downloaded release with:

```shell
sudo apt install ./vds4e_<version>_amd64.deb
vds-server --config /etc/vds4e/vds-server.yaml --check-config
```

The package installs the server, CLI, four Linux host adapters, Web UI, schemas,
bundled device models, example tools, and a default config under
`/etc/vds4e/vds-server.yaml`. CUSE and `gpio-sim` still require the matching
host kernel support and privileges; package installation does not load kernel
modules automatically.

Maintainers can build the same package locally after `./configure && ./build.sh`:

```shell
./packaging/debian/build-deb.sh 0.1.0
```

## Guides

| Guide | Contents |
| --- | --- |
| [Getting started](docs/guides/getting-started.md) | Prerequisites, development workspace, staged build and install |
| [SPI](docs/guides/spi.md) | Creating `/dev/spidevX.Y`, a C spidev client, the Micron MT25QL256 example, device-node permissions |
| [I2C](docs/guides/i2c.md) | `/dev/i2c-N`, `i2c-tools`, the AT24C EEPROM example, timing domain |
| [GPIO](docs/guides/gpio.md) | `/dev/gpiochipX`, libgpiod tools, line direction mapping |
| [UART](docs/guides/uart.md) | PTY endpoint and the `uart_ping` example |
| [Topology](docs/guides/topology.md) | Connecting a sensor's DRDY signal to a GPIO line |

Adapter details: [SPI CUSE](adapters/spi-cuse/README.md),
[I2C CUSE](adapters/i2c-cuse/README.md),
[GPIO gpio-sim](adapters/gpio-sim/README.md),
[UART PTY](adapters/uart-pty/README.md).

## Linux host adapters

Host adapters expose standard Linux userspace ABIs and forward operations to
the Unix-socket runtime. They contain no device opcodes or register behavior.

| Adapter | Host interface | Privilege |
| --- | --- | --- |
| SPI CUSE | `/dev/spidevX.Y` for supported spidev ioctls; works for dynamically and statically linked applications | Root to load `cuse` and run the helper |
| I2C CUSE | `/dev/i2c-N` with `I2C_RDWR` and common SMBus operations | Root to load `cuse` and run the helper |
| GPIO gpio-sim | Real `/dev/gpiochipX` from the kernel `gpio-sim` module | Root to configure `gpio-sim` |
| UART PTY | `/dev/pts/N` | None |

Client access to the nodes follows the host's device-node permissions; see
[the permissions note](docs/guides/spi.md#device-node-permissions).

## Device packages

Every device lives in a self-contained package:

```text
device-package.yaml
model/device.yaml
flows/behavior.yaml
scenarios/*.yaml
fixtures/
docs/
assets/
```

Only resources declared in the manifest are required. Package paths must stay
inside the package root, and the package ID must match its runtime model.


Create and validate a package:

```shell
cargo run -p vds-cli -- device-package new ./my-sensor \
  --id my-sensor --name "My Sensor" --bus i2c

cargo run -p vds-cli -- device-package validate ./my-sensor
```

The scaffold creates the portable structure; the author must complete the
bus-specific model before it can execute. The package schema accepts SPI, I2C,
GPIO, Ethernet, UART, CAN, USB, and custom buses. The currently executable
generic drivers are SPI command, I2C register (plus the AT24C EEPROM driver),
GPIO bank, and UART responder; Ethernet, CAN, USB, and custom buses are
schema-only.

See the [Device Package SDK](docs/development/device-package-sdk.md), the
[behavior flow reference](docs/device-models/device-behavior-flow-reference.md),
and the [package](schemas/device-package.schema.json) and
[model](schemas/device-model.schema.json) schemas.

## Scenarios

Scenarios run headlessly against the same runtime registry used by native
clients, using the virtual clock:

```shell
cargo run -p vds-cli -- scenario run \
  device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios/01-read-jedec-id.yaml \
  --config config/vds-server.yaml \
  --json-output /tmp/mt25ql256-result.json \
  --junit-output /tmp/mt25ql256-result.xml
```

Steps can reset a device, advance virtual time, send SPI requests, toggle
faults, assert state/register/response/error values, and wait for typed events.

## Web control plane

The Web UI provides:

- Dashboard
- Devices
- Adapters
- Transactions
- Device Library
- Logs

Behavior flows and scenarios are authored per device
(`/devices/:deviceId/flows`, `/devices/:deviceId/scenarios`). The server also
exposes REST resources under `/api/v1` and a WebSocket event stream at
`GET /api/v1/events` with replay by `after_event_id`. REST and WebSocket are
control and observability paths; native bus traffic uses the Unix-socket
Protobuf data plane. For frontend development:

```shell
npm --prefix apps/vds-web install
npm --prefix apps/vds-web run dev
```

## Verification

```shell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
npm --prefix apps/vds-web run lint
npm --prefix apps/vds-web run typecheck
npm --prefix apps/vds-web run test:run
npm --prefix apps/vds-web run build
```

Native adapters and examples have their own CMake or Make definitions; the root
`./configure` and `./build.sh` pipeline builds them together.

## Architecture boundaries

- The server is the only authoritative owner of runtime device state.
- The Web UI never implements device semantics.
- Linux adapters implement host ABI translation, not device behavior.
- High-frequency hardware transactions do not use REST.
- Models, behavior flows, and scenarios come only from device packages.
- Packages are declarative and cannot load arbitrary executable extensions.
- Privileged kernel integration is isolated from the default runtime.
- Generated build outputs are not source artifacts.


## Maintainer

Hakan Kaya ([@haknkayaa](https://github.com/haknkayaa))
