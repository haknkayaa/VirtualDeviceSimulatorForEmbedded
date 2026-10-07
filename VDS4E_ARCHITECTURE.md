# Virtual Device Simulator for Embedded (VDS4E)

## Architecture and development constitution

**Status:** Authoritative description of the implemented architecture

**Audience:** Maintainers, contributors, device-package authors, reviewers, and automation

**Purpose:** Define the current system boundaries and the rules that keep VDS4E deterministic, headless, portable, and compatible with normal Embedded Linux applications

Planned registry, publishing, package composition, lock-file, additional bus,
and full-system work belongs in [docs/ROADMAP.md](docs/ROADMAP.md). A planned
capability must not be presented here as implemented behavior.

## 1. Problem statement

Embedded Linux applications commonly depend on hardware-facing interfaces that
do not exist on a developer workstation or in CI:

- `/dev/spidevX.Y`
- `/dev/i2c-N`
- `/dev/gpiochipN`
- device-specific commands, register maps, memory, and status bits
- timing-dependent state changes and interrupt-like line transitions
- reproducible error, timeout, busy, and recovery behavior

Physical boards are scarce, difficult to automate, and often unable to produce
dangerous or rare failure conditions on demand. VDS4E provides a deterministic
functional simulation layer between an ordinary host application and
declarative virtual devices.

The intended product is:

> A headless virtual embedded hardware laboratory in which unmodified Linux
> applications, host adapters, scenarios, and the Web control plane interact
> with the same authoritative device runtime.

VDS4E addresses runtime hardware absence and testability. It does not solve
cross-compilation, target sysroot, or target kernel configuration problems.

## 2. Scope and non-goals

### 2.1 Implemented scope

The repository currently implements:

- package-only loading of device models, behavior flows, and scenarios
- generic declarative SPI command devices
- generic I²C register devices
- datasheet-derived AT24C128/AT24C256 EEPROM devices with page and write-cycle
  semantics
- generic GPIO banks
- public device signal ports connected to GPIO lines by a board topology
  (ADR 0011)
- register maps and bitfields with access enforcement, including read-clear
  bitfields
- flash-like memory operations and geometry validation
- virtual time, scheduled operations, and busy-state behavior
- state machines with guards, actions, and delayed transitions
- deterministic fault injection
- package-local scenario execution and JUnit/JSON results
- REST control APIs and WebSocket event replay
- a length-prefixed Protobuf transaction protocol over a Unix socket
- a diagnostic Rust CLI and internal adapter transport helpers
- a managed Linux SPI CUSE adapter
- a Linux I²C CUSE adapter
- kernel `gpio-sim` integration exposing real `/dev/gpiochipX` devices
- an unprivileged UART PTY adapter exposing a standard `/dev/pts/N` TTY
- a device-scoped Web workspace for configuration, behavior, and scenarios
- bounded in-memory events with optional SQLite persistence and retention

### 2.2 Explicit non-goals

VDS4E does not claim to simulate:

- voltage, current, analog behavior, signal integrity, or EMI/EMC
- rise/fall times, electrical bus contention, or PCB faults
- exact controller clocks, DMA, IRQ latency, or SoC peripheral timing
- CPU pipelines, caches, MMUs, or cycle-accurate processor execution
- a complete Linux kernel or target board
- certification evidence or final hardware compliance
- Yocto SDKs, sysroots, toolchains, or target library availability

Real-target and hardware-in-the-loop testing remain required.

## 3. Architectural principles

### 3.1 The server is authoritative

The headless Rust runtime owns device state. The Web application, CLI, native
clients, and Linux adapters are clients of that runtime. No device behavior may
exist only in the browser or in an adapter.

### 3.2 Control plane and transaction data plane are separate

REST controls resources and inspects state. WebSocket streams domain events.
High-frequency bus operations use framed Protobuf messages over a Unix domain
socket.

An arbitrary SPI, I²C, or GPIO transaction must not be routed through a Web
component or introduced as a convenience REST endpoint.

### 3.3 Headless operation is mandatory

Package validation, server startup, device execution, scenario execution, and
host adapter integration must work without the Web UI. The browser is an optional
authoring and observability surface.

### 3.4 Device packages are the source of truth

