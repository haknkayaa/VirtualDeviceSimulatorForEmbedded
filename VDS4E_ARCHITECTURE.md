# Virtual Device Simulator for Embedded (VDS4E)
## Architecture and Development Constitution

**Document status:** Authoritative  
**Project name:** Virtual Device Simulator for Embedded  
**Short name:** VDS4E  
**Repository name:** `virtual-device-simulator`  
**Primary purpose:** Enable embedded Linux applications to be developed and tested on Ubuntu hosts or virtual machines without requiring physical target hardware.

---

# 1. Document Purpose

This document is the architectural source of truth for VDS4E.

All developers, AI coding assistants, code generators, reviewers, and automation tools working on this repository must follow this document.

When a proposed implementation conflicts with this document:

1. The implementation must not proceed silently.
2. The conflict must be documented.
3. An Architecture Decision Record (ADR) must be created.
4. This document must be updated before the new direction is implemented.

The project must not drift into:

- A generic dashboard with weak simulation capabilities
- A collection of disconnected mock libraries
- A QEMU-only emulator
- A framework tied to one embedded product
- A Web UI that contains device behavior
- A test tool that cannot run headless
- A replacement for real target or hardware-in-the-loop testing

The intended product is:

> A deterministic, observable, scriptable virtual embedded hardware laboratory that allows host applications, integration tests, diagnostic tools, and eventually target binaries to interact with simulated GPIO, SPI, I2C, QSPI, UART, Ethernet, and custom embedded devices.

---

# 2. Problem Statement

Embedded Linux applications frequently depend on interfaces that exist only on target hardware:

- `/dev/gpiochipN`
- `/dev/spidevX.Y`
- `/dev/i2c-N`
- `/dev/tty*`
- MTD and QSPI devices
- Raw Ethernet interfaces
- Custom kernel drivers
- GPIO interrupts
- Device-specific register maps
- Timing-dependent state transitions
- Diagnostic messages and fault conditions

On Ubuntu hosts and virtual machines:

- Required device nodes do not exist.
- Target kernel drivers are unavailable.
- Host and target sysroots differ.
- Applications may fail to compile because host dependencies are absent.
- Applications may compile but fail at runtime because physical devices are missing.
- Integration testing requires scarce target hardware.
- Failure scenarios are difficult, unsafe, or expensive to reproduce.
- CI pipelines cannot execute meaningful hardware-facing tests.

VDS4E addresses runtime hardware absence and testability.

VDS4E does not replace:

- Yocto SDK generation
- Correct cross-compilation toolchains
- Real target validation
- Hardware-in-the-loop testing
- Certification testing
- Electrical behavior validation

---

# 3. Project Goals

## 3.1 Functional Hardware Simulation

Applications must be able to:

- Read and write GPIO lines
- Receive GPIO edge events
- Execute SPI transactions
- Read and write I2C registers
- Execute QSPI commands
- Exchange UART frames
- Send and receive Ethernet packets
- Read and write device registers
- Trigger device state transitions
- Receive realistic responses
- Observe timing, retries, errors, and recovery behavior

## 3.2 Device Modeling

Users must be able to define virtual devices through configuration.

A device model may include:

- Register maps
- Register fields
- Access rules
- Command opcodes
- Memory regions
- State machines
- Timers
- Interrupts
- GPIO dependencies
- Bus behavior
- Response delays
- Fault behavior
- Reset behavior
- Power-state behavior

## 3.3 Observability

The platform must expose:

- Transaction history
- Register reads and writes
- GPIO transitions
- State-machine transitions
- Bus throughput
- Latency
- Error counts
- Fault injections
- Packet statistics
- Diagnostic message statistics
- Scenario results
- Test run results

## 3.4 Fault Injection

Users must be able to simulate:

- Timeouts
- CRC failures
- NACK responses
- Short transfers
- Invalid data
- Stuck register bits
- GPIO glitches
- Missing interrupts
- Packet loss
- Network delay
- Storage corruption
- Power failure
- Device busy states
- Partial writes
- Link-up and link-down transitions

## 3.5 Automation

Every important feature must be usable without the Web UI.

The system must provide:

- CLI commands
- Machine-readable configuration
- Scenario execution
- Deterministic test runs
- JUnit XML output
- Headless CI operation
- Repeatable random seeds
- Exportable traces
- Exportable packet captures

## 3.6 Extensibility

The architecture must support new protocols and device models without modifying unrelated modules.

---

# 4. Non-Goals

## 4.1 Electrical Simulation

VDS4E does not simulate:

- Voltage levels
- Signal integrity
- Rise and fall times
- EMI/EMC behavior
- Analog circuit behavior
- Physical bus contention
- PCB-level faults

## 4.2 Cycle-Accurate Processor Emulation

VDS4E is not initially intended to emulate:

- CPU pipelines
- MMU timing
- Cache behavior
- DMA timing
- Exact SoC peripheral timing
- Full i.MX8MQ hardware

Full-system emulation may be added later through QEMU integration.

## 4.3 Certification Replacement

VDS4E results must not be treated as proof of target hardware compliance.

## 4.4 Yocto SDK Replacement

Missing target headers and libraries must still be solved through proper SDK and sysroot management.

---

# 5. Core Architectural Principles

## 5.1 Separate Control Plane and Data Plane

The Web UI and REST API form the control plane.

Hardware transactions form the data plane.

The Web UI must never be the direct transport for SPI, I2C, GPIO, UART, QSPI, or Ethernet operations.

## 5.2 Headless Operation Is Mandatory

Every essential feature must work through CLI and configuration files.

The Web UI is a client, not the product core.

## 5.3 Determinism Is More Important Than Visual Polish

A scenario executed with the same configuration and random seed must produce the same result unless explicitly configured otherwise.

## 5.4 Device Behavior Must Not Be Hardcoded in the Web UI

Device behavior belongs in:

- Device models
- Plugins
- State machines
- Register definitions
- Scenario definitions

## 5.5 Bus Models and Device Models Must Be Separate

A SPI bus transports transactions.

A device model interprets device-specific commands.

A generic SPI implementation must not contain product-specific behavior.

