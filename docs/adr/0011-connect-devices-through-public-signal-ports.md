# 0011: Connect devices through public signal ports

- Status: Proposed
- Date: 2026-10-07

## Context

Real driver flows depend on digital lines between devices: a sensor asserts
DRDY after a conversion, the application observes the edge on
`/dev/gpiochipN` (for example with `gpiomon`), then reads the sample over
`/dev/spidevX.Y` or `/dev/i2c-N`, and reading the sample clears DRDY.

Today every runtime device is isolated. No model, schema field, or runtime
path lets an I2C or SPI device drive a GPIO line. A GPIO bank line that the
application reads is an `output` of the device side of the bank, so the
sensor only needs a way to drive that line inside the runtime; the host
adapters and the `gpio-sim` helper (ADR 0008) already carry the level out.

Wiring must not leak a model's internals. If a topology refers to
`imu0.STATUS.bit3` or `imu0.state.READY`, moving DRDY from a register bit to a
state machine silently breaks every topology that used the model.

## Decision

Devices expose **public signal ports**. A topology file connects ports, never
registers or states.

1. **Signal ports in the device model.** A model declares typed ports:

   ```yaml
   signals:
     outputs:
       - name: drdy
         type: bool
   ```

   `bool` is the only type in the first version. Input ports are reserved for
   later (RESET, chip-select-like lines).

2. **Bindings are internal to the model.** A model drives a port from its own
   behavior:

   ```yaml
   signal_bindings:
     - signal: drdy
       source:
         register: { name: STATUS, bit: 3 }
     # or
     - signal: drdy
       source:
         state: { equals: data_ready }
     # or a combination
     - signal: drdy
       source:
         expression: "STATUS.DRDY && state == READY"
   ```

   Moving the source later changes the model only. The editor may offer
   "register bit", "state machine state", and "expression" as source kinds,
   but all of them drive the same public port.

3. **Wiring lives in a separate topology file.**

   ```yaml
   connections:
     - from: imu0.drdy
       to: gpio0.DRDY_IMU
     - from: imu0.drdy
       to: gpio0.DRDY_MIRROR
       delay_ns: 500
   ```

   The endpoint `to:` names a GPIO line by its model line name. The topology
   is a new top-level resource referenced from server configuration; it does
   not appear in device packages, so packages stay reusable. Validation
   rejects unknown devices, unknown ports, type mismatches, and a target line
   that is already driven by another connection.

4. **Propagation is a deterministic signal router in the runtime.**
   Default propagation has zero delay and happens at the same virtual
   timestamp. It is not recursive: a transaction or time advance that changes
   a port queues a signal event; the router drains all zero-delay events from
   a deterministic FIFO queue until the system is stable; only then does the
   transaction or advance complete. A connection with `delay_ns` is scheduled
   on the virtual-time scheduler instead.

5. **Loops are bounded.** Topology validation rejects cycles that can be
   proven statically. The router also enforces a maximum propagation depth
   per drain and fails the transaction with a typed error if it is exceeded.

6. **Read side effects are model behavior.** "Reading the sample clears DRDY"
   requires a register read-clear access attribute (or an equivalent behavior
   action) that does not exist yet. It is part of the device model and
   register engine, not of the router or any ABI adapter.

7. **Boundary.** The router, topology, and signal ports live in the runtime
   (`vds-core` / `vds-device-model` / `vds-server`). The SPI, I2C, and GPIO
   host adapters gain no device-specific or topology knowledge.

## Alternatives

- **Wire to registers or states directly** (`imu0.STATUS.bit3`): rejected; it
  leaks model internals and makes topologies break when behavior moves.
- **Declare the target inside the sensor package**: rejected; it binds a
  reusable package to one board.
- **Delay every connection by default**: rejected; for functional simulation
  the propagation delay of DRDY, IRQ, RESET, and BUSY lines is usually
  irrelevant and users expect the edge immediately after the transaction.
- **Recursive propagation inside the transaction call**: rejected; it makes
  ordering depend on call stacks and risks unbounded recursion.
- **Let the GPIO helper or an adapter poll the sensor**: rejected; it moves
  device knowledge into an ABI adapter.

## Consequences

- Model authors can change how a signal is produced without touching any
  topology.
- Edge ordering is reproducible within the virtual-time domain.
- `gpiomon` still observes the edge with the `gpio-sim` helper's polling
  latency, which sits outside the virtual-time guarantee (see the timing note
  in the README).
- New schema surface: `signals`, `signal_bindings`, the topology file, and a
  server-config reference to it. Scenarios gain the ability to assert port
  values and connected line values.
- Register read-clear and an expression evaluator are additional work.

## Migration impact

Additive. Existing models without `signals` and configurations without a
topology behave exactly as before. Accepted ADR 0008 is unchanged.
`VDS4E_ARCHITECTURE.md` must be updated before implementation starts.

## Open questions

- Expression language for combined sources: reuse the behavior-flow logical
  nodes or a small dedicated syntax.
- Whether `gpio0.DRDY_IMU` should address lines by name only or also by
  offset.
- Topology file name and the server-config key that references it.