Runtime models, behavior flows, scenarios, fixtures, documentation, and assets
belong to a versioned device package. Standalone root model lists and global
scenario directories are not supported configuration sources.

### 3.5 Bus transport and device semantics remain separate

A host adapter implements a Linux-facing ABI. A protocol message transports a
request. A runtime driver interprets device-specific state. Opcodes, registers,
timing, faults, and model-specific behavior must not leak into adapters.

### 3.6 Determinism outranks visual convenience

For the same package, initial state, virtual clock, request sequence, and fault
configuration, execution must produce the same runtime result. UI animation or
wall-clock scheduling must not redefine device semantics.

### 3.7 Privilege is isolated

The server, Web application, CLI, and shared adapter transport helper run without
root. Kernel-module loading, CUSE device creation, and configfs GPIO
provisioning remain behind explicit adapter-driver boundaries.

### 3.8 Schemas are public contracts

Configuration and package formats are versioned and schema-validated. A
contract change updates its schema, implementation, fixtures, tests, examples,
and documentation together.

## 4. System context

```text
                         CONTROL PLANE

  Web UI ---------------- REST /api/v1 -------------------+
     |                                                    |
     +---------------- WebSocket /api/v1/events ----------+
                                                          v
                                                   +-------------+
  CLI package/scenario commands -----------------> | vds-server  |
                                                   |             |
                         TRANSACTION DATA PLANE     | Device      |
                                                   | Registry    |
  Rust CLI --------------- framed Protobuf ------> |             |
  SPI CUSE adapter ------- /tmp/vds4e.sock ------> | Drivers     |
  I2C CUSE adapter ------------------------------> |             |
  GPIO sync helper ------------------------------> +------+------+
  UART PTY adapter ------------------------------> |             |
                                                          |
                                                          v
                                             Declarative device packages
```

The planes share the same runtime registry. A register changed through the
control API is visible to a later native bus transaction. A bus transaction
that changes device state is visible to the Web UI and scenario engine.

### 4.1 Dependency direction

```text
apps/vds-web        apps/vds-cli        native Linux applications
      |                   |                         |
      | REST/WS           | Rust APIs / UDS         | Linux ABI
      v                   v                         v
apps/vds-server <---- adapters/bridge <--- adapters
      |
      v
vds-core + vds-device-model + focused engine crates
      |
      v
device packages and schemas
```

Dependencies must not point back into the Web application. Engine crates must
not depend on HTTP routes or UI types. Adapters may depend on the native data
plane client but not on model-specific code.

## 5. Repository and component responsibilities

### 5.1 Applications

- `apps/vds-server` is the authoritative process. It loads configuration and
  packages, constructs runtime devices, owns the registry, starts the REST and
  WebSocket control plane, accepts Unix-socket transactions, manages scenarios,
  adapters, runs, telemetry, and event persistence.
- `apps/vds-cli` provides SPI transaction access, package scaffolding and
  validation, and headless scenario execution with JSON and JUnit output.
- `apps/vds-web` is the React control plane. It manages devices and adapters,
  displays telemetry and events, and hosts device-scoped behavior and scenario
  editors.

### 5.2 Runtime crates

- `crates/vds-core` defines clocks, server configuration, package loading,
  generic device traits, the runtime registry, state machines, faults,
  transactions, and core errors.
- `crates/vds-device-model` parses declarative models and builds the generic
  SPI, I²C, GPIO, and UART runtime implementations. It also compiles behavior flows,
  validates signal graphs, and integrates registers, memory, state, timing, and
  faults.
- `crates/vds-registers` owns register definitions, widths, access modes,
  bitfield validation, reset values, and runtime read/write enforcement.
- `crates/vds-scenario` owns scenario documents, step execution, results,
  runtime abstraction, and JUnit serialization.
- `crates/vds-events` owns typed domain events, monotonic IDs, replay,
  broadcast subscriptions, SQLite persistence, sampling, and retention.
- `crates/vds-protocol` owns generated Protobuf types and length-prefixed async
  framing.

### 5.3 Host integration

- `adapters/bridge` is internal shared transport code used by the
  Linux host adapters; it is not a public application SDK.