## 5.6 Production Code Must Remain Backend Independent

Application business logic must not depend directly on simulation APIs.

A hardware abstraction layer must isolate:

- Real Linux hardware backend
- VDS4E backend

## 5.7 Linux ABI Support Is Incremental

The project starts with functional simulation and later adds kernel-visible interfaces.

## 5.8 Privileged Operations Must Be Isolated

The main server and Web UI must not run as root.

Operations requiring elevated privileges must be handled by a minimal system agent.

## 5.9 Configuration Must Be Versioned

Every device model, scenario, protocol definition, and fault schema must contain a schema version.

## 5.10 Observability Is a Core Feature

Every transaction must be traceable.

Logging, metrics, and event correlation must be designed from the beginning.

---

# 6. Simulation Levels

## Level 1: Functional Simulation

Applications use a VDS4E client backend instead of direct Linux device access.

Characteristics:

- Fast
- Deterministic
- CI-friendly
- No root permission required
- Suitable for host integration tests
- Initial implementation target

```text
Application
    |
Hardware Abstraction Layer
    |
VDS4E Client SDK
    |
Unix Domain Socket
    |
VDS4E Server
```

## Level 2: Linux ABI Simulation

Applications access Linux-compatible interfaces.

Examples:

- `/dev/gpiochip0`
- `/dev/i2c-10`
- `/dev/spidev0.0`
- Virtual network interfaces
- PTY-backed UART devices

Possible techniques:

- `gpio-sim`
- `i2c-stub`
- `LD_PRELOAD`
- Custom kernel test modules
- Network namespaces
- TAP interfaces
- PTY devices

Level 2 must be implemented only after Level 1 is stable.

## Level 3: Full-System Simulation

A target root filesystem, target application, and target kernel run under QEMU.

Characteristics:

- Highest fidelity
- Highest implementation cost
- SoC and driver dependent
- Not part of the initial MVP

---

# 7. High-Level Architecture

```text
+----------------------------------------------------------+
|                       Web Application                    |
| Devices | Registers | GPIO | Buses | Faults | Scenarios  |
+------------------------------+---------------------------+
                               |
                         REST / WebSocket
                               |
+------------------------------v---------------------------+
|                         VDS4E Server                     |
|                                                          |
|  Device Registry                                         |
|  Register Engine                                         |
|  State Machine Engine                                    |
|  Scenario Engine                                         |
|  Fault Injection Engine                                  |
|  Transaction Router                                      |
|  Metrics and Trace Collector                             |
|  Persistent Configuration                                |
+-----------+------------------+------------------+---------+
            |                  |                  |
+-----------v-------+ +--------v---------+ +------v---------+
| Client SDK Adapter| | Linux ABI Adapter| | Network Adapter|
| C / C++           | | GPIO/I2C/SPI/UART| | veth/TAP/netem |
+-----------+-------+ +--------+---------+ +------+---------+
            |                  |                  |
+-----------v------------------v------------------v---------+
|                 Applications Under Test                  |
+----------------------------------------------------------+
```

---

# 8. Technology Stack

## 8.1 Simulator Core

**Language:** Rust

Required ecosystem:

- Tokio
- Axum
- Serde
- Serde YAML
- Protobuf
- Unix domain sockets
- Tracing
- Prometheus client
- SQLite

Reasons:

- Memory safety
- Strong concurrency model
- Suitable for protocol parsing
- Reliable long-running daemon
- Easy binary distribution
- C-compatible FFI support

## 8.2 Web Frontend

**Language:** TypeScript  
**Framework:** React  
**Build system:** Vite

Recommended libraries:

- TanStack Query
- Zustand
- shadcn/ui
- Monaco Editor
- ECharts or uPlot
- WebSocket client

## 8.3 Client Libraries

Required:

- C client library
- Optional C++ wrapper

The C API is the canonical application integration API.

## 8.4 Internal Transport

Primary local transport:

- Unix domain socket
- Protobuf messages

REST must not be used for high-frequency bus transactions.

## 8.5 Configuration

Primary formats:

- YAML for human-authored device models and scenarios
- JSON for REST API payloads
- Protobuf for internal binary transport

## 8.6 Storage

Use SQLite for:

- Device definitions
- Scenario definitions
- Run metadata
- Fault profiles
- User settings
- Test summaries

Do not store every high-frequency transaction permanently in SQLite.

Use:

- In-memory ring buffer for recent transactions
- Prometheus for metrics
- Optional trace backend for long-term tracing
- PCAP files for packet capture

---

# 9. Repository Structure

```text
virtual-device-simulator/
├── Cargo.toml
├── README.md
├── VDS4E_ARCHITECTURE.md
├── CONTRIBUTING.md
├── LICENSE
│
├── apps/
│   ├── vds-server/
│   ├── vds-cli/
│   ├── vds-system-agent/
│   └── vds-web/
│
├── crates/
│   ├── vds-core/
│   ├── vds-protocol/
│   ├── vds-registers/
│   ├── vds-state-machine/
│   ├── vds-scenario/
│   ├── vds-faults/
│   ├── vds-metrics/
│   ├── vds-storage/
│   ├── vds-device-model/
│   └── vds-device-sdk/
│
├── client/
│   ├── c/
│   └── cpp/
│
├── adapters/
│   ├── functional/
│   ├── gpio-sim/
│   ├── i2c-stub/
│   ├── spi-preload/
│   ├── uart-pty/
│   ├── network/
│   └── qemu/
│
├── plugins/
│   ├── gpio/
│   ├── spi-generic/
│   ├── i2c-generic/
│   ├── qspi-generic/
│   ├── ethernet/
│   └── custom/
│
├── device-models/
│   ├── examples/
│   ├── max31875/
│   ├── tca9539/
│   └── eeprom/
│
├── scenarios/
│   ├── examples/
│   └── regression/
│
├── schemas/
│   ├── device-model.schema.json
│   ├── scenario.schema.json
│   └── fault.schema.json
│
├── proto/
│   └── vds.proto
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── system/
│   └── fixtures/
│
├── docker/
├── scripts/
├── docs/
│   ├── adr/
│   ├── protocols/
│   ├── device-models/
│   └── development/
│
└── examples/
    ├── c-client/
    ├── cpp-client/
    └── sample-application/
```

