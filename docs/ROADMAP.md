# VDS4E roadmap

This document tracks planned capabilities that are not part of the current
runtime contract. Items move into `VDS4E_ARCHITECTURE.md` only after their
implementation and ADR are accepted.

## Cross-device coupling

Current state: not implemented. Each runtime device is isolated. A behavior
flow or signal graph (`crates/vds-device-model/src/signal_graph.rs`) operates
only on the registers, state, and signals of its own device, and the
repository contains no model, schema field, or runtime path by which an I2C or
SPI device drives a line of a GPIO device. The only way to change a GPIO line
today is to write the GPIO bank's `GPIOn_STATE` registers directly through the
control API, the Web UI, or a scenario step; a sensor model cannot do so.

Design: [ADR 0011](adr/0011-connect-devices-through-public-signal-ports.md)
(proposed).

Planned work:

- Add a declarative topology link, for example a data-ready output of an
  I2C/SPI sensor model wired to a line of a `generic-gpio-bank` device, so the
  runtime (not an ABI adapter) propagates the signal.
- Support a behavior flow in which a sensor completes a conversion, asserts a
  DRDY line, the application observes the edge with `gpiomon` (or libgpiod),
  and then reads the sample over `/dev/spidevX.Y` or `/dev/i2c-N`; reading the
  data clears DRDY.
- Keep the link in the package and topology layer. Device-specific knowledge
  must not move into the SPI, I2C, or GPIO host adapters.
- Define ordering and time semantics for propagated edges, and cover the flow
  with a scenario that asserts the edge and the subsequent read.

## Additional host adapters and buses

- Ethernet TAP or socket endpoints and PCAP export.
- QSPI multi-lane/DTR host integration beyond the current SPI subset.
- Optional QEMU and full-system integration after functional adapters mature.

Every new bus keeps its host adapter, transport contract, and declarative
device semantics separate. Placeholder source directories are not created
before implementation begins.

## Device library and registry

- Git-backed and HTTP registry indexes.
- Search by vendor, bus, command, register, tag, license, and compatibility.
- Package import/export with checksums, signatures, archive hardening, and
  duplicate/version conflict handling.
- Semantic dependency resolution, composition, project lock files, and
  deterministic package restoration.
- Community publishing, review, validation badges, and registry REST/CLI
  surfaces.

The local package directory and current Device Library UI remain the supported
baseline until these capabilities ship.

## Runtime and observability

- Metrics export and distributed traces.
- Additional runtime drivers for Ethernet, CAN, and USB package profiles.
- Storage images, snapshot/restore, wear simulation, and power-loss recovery.
- Expanded conformance suites and cross-version compatibility testing.
- Optional deterministic virtual-time mode for the live server and host
  adapters. Today the live server uses a wall-clock-backed clock, and only
  headless scenarios, the run API, and the CLI use the manual virtual clock.

## Product opportunity backlog

The items in this section are unprioritized opportunities, not committed
release scope. They must preserve the native x86_64 application and standard
Linux ABI workflow. CPU execution, full-system boot, kernel-driver simulation,
and instruction-level analysis remain optional backend integrations rather than
responsibilities of the VDS4E device runtime.

### Platform import and generation

- Import Device Tree sources and overlays into a reviewable topology draft.
- Generate a virtual-board draft from DTS connectivity, addresses, interrupts,
  and compatible strings without claiming unsupported device behavior.
- Import relevant Yocto machine and distribution metadata. `SDKMACHINE=x86_64`
  must not be treated as proof that the SDK target is x86_64.
- Provide a guided Yocto workflow for building the production application with
  an x86_64 target SDK/sysroot and connecting it to VDS4E host adapters.
- Analyze kernel configuration and driver-probe logs to identify missing device
  interfaces and suggest compatible model packages.
- Import CMSIS-SVD register metadata where applicable.
- Generate schema-valid peripheral stubs from DTS, SVD, or reviewed datasheet
  metadata while keeping device semantics out of ABI adapters.
