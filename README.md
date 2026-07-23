# Virtual Device Simulator for Embedded (VDS4E)

[![Build and Test](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/haknkayaa/VirtualDeviceSimulatorForEmbedded/actions/workflows/ci.yml)

VDS4E is a deterministic and observable virtual embedded hardware laboratory.
Its architecture is defined by
[`VDS4E_ARCHITECTURE.md`](VDS4E_ARCHITECTURE.md).

The repository currently implements the first headless vertical slice plus the
register, virtual-time, state-machine, fault, scenario, control API, and live
domain-event layers:

```text
C or Rust client -> length-prefixed Protobuf -> Unix socket -> vds-server
                -> generic SPI device -> transaction log -> response
```

The example device implements `READ_ID` (`0x9F`) and returns `EF 40 18`.

## Prerequisites

- Rust 1.91.1 (installed automatically by rustup through `rust-toolchain.toml`)
- Protocol Buffers compiler (`protoc`)
- A C11 compiler and `make` for the C client example

## Quick start

Start the simulator server and hot-reloading Web UI together from the repository
root:

```shell
./dev.sh
```

Open `http://127.0.0.1:4174`. Keep the terminal open while developing and press
`Ctrl+C` to stop both processes. On the first run, the script installs Web
dependencies when `apps/vds-web/node_modules` is missing. Override the UI port
when needed with `VDS_WEB_PORT=4200 ./dev.sh`.

The individual commands remain available for focused server or client work.

Validate the example configuration:

```shell
cargo run -p vds-server -- --config config/vds-server.yaml --check-config
```

Start the server:

```shell
cargo run -p vds-server -- --config config/vds-server.yaml
```

In a second terminal, send `READ_ID` with the Rust CLI:

```shell
cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx 9F
```

Expected output:

```text
RX: EF 40 18
```

An unknown opcode returns a structured protocol error:

```shell
cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx 00
```

## Register Engine v1

The example SPI model declares three 8-bit registers in
`device-models/examples/spi-flash.yaml`:

- `CONTROL` at `0x01` (`rw`, reset `0x12`)
- `STATUS` at `0x00` (`ro`, reset `0x00`; bit 0 is `BUSY`)
- `COMMAND` at `0x03` (`wo`, reset `0x00`)

Opcode `0x03` reads a register and opcode `0x02` writes a register. Addresses
are one byte and values use the byte width derived from `width_bits`.

Read the initial `CONTROL` value:

```shell
cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx "03 01"
```

Expected output:

```text
RX: 12
```

Write `0x5A`. The command is accepted immediately, sets `STATUS.BUSY`, and
commits `CONTROL` after the YAML-configured 10 ms virtual latency:

```shell
cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx "02 01 5A"

cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx "03 00"

cargo run -p vds-cli -- spi-transfer \
  --socket /tmp/vds4e.sock \
  --device spi-flash-0 \
  --tx "03 01"
```

The write returns an empty payload. A status read during the operation returns
`RX: 01`; after 10 ms a subsequent device interaction processes the due event,
the control read returns `RX: 5A`, and status returns `RX: 00`. Writing
`STATUS`, reading `COMMAND`, or using an unknown address returns a structured
register error.

## Virtual time behavior

Production devices use a monotonic `RealTimeClock`. No SPI handler sleeps: due
operations are applied when the device runtime next processes an interaction
or an explicit due-event call.

Tests inject `ManualClock`, which starts at `0 ns` and advances without waiting:

```rust
let clock = Arc::new(ManualClock::default());
let device = model.into_spi_device_with_clock(clock.clone())?;

device.transfer(&[0x02, 0x01, 0x5A])?;
clock.advance(Duration::from_millis(9))?;
device.run_due_events()?; // CONTROL is still 0x12
clock.advance(Duration::from_millis(1))?;
device.run_due_events()?; // CONTROL becomes 0x5A and BUSY clears
```

Started and completed operations emit separate structured timing logs. Wall
clock transaction timestamps and virtual operation durations are kept as
separate fields.

## Device State Machine v1

The example device declares three states in YAML:

```text
resetting --reset_complete after 5 ms--> ready
ready     --write_started-------------> busy
busy      --operation_completed--------> ready
```

States can declare ordered transitions, register-based guards, register entry
and exit actions, and one-shot delayed events. The generic transition engine
lives in `vds-core`; YAML interpretation, register actions, guards, and runtime
state remain in `vds-device-model`.

`WRITE_REGISTER` is accepted only in `ready`. A write dispatches
`write_started`; the SPI decoder never assigns the current state directly.
Completion from the existing timing scheduler dispatches
`operation_completed`. Reset cancels pending operations, restores registers,
returns to `resetting`, and schedules a new `reset_complete` event.

Every successful transition emits a structured `state_transition` log with
the device ID, source state, target state, trigger, and virtual timestamp.
Models without `state_machine` or command `allowed_states` retain their prior
behavior.

## Fault Injection Engine v1

Device YAML may declare deterministic faults targeted by device, decoded
command, register, and state. Supported triggers are `always`, `first_n`,
`every_nth`, and exact `operation_count`. Supported actions are timeout, delay,
returned error, drop, response XOR corruption, forced register value, and
stuck-at register value.

Matching faults run by descending priority and then YAML order. Timeout,
returned error, and drop stop evaluation; other actions compose. Counters and
delay deadlines use simulator state and the existing virtual scheduler. Reset
clears transient fault state while definitions marked `persistent: true` retain
their counters and active stuck-at constraints. Models without `faults` retain
their previous behavior.

## Scenario Engine v1

Declarative scenario YAML executes sequentially against the same device
registry and SPI transaction path used by normal clients. Scenario steps can
reset devices, advance a shared manual clock, send SPI transfers, enable or
disable faults, assert responses/errors/registers/states, and wait for
structured device events.

Command results are stored by `save_as` and consumed by later assertions. The
first failed step stops execution and marks remaining steps skipped unless that
step declares `continue_on_failure: true`. Scenario and step results contain
only virtual timestamps and serialize directly to JSON, so replay with the same
models and starting clock is deterministic. See
`scenarios/examples/delayed-write-with-timeout.yaml` for a complete example.

## Control API and live events v1

The server listens on the configured `server.control_address` and exposes a
REST control plane under `/api/v1`. It provides health, device/register/state,
reset, scenario/run, and fault-management endpoints. Scenario starts return
`202 Accepted` with a run ID; status and the final JSON result are retrieved
from `/api/v1/runs/{run_id}` and `/api/v1/runs/{run_id}/result`.
`GET /api/v1/telemetry/buses` derives a read-only 60-second bus-health
snapshot from typed transaction events; it does not accept transactions.

`GET /api/v1/events` upgrades to a WebSocket stream of typed domain events.
The in-memory event bus assigns monotonically increasing IDs and retains the
latest 10,000 events. A reconnecting client can pass
`?after_event_id=<last_seen_id>` to replay strictly newer retained events before
continuing with live delivery. Slow subscribers never block simulator work;
they can recover retained events by ID after lagging.

The REST surface intentionally has no SPI-transfer endpoint. Hardware
transactions continue to use the length-prefixed Protobuf protocol over the
Unix socket, while REST and WebSocket remain control and observability paths.

The optional Linux SPI ABI adapter in `adapters/spi-preload` lets dynamically
linked applications use mapped `/dev/spidevX.Y` paths through `LD_PRELOAD`.
See its README for the supported ioctl subset, build commands, and limitations.

## Web UI Foundation v1

The React control plane lives in `apps/vds-web`. It reads authoritative
snapshots from REST and keeps live events, its in-memory replay cursor, and
connection status in a separate WebSocket store. The UI includes Dashboard,
Devices, Transactions, and Scenarios routes; it never sends hardware
transactions over REST.

With `vds-server` running on the default control address, start the Vite
development server:

```shell
cd apps/vds-web
npm install
npm run dev
```

Vite proxies `/api` (including the WebSocket upgrade) to
`http://127.0.0.1:8080`. Override that target with `VDS_API_PROXY_TARGET` or use
`VITE_API_ROOT` and `VITE_WS_ROOT` for a separately hosted production frontend.

Frontend quality checks:

```shell
cd apps/vds-web
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## C client example

Build the static C library and sample application:

```shell
make -C client/c
```

With `vds-server` running, execute:

```shell
client/c/build/read_id /tmp/vds4e.sock
```

Expected output:

```text
TX: 9F
RX: EF 40 18
```

The C client intentionally implements only the first protocol slice. The
authoritative wire schema is [`proto/vds.proto`](proto/vds.proto).

Run the quality checks:

```shell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
make -C client/c
```

## Architecture boundaries

- The Web UI is a control-plane client; it never implements device behavior.
- High-frequency hardware transactions use Unix domain sockets and Protobuf,
  not REST.
- Generic buses remain independent of device-specific plugins.
- Device behavior is loaded from versioned, schema-validated YAML.
- The first slice uses statically linked generic behavior; no dynamic plugins
  or arbitrary scripting are loaded.
- The default build and test path does not require root privileges.