---

# 10. Core Domain Model

## 10.1 Device

A device represents a virtual hardware component.

A device owns:

- Registers
- Memory regions
- State
- Timers
- Fault state
- Device-specific behavior
- Bus endpoints
- Metrics
- Event history

## 10.2 Bus

A bus transports transactions.

Initial bus types:

- GPIO
- SPI
- I2C
- QSPI
- UART
- Ethernet

Bus responsibilities:

- Routing
- Timing metadata
- Transaction validation
- Addressing
- Transfer statistics
- Error propagation

A bus must not implement device-specific command behavior.

## 10.3 Register

The register engine must support:

- RO
- WO
- RW
- W1C
- W0C
- Read-to-clear
- Read-to-set
- Self-clearing bits
- Reserved fields
- Reset values
- Masks
- Endianness
- Volatile values
- Banked registers
- Book/page/register addressing
- Side effects

## 10.4 Memory Region

A memory region represents:

- Flash
- EEPROM
- RAM
- FIFO
- Ring buffer
- Device-specific storage

A memory region must define:

- Size
- Address range
- Erase granularity
- Program granularity
- Read granularity
- Default content
- Persistence mode
- Corruption behavior

## 10.5 Transaction

All bus operations must be normalized into a shared transaction model.

A transaction must include:

- Transaction ID
- Timestamp
- Bus ID
- Device ID
- Operation type
- Request bytes
- Response bytes
- Address information
- Timing metadata
- Result
- Error code
- Trace context
- Scenario run ID

## 10.6 Event

Events represent internal and external changes.

Examples:

- GPIO changed
- Interrupt asserted
- Register written
- State changed
- Timer expired
- Device reset
- Packet received
- Fault injected
- Operation completed
- Operation timed out

## 10.7 Fault

A fault consists of:

- Target
- Trigger
- Action
- Duration
- Repeat behavior
- Priority
- Optional probability
- Optional deterministic seed

---

# 11. Register Engine Requirements

The register engine is a core reusable subsystem.

It must support declarative register definitions.

Example:

```yaml
schema_version: 1

registers:
  - name: STATUS
    address: 0x0002
    width_bits: 16
    reset_value: 0x0400
    access: rw

    fields:
      - name: READY
        bit_offset: 10
        bit_width: 1
        access: ro

      - name: WRITE_ENABLE
        bit_offset: 1
        bit_width: 1
        access: rw
```

The engine must validate:

- Overlapping fields
- Invalid bit ranges
- Duplicate addresses
- Illegal writes
- Invalid widths
- Endianness conflicts
- Unknown side effects

Register side effects must be represented as engine actions or plugin behavior, not UI callbacks.

---

# 12. State Machine Engine

Real devices are not simple register arrays.

The state machine engine must support:

- Named states
- Events
- Conditions
- Transitions
- Entry actions
- Exit actions
- Delayed events
- Timers
- Guard expressions
- Reset transitions
- Fault-driven transitions

Example states:

- powered_off
- booting
- ready
- busy
- error
- resetting

The engine must be deterministic.

Wall-clock time must be abstracted through a simulator clock.

Tests must be able to:

- Advance virtual time
- Freeze time
- Run in real-time mode
- Run faster than real time

---

# 13. Device Plugin Model

Generic behavior belongs in the core.

Protocol- or product-specific behavior belongs in plugins.

A plugin may provide:

- Device factory
- Transaction decoder
- Command handlers
- Validation rules
- State behavior
- Register extensions
- Fault handlers
- Metrics
- UI metadata

Initial plugins:

- Generic GPIO
- Generic SPI register device
- Generic I2C register device
- Generic QSPI flash
- Generic UART endpoint
- Ethernet endpoint
- MAX31875
- TCA9539
- EEPROM

Plugin-specific code must not leak into unrelated core crates.

---

# 14. Hardware Abstraction Strategy

Applications should use a backend abstraction.

Recommended shape:

```text
Application Logic
      |
Hardware Interface
      |
+-----------------------+
| Linux Backend         |
| VDS4E Backend         |
+-----------------------+
```

The Linux backend uses:

- libgpiod
- spidev ioctl
- i2c-dev
- serial APIs
- sockets
- custom device nodes

The VDS4E backend uses:

- VDS4E C client
- Unix domain socket
- Protobuf requests

The production application must not include simulator-specific decisions in business logic.

Backend selection may occur through:

- Build option
- Dependency injection
- Runtime configuration
- Environment variable

---

# 15. Linux ABI Adapters

Linux ABI adapters belong to Level 2.

## 15.1 GPIO

Preferred technology:

- Linux `gpio-sim`

Responsibilities:

- Create virtual gpiochips
- Define line names
- Change input values
- Observe output values
- Generate edge events
- Expose line state to VDS4E

## 15.2 I2C

Initial technology:

- `i2c-stub` for simple devices

Advanced behavior:

- Custom kernel test adapter
- VDS4E transaction bridge

Simple register storage and complex stateful devices must remain distinct.

## 15.3 SPI

Initial approach:

- Functional VDS4E backend

Secondary approach:

- `LD_PRELOAD` interception for dynamically linked legacy applications

Later approach:

- Custom kernel SPI simulation adapter
- QEMU device model

The project must not begin by implementing a custom SPI kernel controller.

## 15.4 UART

Use:

- PTY pairs
- Optional `socat`
- Native Rust PTY management where needed

The application side receives a `/dev/pts/N` endpoint.

## 15.5 Ethernet

Use Linux networking primitives:

- Network namespaces
- veth pairs
- Bridges
- TAP interfaces
- `tc netem`

Supported fault controls:

- Latency
- Jitter
- Loss
- Duplication
- Reordering
- Corruption
- Bandwidth limit
- Link down
- MTU changes

---

# 16. QSPI and Storage Simulation

The QSPI engine must model more than register reads.

It must support:

- Device geometry
- Page size
- Erase block size
- Program rules
- Write-enable latch
- Busy state
- Read latency
- Program latency
- Erase latency
- Invalid address errors
- Partial writes
- Power-loss behavior
- Corruption
- Bad regions
- Optional persistence

