# 0003: Define fault evaluation and precedence

- Status: Accepted
- Date: 2026-07-21

## Context

Fault Injection Engine v1 can match several declarative faults for one decoded
device operation. Deterministic replay requires a stable evaluation order,
counter rule, composition model, and reset contract. Fault handling must remain
outside SPI-specific command branches and reuse the simulator clock.

## Decision

Fault targets are evaluated after command and register decoding and before the
normal device operation. Generic matching, counters, ordering, and terminal
semantics live in `vds-core`; model validation and register effects live in
`vds-device-model`.

Enabled target matches increment their own counter. Triggers are `always`,
`first_n`, `every_nth`, and exact `operation_count`. Matching activations are
ordered by descending priority and then YAML order. `timeout`, `return_error`,
and `drop` are terminal and stop the chain. Delay, response corruption, forced
register values, and stuck-at constraints are non-terminal and compose in the
same order.

Delay is a one-shot continuation on the existing virtual scheduler; no
wall-clock sleep is introduced. Fault-driven state mutation, when later added,
must dispatch a state-machine event rather than assign state directly.

Faults are transient by default. Reset clears transient counters and active
stuck-at constraints. A fault declared `persistent: true` retains its counter
and active constraint across reset. Definitions and enabled flags remain loaded
in both cases.

## Alternatives

- First YAML match only was rejected because it prevents intentional
  composition.
- YAML order without priority was rejected because profiles cannot override a
  broad default explicitly.
- Applying every terminal fault was rejected because a dropped or timed-out
  operation cannot also produce a meaningful later terminal result.
- Wall-clock sleeps were rejected because they break deterministic tests.

## Consequences

The same model and operation sequence produces the same activations and logs.
Authors must understand that disabled or target-mismatched faults do not consume
counters. Priority changes are behavior changes and should be reviewed as such.

## Migration impact

The device-model schema gains an optional `faults` array. Existing models keep
their behavior. Protobuf error values are appended; existing field numbers and
client framing are unchanged.
