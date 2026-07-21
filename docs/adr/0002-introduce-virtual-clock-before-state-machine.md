# 0002: Introduce the virtual clock before the state-machine engine

- Status: Accepted
- Date: 2026-07-21

## Context

The architecture originally placed the deterministic clock in Phase 3 while
the state-machine engine was a Phase 1 deliverable. Time-dependent device
operations, state transitions, fault injection, and deterministic scenarios
all require the same monotonic clock and one-shot scheduling semantics.
Building those consumers first would either couple them to wall-clock sleeps or
cause each subsystem to invent its own timing behavior.

The register engine and the first generic SPI vertical slice are complete. The
next smallest vertical increment is a delayed register write that exposes a
busy state and completes after virtual time reaches a configured deadline.

## Decision

Virtual Clock and Timing Engine v1 is moved into Phase 1 and is implemented
before the state-machine engine.

`vds-core` owns:

- The `SimulatorClock` abstraction
- Real-time and manually advanced monotonic clocks
- Generic one-shot scheduled events
- Event cancellation and deterministic equal-deadline ordering
- Generic timing event and error contracts

`vds-device-model` owns device pending operations, busy state, command latency,
and applying completion effects to registers. SPI decoding may request a
device operation but must not sleep, advance clocks, or manage timers directly.

Timing Engine v1 does not include recurring timers, time dilation, jitter,
scenario execution, fault injection, network timing, scripting, or distributed
clocks.

## Alternatives

- Keep the deterministic clock in Phase 3: rejected because Phase 1 device
  behavior and state machines would then depend on wall-clock timing or a
  temporary timing abstraction.
- Use `sleep()` for command latency: rejected because it makes tests slow and
  nondeterministic and prevents exact replay.
- Put timers inside the SPI decoder: rejected because bus decoding must not own
  device lifecycle or time progression.
- Add a background timer thread per device: rejected for v1 because due events
  can be processed deterministically at explicit device/runtime boundaries.

## Consequences

- State machines, fault injection, and scenarios can later consume one stable
  simulator-time foundation.
- Manual-clock tests execute without wall-clock delay.
- Real-time completion is observed when the runtime next processes due events;
  no SPI request blocks for the configured latency.
- Device state must synchronize registers, pending operations, and scheduler
  state as one consistency boundary.
- Phase 3 retains scenario time-control integration but no longer introduces
  the deterministic clock itself.

## Migration impact

The device-model schema gains optional timing and busy-register properties.
Models without them retain immediate command behavior. Existing Protobuf SPI
field numbers and the C client framing remain unchanged. New structured error
codes are additive.