- `adapters/spi-cuse` exposes privileged `/dev/spidevX.Y` character devices.
- `adapters/i2c-cuse` exposes privileged `/dev/i2c-N` buses.
- `adapters/gpio-sim` provisions kernel-owned `/dev/gpiochipX` devices and
  synchronizes line values with the runtime.
- `adapters/uart-pty` exposes a kernel-assigned PTY slave and forwards its byte
  stream to the runtime.
- `examples/micron-mt25ql256-embedded` is a flat Embedded Linux C example using
  normal spidev operations; it is not part of a device package.
- `examples/atmel-at24c256-embedded` is a flat Embedded Linux C example using
  normal `i2c-dev` ioctls for both AT24C128 and AT24C256.

### 5.4 Public contracts and documentation

- `crates/vds-protocol/proto/vds.proto` is the transaction wire contract.
- `schemas/server-config.schema.json` is the server configuration contract.
- `schemas/device-package.schema.json` is the portable package manifest
  contract.
- `schemas/device-model.schema.json` is the declarative runtime model contract.
- `schemas/scenario.schema.json` is the scenario document contract.
- `docs/adr` records accepted architectural decisions.
- `docs/ROADMAP.md` contains unimplemented work.

## 6. Process startup and runtime lifecycle

### 6.1 Configuration

The server accepts one YAML configuration containing:

- `server.control_address`
- `data_plane.unix_socket`
- `observability.log_level`
- optional `event_store` policy
- required, non-empty `device_packages`
- optional `topology`, a path to a `topology.yaml` that connects public device
  signal ports (section 8.8)

Unknown top-level fields are rejected. The removed `device_models` and global
`scenarios` fields are not compatibility aliases.

### 6.2 Package loading

At startup the server:

1. parses and schema-validates server configuration;
2. resolves every package path;
3. validates `device-package.yaml`;
4. verifies every declared package-relative resource stays inside the package;
5. loads and validates the runtime model;
6. checks that package ID, bus type, driver, and model agree;
7. constructs the correct runtime device;
8. registers the device ID exactly once;
9. loads package-local scenarios and optional behavior flow;
10. initializes the event bus and control/data-plane listeners.

Any missing resource, type mismatch, duplicate ID, invalid model, or unsafe
path fails startup. Partially valid package sets are not accepted.

### 6.3 Device instances

Configured packages create initial runtime instances. The control API can also
create a device instance from a loaded package template by assigning a new
device ID. The runtime registry stores devices behind the common `Device`
trait, allowing control and transaction paths to resolve the same instance.

### 6.4 Reset

Reset is a device-runtime operation. Depending on the runtime driver it:

- restores declared register reset values;
- restores memory/runtime state defined as resettable;
- clears transient fault counters and constraints;
- preserves faults explicitly declared persistent;
- cancels pending timed operations;
- returns the state machine to its initial state;
- schedules declared initial delayed transitions;
- restores GPIO initial line values.

## 7. Device package architecture

### 7.1 Package layout

A package is a self-contained directory rooted by `device-package.yaml`:

```text
my-device/
├── device-package.yaml
├── model/
│   └── device.yaml
├── flows/
│   └── behavior.yaml
├── scenarios/
│   └── smoke.yaml
├── fixtures/
├── docs/
└── assets/
```

Only the manifest and runtime model are universally required. Optional
resources are present only when declared by the manifest; empty placeholder
directories are not required.

### 7.2 Manifest

```yaml
api_version: vds4e.dev/v1alpha1
kind: DevicePackage

metadata:
  id: example-spi-device
  display_name: Example SPI Device
  version: 1.0.0
  license: Apache-2.0
  authors: [VDS4E Contributors]
  tags: [spi, example]

spec:
  bus:
    type: spi
    profile: spi.mode0
    options:
      mode: 0
      transfer_bits: 8
  runtime:
    driver: generic-spi-command
    model: model/device.yaml
  authoring:
    behavior_flow: flows/behavior.yaml
  validation:
    scenarios: scenarios
    fixtures: fixtures
  documentation: docs
  assets: assets
  extensions: {}
```

`metadata.id` must match the runtime model's device ID. All resource paths are
relative to the package root. Absolute paths, `..` traversal, symlink escapes,
and declared resources of the wrong type are rejected.

