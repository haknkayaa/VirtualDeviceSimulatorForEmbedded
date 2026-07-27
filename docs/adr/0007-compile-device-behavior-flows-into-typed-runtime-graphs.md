# ADR 0007: Compile device behavior flows into typed runtime graphs

- Status: Accepted
- Date: 2026-07-27

## Context

Device packages may declare an editable `flows/behavior.yaml`, but the server
previously loaded runtime behavior only from `model/device.yaml`. This created
two potential behavior sources and made visual logical, timing, and file-I/O
nodes editor-only metadata.

The existing runtime already provides a deterministic state-machine engine,
virtual clock, and event scheduler. Reimplementing those facilities in the Web
UI would violate the headless-runtime boundary. Interpreting arbitrary scripts
or unrestricted file paths from community packages would violate the package
trust boundary.

The runtime needs a deterministic representation for boolean logic, timing,
typed file I/O, state-entry activation, and state-exit cancellation.

## Decision

When a device package declares `spec.authoring.behavior_flow`, the server
compiles that flow while loading the package. The behavior flow is the
authoritative source for the package runtime state machine and typed signal
graph. A static state machine in `model/device.yaml` remains the fallback for
legacy models and packages without a behavior flow.

State-to-state connections use `device_behavior.transition`. Typed data-flow
connections use `device_behavior.signal`.

A state-to-signal edge emits boolean `true` when its source state is entered.
Signal ports carry boolean, bytes, text, or JSON values:

- NOT, AND, OR, NAND, NOR, XOR, and XNOR consume boolean values.
- Timer emits once after its duration.
- Delay forwards its input after its duration.
- Timeout emits after its configured duration once activated.
- Interval emits repeatedly at its configured duration.
- File Read emits bytes, UTF-8 text, or parsed JSON.
- File Write consumes `a` as trigger and `b` as content, then emits success.

Timing nodes use the simulator clock and scheduler. Pending signal work is
owned by the active state and cancelled when that state exits. Signal graphs
must be acyclic; Interval is the explicit repetition primitive.

Device packages remain declarative. File paths must be package-relative.
Absolute paths, parent traversal, and canonical symlink escapes are rejected.
File Write targets must be inside package `runtime-data/`; generated files are
runtime artifacts rather than package source.

The Web preview and Rust package-load compiler emit the same state-machine and
signal-graph structure. Runtime execution remains in Rust.

## Alternatives

### Keep `model/device.yaml` authoritative

Rejected because visual edits would not affect runtime behavior and authors
would maintain two synchronized representations.

### Copy generated graph data into `model/device.yaml`

Rejected because generated artifacts could drift from the editable flow.

### Execute flows in the Web UI

Rejected because headless CI is mandatory, browser timing is nondeterministic,
and device behavior must not live in UI callbacks.

### Permit scripts or unrestricted filesystem access

Rejected because community packages are untrusted input. Arbitrary code or
host filesystem access would cross the package security boundary.

## Consequences

- Saving and deploying `behavior.yaml` changes package runtime behavior.
- Invalid flows fail before their device is registered.
- Logical and timing behavior is deterministic under the virtual clock.
- File-I/O nodes exchange fixture/runtime data without escaping the package.
- Standalone models continue using their static state machine.
- Flow and runtime compiler changes require compatibility review.
- Signal output observability can expand without changing execution semantics.

## Migration impact

Packages without `spec.authoring.behavior_flow` require no changes.

Packages declaring a behavior flow must ensure it compiles. Their static
`model/device.yaml` state machine is no longer authoritative at runtime. File
Write paths must move under `runtime-data/`, and timing values must be exactly
representable in the simulator time domain.

The generic SPI reference package is the compatibility example and exercises
all supported logical, timing, and file-I/O nodes.
