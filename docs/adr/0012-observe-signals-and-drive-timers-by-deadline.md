# 0012: Observe signal propagation and drive timers by deadline

- Status: Accepted
- Date: 2026-10-07

## Context

ADR 0011 connected device signal ports to GPIO lines but left two gaps that it
listed as consequences:

- signal propagation produced no domain event, so the Web UI, WebSocket clients and
  scenario runs could not see why a GPIO line changed, and the GPIO bank's backing
  register changed without any `register_write` event;
- the live server applied due device events from a pump that woke every 2 ms
  whether or not anything was scheduled.

## Decision

1. **`signal_changed` domain event.** The router reports each propagation step to
   an observer. The server publishes it on the event bus:

   ```json
   { "kind": "signal_changed", "phase": "emitted|delivered",
     "source": "imu0.drdy", "target": "gpio0.DRDY_IMU", "value": true, "delay_ns": 0 }
   ```

   - `emitted`: a source port changed value and entered the router.
   - `delivered`: the target GPIO line was driven. For a connection with
     `delay_ns` this happens later, at its due time.
   - The envelope `device_id` is the source device for `emitted` and the target
     device for `delivered`, so per-device views and filters show each step on the
     device it affects. `timestamp_virtual_ns` is the router clock time.
   - Scenario runs publish the same events with their `scenario_run_id`.
   - The observer runs under the router lock: it must not block or call back into
     the registry. The server's observer only publishes to the non-blocking event
     bus.
   - Retention follows transaction events (24 hours by default), not critical
     events.
   - The Web UI adds the type to the event filters and the live stream and refreshes
     a GPIO device's registers when a signal is delivered to it.

2. **Deadline-driven pump.** The pump sleeps until the earliest scheduled deadline
   (device schedulers and delayed connections) and the registry wakes it after
   every transaction, the only way new deadlines appear. An idle server wakes only
   as a 50 ms safety backstop; a sleep is never shorter than 1 ms so a persistently
   due deadline cannot spin. This replaces the fixed 2 ms tick with exact deadlines
   and no idle polling. It does not change what the pump does: apply due device
   events and settle the signal router.

3. **Scope.** Version 1 limits from ADR 0011 remain: bool output ports, GPIO targets,
   `generic-spi-command` and `generic-i2c-register` sources. The privileged ABI tests
   cover SPI and I2C sources and run only on demand (`tests/e2e/drdy`,
   `.github/workflows/e2e-abi.yml`).

## Alternatives

- **Separate event types for emitted and delivered:** rejected; one type with a
  phase keeps filters and the UI simple and lets a client pair steps by connection.
- **Publishing from the router crate:** rejected; `vds-core` does not depend on the
  event crate. The observer keeps the dependency direction.
- **Keep the fixed tick:** acceptable but wastes wake-ups and quantizes deadlines to
  the tick.
- **Evaluate due events on every observation (GPIO exchange, REST reads):**
  rejected for now; it spreads time advancement across many call sites. The pump
  remains the single place that advances live-server time for topologies.

## Consequences

- Signal activity is observable through the same event stream as bus traffic.
- Events applied by the pump are still only logged, not published as domain events
  (unchanged from ADR 0011).
- Each transaction now also nudges the pump. The cost per transaction is one
  deadline lookup and one `run_due_events` pass over the registered devices.
- A missed wake-up is bounded by the 50 ms backstop instead of 2 ms.
