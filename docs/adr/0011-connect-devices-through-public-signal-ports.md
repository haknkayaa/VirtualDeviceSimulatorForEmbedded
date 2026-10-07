# 0011: Connect devices through public signal ports

- Status: Accepted
- Date: 2026-10-07

## Context

Real driver flows depend on digital lines between devices: a sensor asserts
DRDY after a conversion, the application observes the edge on
`/dev/gpiochipN` (for example with `gpiomon`), then reads the sample over
`/dev/spidevX.Y` or `/dev/i2c-N`, and reading the sample clears DRDY.

Before this decision every runtime device was isolated. No model, schema field,
or runtime path let an I2C or SPI device drive a GPIO line. A GPIO bank line
that the application reads is an `output` of the simulated bank (the simulated
side drives it, the host reads it), so a sensor only needs a way to drive that
line inside the runtime; the GPIO adapter and kernel `gpio-sim` (ADR 0008)
already carry the level out.

Wiring must not leak a model's internals. If a topology referred to
`imu0.STATUS.bit3` or `imu0.state.READY`, moving DRDY from a register bit to a
state machine would silently break every topology that used the model.

## Decision

Devices expose **public signal ports**. A topology file connects ports, never
registers or states.

1. **Output ports in the device model.** A model declares typed ports:

   ```yaml
   signals:
     outputs:
       - name: drdy
         type: bool
   ```

   Version 1 supports `bool` output ports only. Input ports, bidirectional or
   open-drain lines, multiple drivers, and Device Tree integration are out of
   scope.

2. **Bindings are internal to the model.** A model drives a port from its own
   behavior:

   ```yaml
   signal_bindings:
     - signal: drdy
       source: { register: STATUS, bit: 3 }
     # or
     - signal: drdy
       source: { state: { equals: data_ready } }
     # or a combination built from typed logical nodes
     - signal: drdy
       source:
         and:
           - { register: STATUS, bit: 3 }
           - { state: { equals: ready } }
   ```

   Combined sources use the logical vocabulary of the existing typed signal
   graph (`and`, `or`, `not`, `nand`, `nor`, `xor`, `xnor`) and share its
   evaluation function; no string or expression language is introduced. The
   existing signal graph is state-activated and push-driven and cannot
   re-evaluate levels after arbitrary register changes, so bindings are a small
   typed tree that reuses its node semantics rather than a graph instance.

   Moving a source later changes only the model. Version 1 supports ports on
   `generic-spi-command` and `generic-i2c-register` devices.

3. **Wiring is a separate `topology.yaml`.**

   ```yaml
   schema_version: 1
   connections:
     - from: imu0.drdy
       to: gpio0.DRDY_IMU
     - from: imu0.drdy
       to: gpio0.DRDY_MIRROR
       delay_ns: 500
   ```

   The server configuration references it with an optional `topology:` key.
   The file is a top-level resource, not part of a device package, so packages
   stay reusable.

   - Endpoint device names resolve to the runtime `device.id` values. A
     separate instance or composition system is out of scope.
   - GPIO targets are addressed canonically by line **name**; offsets are not
     part of the topology contract.
   - The target must be a device-driven line (`direction: output` in the GPIO
     model). Two connections may not drive the same line.
   - Validation rejects unknown devices, ports, and lines, host-driven
     targets, multiple drivers, and cycles between devices.

4. **Propagation is a deterministic router in the runtime.** The device
   registry owns the router. After every transaction, reset, register write,
   and due-event pass it samples source ports and propagates a value **only
   when it changed** since the previous propagation. Zero-delay changes drain
   through a FIFO queue at the same virtual timestamp until the system is
   stable; propagation is never recursive. A connection with `delay_ns` is
   queued on virtual time and takes part in the earliest-deadline
   calculation, so scenarios and the live server advance it like any device
   event.

5. **Loops are bounded twice.** Topology validation rejects device-level
   cycles. The router also enforces a maximum number of stabilization passes
   and fails with a typed error if it is exceeded.

6. **Adapter boundary.** The router drives the target GPIO bank's backing
   register. The existing path from the bank through the GPIO adapter and
   kernel `gpio-sim` carries the level out. The router and topology contain no adapter knowledge, and the
   SPI, I2C, and GPIO adapters gain no device-specific or topology knowledge.

7. **Read side effects are model behavior.** "Reading the sample clears DRDY"
   is expressed with a register bitfield attribute `read_clear: true`: a bus
   read returns the current value and then clears those bits. Control-plane
   and scenario register inspection never clear them. The router is not
   involved.

8. **Live-server pump.** Device schedulers only advance during that device's
   own transactions. When a topology is attached the live server therefore
   applies due events on a short interval, so a timer-driven DRDY does not
   wait for the next bus transaction.

## Alternatives

- **Wire to registers or states directly** (`imu0.STATUS.bit3`): rejected; it
  leaks model internals and breaks topologies when behavior moves.
- **Declare the target inside the sensor package**: rejected; it binds a
  reusable package to one board.
- **A string expression language for combined sources**: rejected; typed
  logical nodes already exist and are schema-validated.
- **Delay every connection by default**: rejected; for functional simulation
  the propagation delay of DRDY, IRQ, RESET, and BUSY lines is usually
  irrelevant.
- **Recursive propagation inside the transaction call**: rejected; ordering
  would depend on call stacks and recursion would be unbounded.
- **Let the GPIO helper or an adapter poll the sensor**: rejected; it moves
  device knowledge into an ABI adapter.

## Consequences

- Model authors can change how a signal is produced without touching any
  topology.
- Edge ordering is reproducible within the virtual-time domain.
- `gpiomon` still observes the edge with the `gpio-sim` helper's polling
  latency, which sits outside the virtual-time guarantee.
- A signal level is the line's logical value: an `active_low` target line
  reaches the host inverted.
- Topology is validated when the registry loads. Devices created later through
  the control API are not part of an already attached topology.
- Events produced by the live pump are not published to the domain event bus
  in this version, and propagation itself emits no domain event.

## Migration impact

Additive. Models without `signals`, bitfields without `read_clear`, and
configurations without `topology` behave exactly as before. Accepted ADR 0008
is unchanged. `VDS4E_ARCHITECTURE.md` section 8.8 records the architecture.
