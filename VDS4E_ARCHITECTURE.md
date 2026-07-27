# Virtual Device Simulator for Embedded (VDS4E)

## Current architecture

This document describes behavior implemented in the repository. Proposed
registry, publishing, package composition, lock-file, additional bus, and
full-system work belongs in [docs/ROADMAP.md](docs/ROADMAP.md).

## Product boundary

VDS4E provides deterministic functional simulations of embedded devices. It
models commands, registers, memory, state transitions, timing, faults, and
scenarios without claiming electrical or cycle accuracy.

The headless Rust server is authoritative. The Web application is a control,
authoring, and observability client; device behavior must never be implemented
only in the browser.

The dependency direction is:

```text
Web and CLI clients
        |
REST, WebSocket, and Unix-socket APIs
        |
Simulator runtime
        |
Generic device, register, scenario, and event engines
        |
Device packages and host adapters
        |
External applications
```

Dependencies must not point upward. The Web application is optional, scenarios
must run without a browser, and applications must not depend on Web code.

## Runtime components

- `apps/vds-server` loads configuration and packages, owns runtime device
  instances, exposes control APIs, accepts high-frequency Protobuf transactions
  over a Unix socket, and publishes domain events.
- `apps/vds-cli` validates and scaffolds packages and executes scenarios against
  the same public contracts.
- `apps/vds-web` manages devices and adapters, authors package-local behavior
  flows and scenarios, and displays transactions, logs, and telemetry.
- `crates/vds-core` contains configuration, package loading, clocks, scheduling,
  state machines, faults, devices, and the runtime registry.
- `crates/vds-device-model` loads and validates declarative models and executes
  generic SPI commands, I²C register transfers, GPIO line exchange, registers,
  memory, state transitions, timing, faults, behavior flows, and typed signal
  graphs.
- `crates/vds-registers`, `crates/vds-scenario`, `crates/vds-events`, and
  `crates/vds-protocol` provide focused reusable engines.
- `client/c` implements the native Unix-socket client.
- `adapters/spi-preload` maps normal Linux spidev calls into VDS4E without root.
- `adapters/spi-cuse` provides the privileged CUSE-based spidev integration.
- `adapters/gpio-sim` provisions real kernel `/dev/gpiochipX` controllers for
  libgpiod applications.

Host adapters implement standard Linux userspace ABIs so existing distribution
tools run unchanged against virtual devices. VDS4E does not recreate tools such
as `spidev_test`, `i2cdetect`, `i2cget`, `i2cset`, `i2ctransfer`, `gpiodetect`,
`gpioinfo`, `gpioget`, `gpioset`, or `gpiomon`. Adapter completeness is
measured by compatibility with those real tools. Protocol and device behavior
remain in the transaction data plane and virtual device runtime rather than
being hardcoded into tool-specific adapter paths.

The REST API is the control plane. Protobuf-framed Unix-socket messages are the
transaction data plane. WebSocket delivery provides ordered event replay and
live updates. REST payloads remain independent of Web component structures.

## Device package contract

Device packages are the only configuration source for runtime models, behavior
flows, and scenarios. Server configuration requires `device_packages`; the
legacy `device_models` field and root-level `scenarios` field are rejected.

Each package contains `device-package.yaml`:

```yaml
api_version: vds4e.dev/v1alpha1
kind: DevicePackage

metadata:
  id: example-spi-device
  display_name: Example SPI Device
  version: 1.0.0

spec:
  bus:
    type: spi
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

`metadata.id` must match the model device ID. All declared resources are
package-relative and must remain inside the package after canonicalization.
Package-local `scenarios/` is the sole scenario configuration source.

The schema in `schemas/device-package.schema.json` is authoritative. The model
schema is `schemas/device-model.schema.json`; server configuration is governed
by `schemas/server-config.schema.json`.

Repository examples are copied into the per-user managed package store before
use. An unmanaged package with the same ID is never overwritten. Installation
publishes a complete staged copy so readers never observe a partially copied
package.

## Device behavior and execution

The model runtime is deterministic for a given package, request sequence,
virtual clock, and fault configuration.

- Command dispatch uses explicit opcodes and validates payload shape.
- Register access enforces width and access mode.
- Memory operations enforce geometry and package-relative backing-file access.
- State transitions execute guards, entry actions, exit actions, and scheduled
  events through virtual time.
- Timed operations expose busy state and deterministic completion.
- Fault rules use declared priority, trigger, persistence, and terminal action.
- Reset cancels pending operations and restores declared transient state.

Behavior-flow YAML is compiled into the same typed runtime structures used by
hand-authored models. The Web editor does not define a separate execution
semantics.

## Scenarios

Scenario definitions live inside device packages and execute through
`vds-scenario`. The server retains `/api/v1/scenarios` as its internal runtime
API boundary.

In the Web application scenarios and behavior flows are device features:

- `/devices/:deviceId/flows`
- `/devices/:deviceId/flows/new`
- `/devices/:deviceId/flows/:flowId`
- `/devices/:deviceId/scenarios`
- `/devices/:deviceId/scenarios/new`
- `/devices/:deviceId/scenarios/:scenarioId`

There are no global authoring routes. Tab selection, filtering, save, cancel,
and back navigation remain scoped to the URL device.

## Observability and storage

Structured events cover transactions, state transitions, timed operations,
faults, scenarios, and adapter activity. Each event receives a monotonically
increasing ID. The in-memory bounded ring supports replay and live
subscriptions; SQLite persistence restores retained events after restart.

Host and bus telemetry are exposed through server APIs. Logging must not expose
secrets or private package data beyond information required to diagnose the
active request.

## Security

Device packages are untrusted declarative input.

- YAML and JSON shapes are schema-validated and reject unknown fields where the
  contract requires it.
- Package paths are normalized, canonicalized, and prevented from escaping the
  package root.
- Packages cannot introduce executable runtime extensions.
- Runtime commands validate lengths, addresses, state, and access permissions.
- The default server, Web application, CLI, C client, and preload adapter do not
  require root.
- CUSE and gpio-sim setup are explicitly privileged and isolated in their
  adapters.
- Company-private protocols, models, test vectors, and device knowledge must
  remain outside the public repository.

## Testing and change rules

Every contract change must update its schema, fixtures, implementation, tests,
and documentation together.

Required repository checks are:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked`
- server package/config validation
- Web lint, TypeScript checking, unit tests, and production build
- clean builds for the C client, SPI preload adapter, SPI CUSE adapter, GPIO
  simulator adapter, and Micron Embedded Linux example

Tests that exercise server loading use complete device-package fixtures.
Legacy configuration fields and global authoring routes must have explicit
negative coverage. Module-local tests stay with their owning module; the
repository does not keep a root test tree or empty placeholder modules.

Architectural changes are recorded under `docs/adr/`. Accepted ADRs describe
implemented decisions; unimplemented work stays in the roadmap.