Product-specific storage devices must be implemented outside the generic QSPI
layer and consume only generic QSPI and memory primitives.

---

# 17. Ethernet and Diagnostic Traffic

Ethernet simulation must support:

- UDP
- TCP
- Raw Ethernet
- Multicast
- Broadcast
- Packet capture
- Interface statistics
- Configurable link speed
- Fault injection

Diagnostic traffic views must show:

- Timestamp
- Source
- Destination
- Protocol
- Message identifier
- Length
- Sequence number
- CRC result
- Processing latency
- Result
- Raw bytes

PCAP export must be supported for packet-based protocols.

---

# 18. Reserved Company-Private Protocol Extensions

The public VDS4E roadmap and open-source repository must not contain implementation plans, device models, protocol decoders, test vectors, timing behavior, conformance logic, or reusable packages for company-proprietary or strategically sensitive communication protocols.

Such capabilities must be developed as private extensions outside the public repository.

Private extensions may use the public plugin interfaces for:

- Custom bus adapters
- Custom protocol decoders
- Register and memory models
- Diagnostic message models
- Scenario libraries
- Fault-injection profiles
- Private device packages

The public core may provide generic extension points, but it must not name, document, roadmap, or ship company-sensitive protocol implementations.

Private extensions must be stored in company-controlled repositories and distributed only through approved private registries or internal build systems.

Required boundary:

```text
Public VDS4E Core
        |
Stable Plugin and Package APIs
        |
Company-Private Protocol Repositories
```

The public project must remain fully functional without access to any company-private extension.

---

# 19. Fault Injection Engine

Fault injection is a first-class subsystem.

A fault definition must include:

- Target device or bus
- Trigger
- Action
- Optional duration
- Optional count
- Optional probability
- Optional seed
- Optional recovery action

Supported trigger types:

- Manual
- Time-based
- Event-based
- Every Nth transaction
- Address match
- Opcode match
- State match
- Scenario step
- Probability with fixed seed

Supported actions:

- Timeout
- Delay
- Drop
- Corrupt
- Return error
- Force value
- Stuck-at value
- Abort operation
- Set device state
- Toggle GPIO
- Trigger interrupt
- Link down
- Partial write
- Memory corruption

Fault behavior must be observable and logged.

---

# 20. Scenario Engine

Scenarios define repeatable system tests.

A scenario consists of:

- Setup
- Initial state
- Steps
- Actions
- Wait conditions
- Assertions
- Cleanup
- Seed
- Timeout
- Output configuration

Supported actions:

- Load device model
- Reset device
- Set register
- Set GPIO
- Start process
- Stop process
- Send transaction
- Inject fault
- Advance virtual time
- Wait for event
- Capture traffic
- Export results

Supported assertions:

- Register equals value
- GPIO equals value
- State equals value
- Event occurred
- Event did not occur
- Packet count
- Error count
- Latency threshold
- Log contains text
- Process exit code
- Transaction result

Scenario runs must produce:

- Human-readable summary
- JSON result
- JUnit XML
- Event timeline
- Optional PCAP
- Optional trace export

---

# 21. Observability

## 21.1 Logs

Use structured logs.

Required fields where applicable:

- Timestamp
- Level
- Component
- Device ID
- Bus ID
- Transaction ID
- Scenario ID
- Event type
- Result
- Error code

## 21.2 Metrics

Required metric categories:

- Transaction count
- Error count
- Bytes transmitted
- Bytes received
- Latency histogram
- Active device count
- Device state
- Fault count
- GPIO event count
- Register access count
- Packet drop count
- Scenario pass/fail count

## 21.3 Traces

A transaction trace may include:

- Client request
- Routing
- Bus processing
- Command decoding
- Register access
- State transition
- Fault processing
- Response creation

OpenTelemetry compatibility is preferred.

---

# 22. Web Application Requirements

The Web UI must provide:

- Dashboard
- Device list
- Device editor
- Register viewer/editor
- GPIO panel
- Bus transaction analyzer
- Memory viewer
- Fault injection panel
- Scenario editor
- Scenario runner
- Metrics view
- Logs view
- Packet view
- State-machine view

The UI must consume public APIs.

The UI must not:

- Directly access SQLite
- Implement device logic
- Implement bus logic
- Become mandatory for CI
- Require a browser for configuration

---

# 23. API Boundaries

## 23.1 REST API

Use REST for:

- Device CRUD
- Scenario CRUD
- Fault profile CRUD
- Configuration
- Test run control
- Historical summaries
- Model validation

## 23.2 WebSocket

Use WebSocket for:

- Live events
- Register changes
- GPIO changes
- Transaction streams
- Scenario progress
- Metrics updates
- Logs

## 23.3 Unix Domain Socket

Use Unix domain sockets for:

- High-frequency local transactions
- C/C++ client communication
- Low-latency simulation requests

## 23.4 Protobuf

Protobuf schemas are authoritative for internal binary messages.

Backward compatibility rules must be followed:

- Never reuse removed field numbers.
- Add optional fields instead of breaking existing fields.
- Version major protocol changes explicitly.

---

# 24. Security and Privilege Model

The main server must run as a normal user.

The system agent may perform:

- Kernel module setup
- configfs operations
- Network namespace creation
- veth creation
- TAP creation
- `tc netem` configuration
- Device node setup

The system agent must expose a minimal, validated API.

The Web UI must never execute arbitrary shell commands.

Scenario process execution must support:

- Allowlisted commands
- Working directory restrictions
- Environment restrictions
- Timeout
- Output capture
- Optional container or sandbox execution

User-provided scripting must not be enabled in the MVP.

---

# 25. Configuration and Schema Rules

All configuration files must:

- Include `schema_version`
- Be validated before use
- Reject unknown critical fields
- Produce actionable validation errors
- Be compatible with JSON Schema where practical

Device models must remain declarative by default.

Lua or another scripting engine may be added later only through an ADR.

No arbitrary JavaScript execution is allowed in the simulator core.

---

# 26. Testing Strategy