### 7.3 Package ownership

Models, flows, and scenarios move together. A scenario belongs to the device
package that declares it; the Web UI may filter the server's internal scenario
API by selected device, but it must not create a second global authoring model.

Repository examples may be installed into the managed per-user store at
`~/vds4e/devices/<package-id>/`. Managed examples use staged replacement so a
reader does not observe a partially copied package. An unmanaged package with
the same ID is not overwritten.

### 7.4 Community authoring contract

Open-source contributors define new devices through schemas and documented
runtime drivers. A community package must not require a private server fork or
browser-only behavior. Package documentation should describe:

- supported commands and bus constraints;
- register and bitfield semantics;
- memory geometry;
- states and transitions;
- timing assumptions;
- supported and intentionally unsupported datasheet behavior;
- validation scenarios and fixtures;
- license, attribution, and source references.

## 8. Runtime domain model

### 8.1 Device

A runtime device has:

- a stable instance ID;
- a bus type;
- optional current state;
- optional registers and memory;
- bus-specific transfer behavior;
- reset, fault, event, and virtual-time behavior.

The common device trait exposes generic inspection/control operations plus
bus-specific SPI, I²C, GPIO, and UART entry points. Unsupported operations return
structured device errors instead of silently succeeding.

### 8.2 Device registry

The registry maps device IDs to shared runtime instances and provides:

- snapshots for the control plane;
- SPI transaction routing;
- atomic I²C message-sequence routing;
- GPIO line exchange and line metadata;
- UART byte-stream routing;
- register reads/writes;
- reset and state inspection;
- fault control;
- virtual-time and due-event operations;
- signal propagation for an attached topology (section 8.8).

All clients converge at this boundary. The registry does not contain
device-specific opcode logic.

### 8.3 Registers

A register definition contains an address, width, reset value, access mode,
description, and optional bitfields. The engine enforces:

- unique addresses and names;
- widths supported by the model;
- values fitting the declared width;
- `ro`, `wo`, and `rw` access;
- valid non-overlapping bitfields;
- bitfield access compatible with the parent register;
- reset values and runtime constraints;
- optional `read_clear` bitfields: a bus read returns the current value and then
  clears those bits. Control-plane and scenario inspection never clear them.

Device-internal actions may update status fields that are read-only to an
external client.

### 8.4 Memory

Memory definitions declare total size, page size, sector size, and erased
value. Runtime operations validate:

- address width and bounds;
- page-program limits;
- erase alignment and geometry;
- write-enable/state guards;
- declared operation timing.

Flash programming follows the runtime's declared flash semantics rather than
performing arbitrary host-file writes.

### 8.5 State machines

State machines define:

- one initial state;
- named states;
- ordered transitions;
- event triggers;
- register-based guards;
- entry and exit actions;
- optional delayed events.

Command decoding dispatches events; it does not directly assign arbitrary
states. Scheduled completions also dispatch events through the same transition
engine.

### 8.6 Virtual time and scheduling

Production runtime instances use a monotonic real-time-backed simulator clock.
Tests and scenario execution can use a manual clock. Device handlers do not
sleep to model latency. Instead they:

1. validate and accept an operation;
2. update busy/status state;
3. schedule a completion at a virtual deadline;
4. apply due events on a later interaction or explicit clock advance.

Wall-clock timestamps describe observation time. Virtual timestamps describe
simulated ordering and duration. They must not be treated as interchangeable.

### 8.7 Faults

Fault definitions select a target and trigger, then apply an action. Current
targets may include command, register, device, and state. Current triggers
include always, first-N, every-Nth, and exact operation count. Actions include
timeout, delay, returned error, drop, response corruption, forced register
value, and stuck-at constraints.

Matching faults execute by descending priority and declaration order. Terminal
actions stop evaluation; composable actions accumulate. Reset clears transient
fault state and preserves explicitly persistent state.

### 8.8 Signal ports and board topology

A device model may expose **public output signal ports** (`signals.outputs`,
type `bool` in version 1). Each port is driven by an internal
`signal_bindings` entry whose source is a register bit, a state-machine state,
or a combination of those using the logical vocabulary of the typed signal graph
(`and`, `or`, `not`, `nand`, `nor`, `xor`, `xnor`). There is no expression
language. Only `generic-spi-command` and `generic-i2c-register` models support
ports in version 1.