- Define an optional full-system backend abstraction without redefining VDS4E
  as an ARM binary or CPU emulator.

### Model authoring and debugging

- Add a visual topology designer with drag-and-drop peripheral composition.
- Expand register-map authoring and live inspection workflows.
- Add isolated model unit tests, fixtures, and a model-focused debugger.
- Add a waveform-style SPI, I2C, GPIO, UART, and CAN protocol viewer backed by
  bus-neutral transaction events.
- Add transaction timelines with filtering, correlation, and export.
- Publish a stable third-party model SDK and compatibility policy after package
  trust and versioning rules are stable.

### Reproducible state and time-travel debugging

- Add runtime checkpoint and restore for device state, virtual time, scheduled
  work, enabled faults, and topology.
- Record deterministic transaction and control-plane inputs for execution
  replay.
- Add reverse navigation by restoring checkpoints and replaying recorded input;
  do not imply CPU-instruction reverse debugging in the native adapter model.
- Synchronize virtual time and events across multi-node simulations.
- Make simulation states shareable as immutable, versioned artifacts.
- Support a single-link reproducible bug session with package, topology,
  scenario, event, and state provenance.

### Faults and environment modeling

- Build a reusable, reviewed fault-profile library and registry.
- Add explicit scheduled and probabilistic fault activation policies.
- Model power-cycle, brownout, thermal, and environmental conditions at the
  functional device-behavior level.
- Add reusable sensor and actuator environments.
- Evaluate a deterministic wireless-medium model for IoT scenarios.

### Hardware and simulation bridges

- Add narrowly scoped hardware-in-the-loop bridges while keeping real and
  virtual endpoints explicit in topology and results.
- Add real UART, SocketCAN, and Ethernet bridge modes after their normal Linux
  host adapters are complete.
- Evaluate FPGA RTL co-simulation through Verilator/DPI.
- Evaluate SystemC/TLM interoperability for pre-silicon and enterprise
  workflows.
- Delegate instruction tracing, memory instrumentation, CPU profiling, and
  cache/MMU analysis to optional full-system backends.

### Collaboration, automation, and scale

- Add coverage metrics for models, state transitions, registers, faults, and
  scenarios.
- Expand test-case management and regression dashboards around the existing
  headless scenario and JUnit interfaces.
- Support distributed, cloud-scale simulation workers with deterministic input
  and artifact capture.
- Share browser-hosted simulation sessions with access control, comments, and
  review history.

### Assisted model generation

- Generate a peripheral-model skeleton from a datasheet PDF for human review.
- Combine DTS connectivity and datasheet semantics into a working model draft.
- Extract candidate register access rules, bitfields, reset values, and command
  semantics with source provenance.
- Generate fault scenarios from declared device behavior and requirements.
- Analyze driver source to infer expected hardware transactions and suggest
  missing model behavior.

Generated content must remain declarative, schema-validated, reviewable, and
deterministic. Assisted generation must not introduce arbitrary package code or
device-specific logic into Linux ABI adapters.

## Capabilities removed from the README comparison

The README no longer lists the following as table rows because they are not
implemented. They are tracked here: Device Tree import and automatic virtual
board generation, drag-and-drop peripheral composition, snapshot/checkpoint,
record/replay, multi-node simulation, HIL/real hardware bridge, RTL/SystemC
co-simulation, AI-assisted peripheral generation, datasheet-to-model
generation, driver-to-hardware-model assistance, and shareable reproducible
simulation sessions. See the sections above for each item.

## Delivery order

1. Stabilize the package-only SPI, I²C, and GPIO runtimes, their Linux host
   adapters, device-scoped authoring, scenarios, persistence, and CI.
2. Add one runtime driver and host adapter at a time with an ADR, schema,
   package example, and end-to-end test.
3. Add registry and publishing features only after package compatibility and
   trust rules are stable.
4. Consider full-system/QEMU work only after Level 1 and Level 2 simulation are
   reliable.