## 26.1 Unit Tests

Required for:

- Register access rules
- Bit-field handling
- Endianness
- State transitions
- Timer behavior
- Fault triggers
- Protocol parsing
- Schema validation

## 26.2 Integration Tests

Required for:

- Client-to-server communication
- Device plugin behavior
- Scenario execution
- WebSocket event delivery
- SQLite persistence
- Metrics generation

## 26.3 System Tests

Required for:

- Sample C application
- GPIO simulator
- I2C register device
- SPI transactions
- Fault scenarios
- Network impairment
- JUnit export

## 26.4 Determinism Tests

The same scenario, configuration, and seed must produce equivalent results.

## 26.5 Compatibility Tests

Compatibility tests must cover:

- Protocol schema versions
- Device model schema versions
- Client library versions
- Migration behavior

---

# 27. CI/CD Requirements

The repository must support:

- Formatting checks
- Linting
- Unit tests
- Integration tests
- System tests
- Schema validation
- Security checks
- License checks
- Build artifacts
- Container image build
- JUnit report publishing

The default CI path must not require root privileges.

Privileged Level 2 tests must run in a separate optional pipeline.

---

# 28. Development Phases

## Phase 0: Foundation

Deliverables:

- Rust workspace
- Repository structure
- Architecture document
- ADR template
- CI pipeline
- Logging foundation
- Error model
- Configuration loader
- Schema validation

## Phase 1: Core Functional Simulator

Deliverables:

- VDS4E server
- Unix domain socket protocol
- C client library
- Device registry
- Transaction router
- Register engine
- Virtual monotonic clock with real-time and manual modes
- Deterministic one-shot event scheduler
- Timing-aware device operations and busy state
- State-machine engine
- Event system
- Basic metrics

## Phase 2: Initial Device Support

Deliverables:

- Generic GPIO device
- Generic SPI register device
- Generic I2C register device
- Generic QSPI memory device
- Basic fault injection

## Phase 3: Scenario and Automation

Deliverables:

- Scenario engine
- CLI runner
- Assertions
- Scenario control of the Phase 1 deterministic clock
- JUnit XML
- JSON result export
- Regression scenarios

## Phase 4: Web Application

Deliverables:

- Device dashboard
- Register viewer
- GPIO panel
- Transaction analyzer
- Fault panel
- Scenario editor and runner
- Metrics and logs

## Phase 5: Linux ABI Integration

Deliverables:

- `gpio-sim` adapter
- `i2c-stub` adapter
- PTY UART adapter
- Network namespace adapter
- `tc netem` integration
- Optional SPI `LD_PRELOAD` adapter

## Phase 6: Advanced Protocols

Deliverables:

- Ethernet packet model
- PCAP export
- Advanced diagnostic decoding

## Phase 7: Full-System Integration

Deliverables:

- QEMU bridge
- Target rootfs execution
- Custom virtual device models where justified

---

# 29. MVP Scope

The MVP must include:

- Rust simulator daemon
- Unix domain socket transport
- Protobuf protocol
- C client SDK
- Device registry
- Register engine
- State-machine engine
- Generic SPI device
- Generic I2C device
- Generic GPIO device
- Generic QSPI memory device
- Fault injection
- Scenario runner
- Structured logs
- Prometheus metrics
- Minimal Web UI
- JUnit output

The MVP must not include:

- QEMU device implementation
- Custom kernel SPI controller
- Arbitrary scripting
- Multi-user cloud service
- Complex authentication
- Electrical modeling

---

# 30. First Vertical Slice

The first complete vertical slice must use a declarative generic SPI command
device. Company-private devices must not be embedded in the public roadmap or
repository.

Required flow:

1. Start `vds-server`.
2. Load `device-models/examples/spi-flash.yaml`.
3. Start a host-built C sample application.
4. Connect through the VDS4E C client.
5. Send SPI `READ_ID` opcode `0x9F`.
6. Return response bytes `EF 40 18`.
7. Return a structured error for an unknown opcode.
8. Emit a structured transaction log.

No broad protocol expansion should occur before this vertical slice works end to end.

---

# 31. AI Assistant Rules

Any AI assistant working on this repository must:

1. Read this document before proposing architecture.
2. Preserve the phase order unless an ADR changes it.
3. Avoid adding technologies without justification.
4. Avoid duplicating responsibilities across modules.
5. Keep device-specific behavior out of the core.
6. Keep Web UI logic out of the simulator engine.
7. Add tests with every core behavior.
8. Update schemas when configuration changes.
9. Create an ADR for architectural deviations.
10. Prefer small vertical increments over broad scaffolding.
11. Never implement Level 2 or Level 3 as a shortcut around incomplete Level 1.
12. Never introduce arbitrary scripting before the declarative model is proven insufficient.
13. Never make REST the high-frequency transaction path.
14. Never require root for the default development workflow.
15. Never claim hardware equivalence without target validation.

---

## 31.1 Company Know-How Protection

AI assistants and contributors must not add company-sensitive protocol names, register maps, packet formats, timing requirements, test vectors, device behaviors, or implementation details to the public repository, public issues, public roadmap, examples, or community device library.

When private extensions are discussed or implemented:

- Use a separate private repository.
- Depend only on stable public extension APIs.
- Keep test data and documentation private.
- Do not publish sanitized-looking samples derived from confidential material without approval.
- Do not reference private package identifiers in public examples.
- Do not copy private protocol knowledge into public ADRs.
- Treat private plugins as consumers of the public framework, not as public roadmap items.

---

# 32. Definition of Done

A feature is complete only when:

- Architecture boundaries are respected.
- Unit tests exist.
- Integration tests exist where applicable.
- Configuration is schema-validated.
- Errors are actionable.
- Logs are structured.
- Metrics are added where meaningful.
- CLI support exists where relevant.
- Web UI support exists only after headless support.
- Documentation is updated.
- No unrelated subsystem is coupled to the feature.

---

# 33. Architecture Decision Records

ADR files must be stored under:

```text
docs/adr/
```

Naming:

```text
0001-use-rust-for-simulator-core.md
0002-use-unix-domain-sockets.md
```

Each ADR must include:

- Status
- Context
- Decision
- Alternatives
- Consequences
- Migration impact

---

# 34. Initial ADR Decisions

The following decisions are already accepted by this document:

- Rust is used for the simulator core.
- React and TypeScript are used for the Web UI.
- Unix domain sockets and Protobuf are used for local transaction transport.
- YAML is used for human-authored models and scenarios.
- SQLite is used for metadata and summaries.
- Prometheus-compatible metrics are exposed.
- Functional simulation is implemented before Linux ABI simulation.
- QEMU is deferred until after the core product is stable.
- A generic SPI command device is the first vertical-slice target.
- The Web UI is optional for headless operation.
- Privileged operations are isolated in `vds-system-agent`.

---

# 35. Final Architectural Constraint

The project must always preserve this dependency direction:

```text
Web UI
   |
Public Control API
   |
Simulator Core
   |
Generic Bus and Device Interfaces
   |
Plugins and Adapters
   |
Applications and External Systems
```

Dependencies must not point upward.

In particular:

- Core must not depend on Web UI.
- Generic buses must not depend on device-specific plugins.
- Plugins must not modify unrelated core behavior.
- Applications must not depend on Web UI.
- Scenarios must not require a browser.
- The default test pipeline must not require physical hardware.

This document remains authoritative until replaced by an explicitly approved revision.

---

# 36. Open-Source Device Model Library

VDS4E must support a reusable and distributable open-source device model ecosystem.

The purpose of the library is to allow users to:

- Search for previously created device models
- Download a device model
- Import it into a local VDS4E installation
- Export locally created models
- Publish models to a shared registry
- Reuse register maps, commands, state machines, and fault profiles
- Extend an existing model without duplicating it
- Pin a known-good model version for deterministic testing

The device model library is a first-class product capability, not a Web UI-only convenience feature.

---

# 37. Device Model Package Format

Every reusable device model must be distributed as a versioned package.

Recommended package extension:

```text
.vdspkg
```

A package is a compressed archive containing:

```text
device-package/
├── manifest.yaml
├── device.yaml
├── registers.yaml
├── commands.yaml
├── state-machine.yaml
├── faults.yaml
├── metrics.yaml
├── ui-metadata.yaml
├── README.md
├── LICENSE
├── CHANGELOG.md
├── examples/
│   ├── basic-read.yaml
│   ├── reset-sequence.yaml
│   └── fault-injection.yaml
├── tests/
│   ├── conformance.yaml
│   └── expected-results/
└── assets/
    ├── block-diagram.svg
    └── datasheet-reference.txt
```

Only `manifest.yaml` and `device.yaml` are mandatory.

Other files are optional and included when relevant.

Packages must remain declarative unless the package explicitly depends on an approved plugin.

---

# 38. Device Package Manifest

Every package must contain a manifest.

Example:

```yaml
schema_version: 1

package:
  id: community.ti.max31875
  name: MAX31875 Temperature Sensor
  version: 1.2.0
  description: Register-level I2C model for the MAX31875 temperature sensor
  license: Apache-2.0
  authors:
    - name: Example Contributor
      url: https://example.org

device:
  vendor: Texas Instruments
  family: temperature-sensor
  model: MAX31875
  revision: generic
  buses:
    - i2c

compatibility:
  vds4e:
    minimum_version: 0.3.0
  schema_version: 1
  required_plugins:
    - i2c-generic

sources:
  datasheet:
    title: MAX31875 Datasheet
    revision: SBOS944
  repository: https://example.org/device-model

integrity:
  content_hash: sha256:REPLACED_DURING_PACKAGING
```

Required manifest fields:

- Package identifier
- Human-readable name
- Semantic version
- Description
- License
- Device vendor
- Device model
- Supported bus types
- Minimum compatible VDS4E version
- Schema version
- Required plugins
- Package integrity hash

---

# 39. Package Identity and Naming

Package IDs must use reverse-domain-style naming where possible.

Examples:

```text
community.ti.max31875
community.microchip.25lc256
community.nxp.pca9848
vds4e.generic.spi-register-device
```

Package identity rules:

- IDs must be globally unique within a registry.
- Package names must not be used as unique identifiers.
- Vendor names may be included for discoverability.
- A package must not impersonate an official vendor model.
- Official and community packages must be visibly distinguishable.
- Package IDs must not change between versions.

---

# 40. Semantic Versioning

Device packages must use semantic versioning.

```text
MAJOR.MINOR.PATCH
```

Rules:

- PATCH: Corrections that do not alter expected external behavior
- MINOR: Backward-compatible registers, commands, metadata, tests, or fault additions
- MAJOR: Breaking register layout, protocol behavior, schema, command, timing, or state-machine changes

VDS4E must allow users to:

- Install the latest compatible version
- Install an exact version
- Pin a version
- View available versions
- Compare versions
- Upgrade explicitly
- Roll back to a previously installed version

Automatic silent upgrades are forbidden for active projects and CI scenarios.

---

# 41. Local Device Library

Every VDS4E installation must include a local device library.

Suggested default location:

```text
~/.local/share/vds4e/library/
```

Suggested structure:

```text
library/
├── packages/
│   ├── community.ti.max31875/
│   │   ├── 1.1.0/
│   │   └── 1.2.0/
│   └── vds4e.generic.eeprom/
│       └── 0.1.0/
├── cache/
├── indexes/
├── trust/
└── library.db
```

The local library must maintain:

- Installed packages
- Package versions
- Source registry
- Integrity status
- Signature status
- Install date
- Last-used date
- Project references
- Local modifications
- Validation results

SQLite may be used for local package metadata and search indexes.

Package contents must remain file-based and portable.

---

# 42. Registry Architecture

VDS4E must support one or more package registries.

Registry types:

- Official VDS4E registry
- Organization-private registry
- Filesystem registry
- Git-based registry
- HTTP-compatible registry
- Offline archive collection

The initial implementation should support:

1. Local filesystem registry
2. Git repository registry
3. Static HTTP registry

A central hosted service is optional and must not be required for normal use.

The registry must expose an index containing:

- Package ID
- Name
- Vendor
- Device model
- Description
- Bus types
- Tags
- Versions
- License
- Compatibility
- Package checksum
- Package download location
- Verification metadata

---

# 43. Registry Index Format

A registry must provide a machine-readable index.

Example:

```yaml
schema_version: 1

registry:
  id: vds4e-community
  name: VDS4E Community Device Library
  generated_at: 2026-07-21T10:00:00Z

packages:
  - id: community.ti.max31875
    name: MAX31875 Temperature Sensor
    vendor: Texas Instruments
    device_model: MAX31875
    description: I2C temperature sensor model
    buses:
      - i2c
    tags:
      - temperature
      - sensor
      - i2c
    latest_version: 1.2.0
    versions:
      - version: 1.2.0
        package_url: packages/community.ti.max31875/1.2.0.vdspkg
        sha256: EXAMPLE
        minimum_vds4e_version: 0.3.0
```

Large registries may publish a compact index plus per-package metadata.

---

# 44. Library Search

Users must be able to search the device library from:

- Web UI
- CLI
- REST API
- Local offline index

Searchable fields:

- Package name
- Package ID
- Vendor
- Device model
- Device family
- Bus type
- Register name
- Command opcode
- Tag
- Description
- Author
- License
- Datasheet reference
- Required plugin
- Compatibility version

Example CLI commands:

```bash
vds4e library search max31875
vds4e library search --bus i2c --tag temperature
vds4e library search --vendor holt --bus spi
vds4e library show community.ti.max31875
vds4e library versions community.ti.max31875
```

Search results must indicate:

- Installed status
- Latest version
- Installed version
- Compatibility
- Trust level
- License
- Source registry
- Validation status

---

# 45. Import and Export

## 45.1 Import

Users must be able to import:

- `.vdspkg` package archives
- Unpacked device package directories
- Legacy YAML device definitions
- Package references from registries
- Git repository URLs where explicitly supported

Example commands:

```bash
vds4e library import max31875.vdspkg
vds4e library import ./device-model/
vds4e library install community.ti.max31875
vds4e library install community.ti.max31875@1.2.0
```

Import must perform:

1. Archive validation
2. Schema validation
3. Path traversal protection
4. Manifest validation
5. Checksum verification
6. Plugin compatibility validation
7. License detection
8. Duplicate detection
9. Test execution where available
10. Local index update

Imported packages must not overwrite another version silently.

## 45.2 Export

Users must be able to export:

- A local device model
- An installed package version
- A modified package fork
- A package with examples and tests
- A project-specific frozen model

Example commands:

```bash
vds4e library export community.ti.max31875@1.2.0
vds4e device package ./device-model/
vds4e library export eeprom-local --output eeprom-local.vdspkg
```

Export must:

- Validate schemas
- Generate or validate the manifest
- Calculate checksums
- Include license information
- Include dependency information
- Optionally run conformance tests
- Produce a reproducible package where possible

---

# 46. Web UI Library Experience

The Web UI must include a Device Library section.

Required views:

- Search
- Package details
- Installed packages
- Available updates
- Version history
- Dependencies
- Register preview
- Command preview
- State-machine preview
- Fault profile preview
- Package tests
- License and source information
- Import and export actions

Package detail view should show:

- Device identity
- Description
- Supported buses
- Register count
- Command count
- Memory regions
- Supported fault types
- Required plugins
- VDS4E compatibility
- Validation status
- Package source
- Maintainer
- License
- Download count if a remote service provides it
- Last release date if available

Users must be able to preview a model before installation.

---

# 47. Register Table Import and Export

VDS4E must support importing register tables independently from full device packages.

Supported initial formats:

- VDS4E YAML
- JSON
- CSV
- XLSX
- SVD where applicable
- CMSIS-SVD subsets
- Vendor-generated CSV exports

Register import must support mapping columns such as:

- Register name
- Address
- Width
- Reset value
- Access type
- Field name
- Bit offset
- Bit width
- Description
- Bank
- Page
- Endianness

The import workflow must include:

1. File upload or CLI path
2. Format detection
3. Column mapping
4. Validation preview
5. Conflict reporting
6. Normalization
7. Final import

Register export must support:

- VDS4E YAML
- JSON
- CSV
- XLSX
- SVD where representable

Lossy exports must display a warning.

---

# 48. Device Model Composition

A package may extend or compose other packages.

Example:

```yaml
schema_version: 1

package:
  id: example.temperature-sensor.lab-profile
  version: 1.0.0

extends:
  package: community.ti.max31875
  version: 1.2.0

overrides:
  - register: CONFIGURATION
    reset_value: 0x0000

adds:
  fault_profiles:
    - faults/sensor-stuck.yaml
```

Composition rules:

- Dependencies must use exact versions or constrained compatible ranges.
- Overrides must be explicit.
- Cyclic dependencies are forbidden.
- Core package files must not be modified in place.
- Organization-specific variants should extend community packages.
- Resolved package graphs must be lockable.

---

# 49. Project Lock File

Every VDS4E project using library packages must support a lock file.

Suggested filename:

```text
vds4e.lock
```

The lock file records:

- Package ID
- Exact version
- Registry source
- Package checksum
- Required plugins
- Plugin versions
- Resolution timestamp
- Optional signature identity

CI and deterministic scenario execution must use the lock file.

Example:

```yaml
schema_version: 1

packages:
  - id: community.ti.max31875
    version: 1.2.0
    registry: vds4e-community
    sha256: EXAMPLE

  - id: vds4e.generic.eeprom
    version: 0.4.1
    registry: vds4e-community
    sha256: EXAMPLE
```

---

# 50. Trust, Integrity, and Security

Device packages are untrusted input.

Import processing must protect against:

- Archive path traversal
- Symlink attacks
- Oversized archives
- Decompression bombs
- Invalid schemas
- Unsupported plugins
- Executable payloads
- Arbitrary scripts
- Malicious UI assets
- Dependency confusion
- Package ID impersonation
- Checksum mismatch

MVP package rules:

- Packages are declarative.
- Executable binaries are forbidden.
- Dynamic libraries are forbidden.
- Shell scripts are forbidden.
- Arbitrary Lua or JavaScript is forbidden.
- SVG and HTML assets must be sanitized or rejected.
- Package sizes must be limited.
- File paths must be normalized.