A separate `topology.yaml`, referenced by the optional `topology:` key in the
server configuration, connects ports to GPIO lines:

```yaml
schema_version: 1
connections:
  - from: imu0.drdy            # <device.id>.<signal>
    to: gpio0.DRDY_IMU         # <device.id>.<line name>
    delay_ns: 500              # optional; default is zero
```

The topology addresses ports and named GPIO lines only. It never refers to
registers, states, or line offsets, and it does not know adapters. Endpoint
device names resolve to runtime `device.id` values; there is no separate
instance or composition system.

The target must be a device-driven GPIO line (`direction: output` in the GPIO
model; the application reads it). Two connections may not drive the same line.
Validation rejects unknown devices, ports, and lines, host-driven targets,
multiple drivers, and device-level cycles when the topology is attached.

The registry owns a deterministic signal router. After every transaction,
reset, register write, and due-event pass it samples the source ports and
propagates only values that changed since the last propagation. Zero-delay
changes drain through a FIFO queue at the same virtual timestamp until the
system is stable; the loop is bounded and fails with a typed error if it does
not stabilize. Connections with `delay_ns` are queued on virtual time and
participate in the earliest-deadline calculation. Propagation is never recursive.

The router drives the target GPIO bank's backing register. The existing path
from the bank through the GPIO adapter and kernel `gpio-sim` carries the level
to `/dev/gpiochipN`, so the router and host adapters stay independent. When a
topology is attached, the live server runs a pump that sleeps until the earliest
scheduled device or connection deadline and is woken by every transaction, so
timer-driven signals do not wait for another bus transaction and an idle server
does not poll (ADR 0012). Read-clear behavior ("reading the sample drops DRDY")
belongs to the register/model layer.

Each propagation step is reported to an observer and published as a
`signal_changed` domain event (`phase` `emitted` or `delivered`, with the source
port, target line, value and connection delay). Scenario runs publish them with
their run ID. The Web UI shows them in the event stream and log filters.

## 9. Bus runtime drivers

### 9.1 Generic SPI command runtime

The `generic-spi-command` driver decodes explicit opcodes and validates the
request against declared SPI mode, word size, frequency, lane widths, transfer
rate, dummy cycles, state restrictions, and payload shape.

Commands may:

- return a fixed deterministic response;
- read or write a register;
- read memory;
- program a page;
- erase a sector or the full memory;
- dispatch a state-machine event;
- schedule a timed operation;
- expose an authoring shortcut.

QSPI-style lane metadata and DTR validation are part of the runtime command
contract. This is functional protocol validation, not electrical waveform
simulation.

### 9.2 Generic I²C register runtime

The `generic-i2c-register` driver executes an atomic ordered sequence of Linux
I²C-style messages. Write messages establish a register pointer and optionally
write data. Read messages return bytes from the current pointer. The model
declares pointer width and auto-increment behavior.

The current generic driver uses byte-wide registers. Register access modes are
enforced by the shared register engine. Slave-address routing belongs to the
I²C adapter, not the device model.

### 9.3 Generic GPIO bank runtime

The `generic-gpio-bank` driver declares contiguous line offsets, names,
direction, initial value, active-low behavior, and optional backing registers.

During a GPIO exchange:

- host-driven levels update lines declared as device inputs;
- the runtime returns current levels for device outputs;
- register-backed inputs expose observed host state as read-only registers;
- register-backed outputs allow flows, scenarios, or control operations to
  cause externally visible transitions.

Line offsets must start at zero and remain contiguous so runtime vectors and
kernel gpio-sim lines have an unambiguous mapping.

## 10. Behavior-flow execution and authoring

Behavior flows are package-local YAML documents. The compiler validates node
kinds, ports, parameter types, references, and graph connections, then produces
typed runtime structures. A browser document is not an alternative runtime
format.

The Web editor uses shared canvas, registry, serialization, validation, and
store infrastructure under `features/flows`, while device behavior lives under
`features/devices/behavior`.

Reusable nodes are an authoring concept:

- enabling reuse exposes the node in the reusable registry category;
- copies represent the same reusable definition;
- shared properties remain synchronized;
- visual selection and validation state remain instance-specific;
- a dirty document must visibly report unsaved changes.

Terminal nodes expose only their incoming connection side. Inspector properties
use a compact table layout so labels, values, booleans, and selections follow
one consistent editing model.

## 11. Scenario architecture

Scenario YAML belongs to a device package and is executed by `vds-scenario`
against the same registry used by the CLI and host adapters.

Current scenario actions cover device reset, manual clock advancement, SPI
transfer, fault enable/disable, state/register/response/error assertions, and
event waiting. Results can be saved by name and used in later assertions.

Execution rules:

- steps run in declaration order;
- virtual timestamps are recorded per step;
- a failed step stops subsequent work unless `continue_on_failure` is enabled;
- skipped steps remain explicit in the result;
- JSON and JUnit output derive from the same result model;
- scenario replay does not require the Web UI.

The server keeps `/api/v1/scenarios` as an internal runtime API. In the Web
application scenario authoring and execution are scoped to:

```text
/devices/:deviceId/scenarios
/devices/:deviceId/scenarios/new
/devices/:deviceId/scenarios/:scenarioId
```

There is no global scenario authoring route.

## 12. Linux ABI adapter architecture

### 12.1 Adapter resources and lifecycle

Adapters are top-level host resources because one bus can contain multiple
device bindings. The adapter manager tracks:

- adapter ID and display name;
- bus type and bus number or GPIO line count;
- bindings from endpoint/address to runtime device ID;
- expected and actual device path;
- readiness and lifecycle state;
- daemon process IDs;
- authorization or startup error.

Topology is configured while unloaded. Loading resolves the required helper,
performs explicit OS authorization when necessary, creates the host endpoint,
and records the actual path. Unloading terminates managed helpers and removes
their endpoints.

The local simulator stores logical adapter topology, device bindings, and load
intent in `~/.vds4e/adapters.json` (or `VDS4E_ADAPTER_STATE`). It writes the
store atomically and restores adapters only after the Unix-socket data plane is
listening. Daemon PIDs and kernel-assigned paths are never persisted; they are
recreated and rediscovered on startup.

### 12.2 SPI CUSE

The SPI CUSE adapter creates a real character device such as
`/dev/spidev0.0`. It supports dynamically and statically linked applications
that use the supported spidev ioctl subset. CUSE and device-node creation
require operating-system authorization.

One SPI adapter may bind several devices by distinct chip-select endpoints.

### 12.3 I²C CUSE

The I²C CUSE adapter creates one `/dev/i2c-N` bus. Each binding maps a unique
slave address to a runtime device ID. Address selection through `I2C_SLAVE` is
local to an open file descriptor; `I2C_RDWR` preserves combined-message order
in one runtime request.

The adapter supports the implemented `i2c-dev` and SMBus ioctl families needed
by normal `i2cdetect`, `i2cget`, `i2cset`, and `i2ctransfer` workflows.
Changing bus topology requires unloading the adapter.

The `at24c-eeprom` device runtime is distinct from the generic register model.
It owns a persistent byte array, applies 64-byte page-local write rollover,
keeps the current word-address counter across transactions, wraps sequential
reads at capacity, and returns a device-busy error during the configured
self-timed write interval. The I²C adapter maps that busy response to the NACK
observed by normal Linux ACK-polling clients.

### 12.4 GPIO through kernel gpio-sim

GPIO does not emulate the character-device ABI in userspace. The helper
configures the kernel `gpio-sim` module through configfs. Linux allocates the
actual `/dev/gpiochipX`, owns line-request file descriptors, and implements
libgpiod ioctl and edge-event behavior.

The VDS4E helper synchronizes kernel line values with one attached declarative
GPIO runtime. The kernel chooses `X`; clients must use the actual path reported
by the adapter snapshot rather than assuming a number.

### 12.5 UART through pseudoterminals

Each UART adapter binds one runtime device and creates an unprivileged PTY pair.
The managed helper retains the master side and reports the kernel-assigned slave
path such as `/dev/pts/7`. Applications use ordinary TTY reads, writes, and
termios configuration on that path. The generic UART runtime buffers the byte
stream and matches deterministic, prefix-free declarative request patterns;
device semantics do not live in the helper.