Trust levels may include:

- Official
- Verified publisher
- Organization-private
- Community
- Local unsigned
- Invalid or quarantined

Package signatures may be added in a later phase.

Checksum verification is mandatory from the first registry-enabled release.

---

# 51. Licensing and Attribution

Every published package must declare a license.

The registry must reject packages without license metadata unless the registry explicitly permits private packages.

Recommended licenses:

- Apache-2.0
- MIT
- BSD-2-Clause
- BSD-3-Clause
- MPL-2.0
- CC-BY-4.0 for documentation-only content

A package derived from a datasheet must not include copyrighted datasheet content beyond permitted metadata and original summaries.

Packages should reference:

- Datasheet title
- Revision
- Public source URL where permitted
- Vendor
- Relevant application notes

The registry UI must display license information before installation.

---

# 52. Validation and Conformance Tests

Reusable packages should include conformance tests.

Tests may verify:

- Reset values
- Read-only behavior
- Write-one-to-clear behavior
- Command decoding
- State transitions
- Timing rules
- Fault behavior
- Memory geometry
- Interrupt behavior
- Example scenarios

Registry publishing should run:

- Schema validation
- Package integrity checks
- Dependency resolution
- Conformance tests
- Compatibility tests
- Security checks

A package must expose its validation status.

Suggested statuses:

- Validated
- Partially validated
- Community tested
- Unverified
- Failed validation

---

# 53. Publishing Workflow

Recommended publishing flow:

```text
Author device model
        |
Validate locally
        |
Run package tests
        |
Build .vdspkg
        |
Calculate checksum
        |
Submit registry metadata
        |
Automated validation
        |
Review if required
        |
Publish immutable version
```

Published versions must be immutable.

Corrections require a new version.

A registry may support:

- Pull request-based publishing
- Git tag-based publishing
- CLI publishing
- Organization approval workflows

Initial open-source implementation should prefer a Git repository with pull requests because it provides:

- Review history
- Version history
- Community contribution workflow
- CI validation
- Low hosting complexity

---

# 54. Suggested Community Repository

A separate open-source repository should host shared packages.

Suggested repository name:

```text
vds4e-device-library
```

Suggested structure:

```text
vds4e-device-library/
├── registry.yaml
├── packages/
│   ├── community.ti.max31875/
│   │   ├── 1.0.0/
│   │   └── 1.2.0/
│   ├── community.microchip.25lc256/
│   │   └── 1.0.0/
│   └── vds4e.generic.eeprom/
│       └── 1.0.0/
├── schemas/
├── tools/
├── tests/
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

The main VDS4E repository must not embed the entire public device library.

It may include a small set of built-in examples.

---

# 55. Device Library CLI

The CLI should eventually support:

```bash
vds4e registry list
vds4e registry add community https://example.org/index.yaml
vds4e registry remove community
vds4e registry update

vds4e library search QUERY
vds4e library show PACKAGE
vds4e library install PACKAGE
vds4e library install PACKAGE@VERSION
vds4e library uninstall PACKAGE
vds4e library update PACKAGE
vds4e library versions PACKAGE
vds4e library validate PACKAGE
vds4e library import PATH
vds4e library export PACKAGE
vds4e library publish PATH
vds4e library diff PACKAGE@OLD PACKAGE@NEW

vds4e registers import PATH
vds4e registers export DEVICE --format yaml
```

All commands must have machine-readable JSON output options.

---

# 56. Device Library REST API

Suggested endpoints:

```text
GET    /api/v1/library/search
GET    /api/v1/library/packages/{package_id}
GET    /api/v1/library/packages/{package_id}/versions
POST   /api/v1/library/install
POST   /api/v1/library/import
POST   /api/v1/library/export
DELETE /api/v1/library/packages/{package_id}/{version}
POST   /api/v1/library/validate
GET    /api/v1/registries
POST   /api/v1/registries
DELETE /api/v1/registries/{registry_id}
```

Large package upload and download operations must use streaming.

High-frequency device transactions must continue to use the Unix domain socket transport.

---

# 57. Library Development Phase

The device library must be introduced after the core register and device schemas are stable enough to version.

Recommended delivery order:

## Phase L1: Local Packages

- Package manifest
- `.vdspkg` archive
- Local import
- Local export
- Validation
- Local search
- Installed version management

## Phase L2: Git Registry

- Registry index
- Remote search
- Download
- Checksum verification
- Install by package ID
- Version pinning
- Lock file

## Phase L3: Web Library

- Search UI
- Preview
- Install
- Import/export
- Version comparison
- Update notifications

## Phase L4: Community Publishing

- Package CI
- Conformance tests
- Contribution guide
- Pull request publishing
- Trust labels
- Maintainer metadata

## Phase L5: Advanced Registry

- Signatures
- Publisher identities
- Private organization registries
- Mirroring
- Offline bundles
- Dependency caching

---

# 58. Additional AI Assistant Rules for Device Libraries

Any AI assistant implementing the device library must:

1. Keep package models declarative.
2. Never execute files contained in a package.
3. Validate archives before extraction.
4. Preserve semantic versioning.
5. Never silently overwrite an installed package version.
6. Generate or update lock files for deterministic projects.
7. Keep registry logic separate from simulator transaction logic.
8. Keep remote registry access optional.
9. Ensure local and offline workflows remain supported.
10. Add schema and security tests for every import format.
11. Avoid tying package installation to the Web UI.
12. Preserve package attribution and license metadata.
13. Treat imported register spreadsheets as untrusted data.
14. Report lossy register conversions clearly.
15. Avoid creating vendor-official branding without explicit authorization.

---

# 59. Updated MVP Boundary

The first simulator MVP does not require a hosted public registry.

However, the core schemas must be designed so that device models can later be packaged without breaking changes.

The first library-capable release must include:

- Local package format
- Package manifest
- Import
- Export
- Schema validation
- Local search
- Exact version installation
- Package checksums
- Lock file generation

A public Git-based device registry follows after the local package workflow is stable.