PTY integration does not model electrical bit timing, parity/framing errors,
break signaling, modem-control lines, or a physical UART controller.

### 12.6 Compatibility rule

VDS4E does not maintain replacements for distribution tools. Adapter
acceptance is measured with unmodified host tools:

- SPI: normal spidev applications and supported `spi-tools`
- I²C: `i2cdetect`, `i2cget`, `i2cset`, `i2ctransfer`
- GPIO: `gpiodetect`, `gpioinfo`, `gpioget`, `gpioset`, `gpiomon`
- UART: normal TTY applications using `open`, `read`, `write`, and termios

Passing these tests establishes Linux userspace ABI compatibility only. It does
not validate physical controllers, DMA, interrupts, or electrical behavior.

## 13. Protocol and API boundaries

### 13.1 Unix-socket Protobuf protocol

`crates/vds-protocol/proto/vds.proto` defines request/response envelopes with a request ID and
typed payloads for:

- SPI transfer;
- I²C transfer containing an ordered message list;
- GPIO host/device line exchange;
- UART byte-stream transfer;
- structured error response.

Messages are length-prefixed. Clients must bound frame and payload sizes,
preserve request IDs, reject unexpected response variants, and map structured
runtime errors deterministically.

### 13.2 REST control API

The server exposes `/api/v1` resources for:

- health and virtual clock;
- devices, templates, commands, registers, state, and reset;
- device packages and package import;
- adapters, bindings, load, and unload;
- scenarios and asynchronous runs;
- JSON and JUnit run results;
- fault enable/disable;
- bus telemetry.

REST DTOs are server contracts, not serialized React component state.
Asynchronous scenario starts return a run ID; clients poll the run resource or
consume events for progress.

### 13.3 WebSocket events

`GET /api/v1/events` upgrades to WebSocket. Events receive monotonically
increasing IDs. A reconnecting client supplies `after_event_id` to replay newer
retained events before continuing with live delivery.

Slow subscribers do not block runtime work. A lagging client reconnects from
its last committed cursor.

## 14. Web application boundaries

The Web UI contains top-level Dashboard, Devices, Adapters, Transactions,
Device Library, and Logs routes. Behavior flows and scenarios are subordinate
to a selected device.

Device routes are:

```text
/devices
/devices/:deviceId
/devices/:deviceId/flows
/devices/:deviceId/flows/new
/devices/:deviceId/flows/:flowId
/devices/:deviceId/scenarios
/devices/:deviceId/scenarios/new
/devices/:deviceId/scenarios/:scenarioId
```

The URL is authoritative for the selected device and tab. Save, cancel, back,
filtering, and editor navigation must remain in that device context.

The Device Library discovers and imports packages. After a device is added,
configuration and authoring happen in the device workspace. The library does
not own a separate global flow editor.

Server snapshots are fetched through query APIs. Live events and replay cursor
state live in the event-stream store. UI-local canvas state may be optimistic,
but authoritative runtime state comes from the server.

## 15. Observability and persistence

Domain events describe transactions, register access, state transitions,
scheduled operation start/completion, faults, scenarios, and related runtime
activity. Every event contains:

- a monotonic event ID;
- wall-clock timestamp;
- virtual timestamp where applicable;
- event type;
- structured payload.

The event bus keeps a bounded in-memory ring for replay and broadcasts live
events through a bounded channel.

When `event_store.enabled` is true:

- SQLite is opened below the user's `.vds4e` directory;
- persistence occurs on a dedicated bounded worker queue;
- writes are batched;
- the last event ID is persisted and restored;
- register reads may be sampled;
- transaction, register-read, and critical-event classes use separate
  retention periods;
- maximum event count and logical database size trigger bounded cleanup.

Persistence must not block a device transaction on a SQLite write.

Telemetry is derived from typed events and runtime snapshots. It is
observability data, not a second source of device truth.

## 16. Security and trust

Device packages are untrusted declarative input.

- YAML and JSON are schema-validated.
- Unknown fields are rejected where contracts require strictness.
- Package paths are normalized and canonicalized.
- Declared paths cannot escape the package root.
- Package imports must not overwrite unmanaged packages.
- Packages cannot load native libraries or arbitrary scripts as runtime
  extensions.
- Commands validate sizes, addresses, state, access mode, and wire settings.
- Error messages must provide diagnosis without exposing unrelated package
  data or secrets.
- The Web application never receives or stores a sudo password.
- CUSE and configfs privileges remain in adapter helpers.
- Device-node permissions are controlled by the host's normal udev and group
  policy; production nodes must not be made world-writable as a shortcut.
- Company-private models, protocols, fixtures, and test vectors remain outside
  the public repository.

## 17. Build, installation, and development workflow

`./dev.sh` starts the development server and Vite UI together. It is not the
production build pipeline.

The ordered root pipeline is:

```text
./configure -> ./build.sh -> ./install
```

- `./configure` checks prerequisites and prepares staged output.
- `./build.sh` refuses to run without successful configuration.
- `./install` refuses to run without a successful build.
- all generated build output is staged under `build/`.
- `PREFIX` selects the installation prefix.
- `DESTDIR` supports package assembly without changing installed paths.

Focused module commands remain valid during development. A contributor should
not rerun the complete root build after every isolated source change.

## 18. Testing strategy

### 18.1 Unit tests

Unit tests belong beside the module they validate. They cover parsing,
validation, registers, clocks, state transitions, faults, framing, runtime
drivers, scenario behavior, and Web components.

### 18.2 Integration tests

Server tests use complete package fixtures and verify:

- package-only configuration;
- rejection of legacy fields;
- runtime registry creation;
- REST payloads and error codes;
- adapter lifecycle and bindings;
- transaction routing;
- scenario/run behavior;
- event replay and persistence.

### 18.3 Native adapter tests

Each native adapter owns its CMake and focused tests. Root verification builds
the shared adapter transport, SPI CUSE adapter, I²C CUSE adapter, GPIO
simulator helper, and Micron Embedded Linux example from clean output
directories.

Root-required smoke tests are explicit and separate from default unprivileged
tests.

### 18.4 Web tests

Web verification covers routing, device filtering, editor navigation,
adapter/device lifecycle, transaction display, validation, and absence of
removed global routes.

### 18.5 Repository checks

The complete verification set is:

```shell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

npm --prefix apps/vds-web run lint
npm --prefix apps/vds-web run typecheck
npm --prefix apps/vds-web run test:run
npm --prefix apps/vds-web run build
```

Package/config validation and clean native builds are additional required
checks. Generated build outputs are not committed.

## 19. Change and extension rules

When adding a runtime bus:

1. define or extend the schema;
2. add a bus-specific runtime entry point behind the common device boundary;
3. implement a generic declarative driver;
4. extend the Protobuf data plane if a new request shape is required;
5. implement the Linux ABI adapter separately;
6. add a complete example package;
7. test runtime behavior and an unmodified compatibility client;
8. document limitations;
9. record the architectural decision.

When adding a device:

1. prefer an existing generic runtime driver;
2. describe only declarative model behavior;
3. keep all flows and scenarios inside the package;
4. include documentation and validation examples;
5. do not hardcode its semantics into the server, adapter, or Web UI.

Breaking changes are acceptable before a release, but stale compatibility
routes and legacy fields must not be retained without an accepted reason.

## 20. Architecture decision records

Accepted decisions live under `docs/adr/` and are immutable. If a decision
changes, add a superseding ADR and update this document. Do not rewrite an
accepted ADR to make history appear consistent with a later implementation.

The current ADR set records:

- the generic SPI first vertical slice;
- virtual time before state-machine execution;
- fault precedence;
- runtime device instances;
- managed Linux SPI CUSE;
- managed host adapters;
- behavior-flow compilation;
- kernel gpio-sim integration;
- public signal ports and board topology;
- signal observability and deadline-driven timers.

## 21. Final architectural constraint

Every externally visible hardware operation must converge on the same
authoritative runtime device state, whether it originates from a Linux device
node, a host adapter, a scenario, the CLI, or the control plane. Any design
that creates separate device truth in the Web UI, an adapter, a test-only mock,
or a compatibility route violates this architecture.
