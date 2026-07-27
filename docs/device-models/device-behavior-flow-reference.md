# Device behavior flow reference

This document is the public authoring contract for device behavior flows in
VDS4E. Device-model authors can use it to create or review
`flows/behavior.yaml` without relying on the visual editor.

The current schema version is `1`. A behavior flow is an editor document that
compiles to the runtime state machine and typed signal graph. For device
packages declaring `spec.authoring.behavior_flow`, the server compiles this
file while loading the package and treats it as authoritative over the static
`state_machine` in `model/device.yaml`. The editor document contains layout
information; the compiled runtime IR does not.

The architectural rationale and compatibility consequences are recorded in
[ADR 0007](../adr/0007-compile-device-behavior-flows-into-typed-runtime-graphs.md).

## Minimal document

```yaml
schema_version: 1
flow:
  id: example-behavior
  name: Example behavior
  kind: device_behavior
  revision: 1
  created_at: 2026-01-01T00:00:00.000Z
  updated_at: 2026-01-01T00:00:00.000Z

nodes:
  - id: state-resetting
    kind: device_behavior.initial_state
    position: { x: 80, y: 180 }
    data:
      label: Resetting
      state_name: resetting
      description: Device reset is in progress.
      terminal: false
      entry_actions: []
      exit_actions: []
    ui: {}

  - id: state-ready
    kind: device_behavior.state
    position: { x: 420, y: 180 }
    data:
      label: Ready
      state_name: ready
      description: The device can accept commands.
      terminal: false
      entry_actions: []
      exit_actions: []
    ui: {}

edges:
  - id: reset-complete
    kind: device_behavior.transition
    source: state-resetting
    sourceHandle: out
    target: state-ready
    targetHandle: in
    data:
      trigger_type: event
      trigger: reset_complete
      priority: 0
      guard_enabled: false
      delay_value: 5
      delay_unit: ms
    ui: {}

viewport: { x: 0, y: 0, zoom: 1 }
metadata:
  allow_cycles: true
  default_edge_kind: device_behavior.transition
  behavior:
    device_id: example-device
    description: Example reset-to-ready behavior.
    revision: 1
```

Every node and edge ID must be non-empty and unique within its own collection.
Edge `source` and `target` values refer to node IDs, not state names.

## Top-level fields

| Path | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema_version` | integer | yes | Must be `1`. |
| `flow.id` | string | yes | Stable flow identifier. |
| `flow.name` | string | yes | Human-readable flow name. |
| `flow.kind` | string | yes | Must be `device_behavior`. |
| `flow.revision` | integer | yes | Authoring revision. |
| `flow.created_at` | string | yes | ISO 8601 creation timestamp. |
| `flow.updated_at` | string | yes | ISO 8601 update timestamp. |
| `nodes` | array | yes | State and design nodes. |
| `edges` | array | yes | Directed connections. |
| `viewport` | object | yes | Editor-only `x`, `y`, and positive `zoom`. |
| `metadata.allow_cycles` | boolean | recommended | Use `true`; state-machine cycles are valid. |
| `metadata.default_edge_kind` | string | recommended | Use `device_behavior.transition`. |
| `metadata.behavior.device_id` | string | recommended | Runtime device used for register discovery and validation. |
| `metadata.behavior.description` | string | no | Model-author description. |
| `metadata.behavior.revision` | integer | recommended | Behavior-specific revision. |

`position`, `viewport`, labels, descriptions, and `ui` values do not affect the
compiled runtime behavior.

## Runtime state nodes

These are the node kinds supported by the v1 compiler.

### `device_behavior.initial_state`

Declares the state used as `state_machine.initial_state`. Exactly one Initial
State is required.

Ports:

| Direction | Handle | Meaning |
| --- | --- | --- |
| input | `in` | Incoming transition |
| output | `out` | Outgoing transition |

### `device_behavior.state`

Declares a regular runtime state. Cycles and self-transitions are permitted.

Ports are the same as Initial State.

### State parameters

Both runtime state kinds use the same `data` object.

| Field | Type | Required | Default | Runtime effect |
| --- | --- | --- | --- | --- |
| `label` | string | no | registry display name | Editor display only. |
| `state_name` | string | yes | — | State-machine key. Must match `[A-Za-z_][A-Za-z0-9_]*` and be unique. |
| `description` | string | no | `""` | Documentation only. |
| `terminal` | boolean | yes | `false` | Forbids outgoing transitions when `true`; the editor hides the output handle. |
| `entry_actions` | action array | yes | `[]` | Register actions executed when entering the state. |
| `exit_actions` | action array | yes | `[]` | Register actions executed when leaving the state. |

### Register actions

```yaml
entry_actions:
  - kind: set_register
    register: STATUS
    value: 0x01
    mask: 0x03
    allow_read_only_internal: true
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `kind` | string | yes | `set_register` or `reset_register`. |
| `register` | string | yes | Register name from the device model. |
| `value` | non-negative integer or numeric string | for `set_register` | Value to write. Decimal and `0x` hexadecimal strings are accepted. |
| `reset_value` | non-negative integer or numeric string | for `reset_register` | Explicit configured reset value. |
| `mask` | non-negative integer or numeric string | no | Limits the affected bits. |
| `allow_read_only_internal` | boolean | for read-only registers | Explicitly permits a device-internal hardware update. |

Both action kinds compile to the runtime-supported internal `set_register`
action. `reset_register` does not look up a reset value; authors must provide
`reset_value`.

Values must fit safely in a JavaScript integer because the current compiler
emits JSON numbers.

## State transition edge

Kind: `device_behavior.transition`

A transition must connect the source node's `out` handle to the target node's
`in` handle.

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `trigger_type` | enum | yes | `event` | `event` or `command`. |
| `trigger` | string | yes | `event` | Runtime event identifier. |
| `priority` | integer | yes | `0` | Deterministic ordering; higher values are evaluated first. |
| `guard_enabled` | boolean | yes | `false` | Enables the register-equals guard fields. |
| `guard_register` | string | when guarded | `""` | Register name to read. |
| `guard_equals` | non-negative integer or numeric string | when guarded | `0x0` | Expected value. |
| `guard_mask` | non-negative integer or numeric string | no | `""` | Optional mask applied by the runtime guard. |
| `delay_value` | positive integer or `null` | no | `null` | Schedules the event after state entry. |
| `delay_unit` | enum | with delay | `ms` | `ns`, `us`, `ms`, or `s`. |

Example guarded transition:

```yaml
- id: write-enabled
  kind: device_behavior.transition
  source: state-ready
  sourceHandle: out
  target: state-write-enabled
  targetHandle: in
  data:
    trigger_type: command
    trigger: write_enable
    priority: 10
    guard_enabled: true
    guard_register: STATUS
    guard_equals: 0x00
    guard_mask: 0x01
    delay_value: null
    delay_unit: ms
  ui: {}
```

Command triggers compile to the runtime event field. The command handler must
already dispatch an event with the authored identifier. Delays are not
supported on command triggers.

A delay is stored in the source state's `delayed_events`. It must convert
exactly to a positive whole number of microseconds. For example, `1 ms` and
`1000 us` are valid, while `1 ns` is not representable.

## Typed signal edge

Kind: `device_behavior.signal`

Signal edges connect runtime states or signal nodes to signal-node input ports.
A state source emits boolean `true` when entered. Logical and timing nodes emit
boolean signals, Delay forwards its input value, File Read emits `bytes`,
`text`, or `json`, and File Write emits boolean success.

Timing nodes use the simulator virtual clock. Pending Timer, Delay, Timeout, and
Interval work is cancelled when the owning state exits. Interval reschedules
deterministically at its configured virtual duration.

File paths are package-relative. Absolute paths, parent traversal, and symlink
escapes are rejected. File Write targets must be under `runtime-data/`; File
Read may read another package resource such as `fixtures/`.

## Design catalog nodes

The editor registry also exposes the following typed signal node kinds. Device
packages compile them into the runtime signal graph when connected with
`device_behavior.signal` edges. State-to-signal edges activate their target
when the state is entered; signal-to-signal edges forward typed values.

| Kind | Display name | Inputs | Output | Authored parameters |
| --- | --- | --- | --- | --- |
| `device_behavior.logical_not` | NOT | `in` | `out` | `label` |
| `device_behavior.logical_and` | AND | `a`, `b` | `out` | `label` |
| `device_behavior.logical_or` | OR | `a`, `b` | `out` | `label` |
| `device_behavior.logical_nand` | NAND | `a`, `b` | `out` | `label` |
| `device_behavior.logical_nor` | NOR | `a`, `b` | `out` | `label` |
| `device_behavior.logical_xor` | XOR | `a`, `b` | `out` | `label` |
| `device_behavior.logical_xnor` | XNOR | `a`, `b` | `out` | `label` |
| `device_behavior.timer` | Timer | `in` | `out` | `label`, `duration`, `unit` |
| `device_behavior.delay` | Delay | `in` | `out` | `label`, `duration`, `unit` |
| `device_behavior.timeout` | Timeout | `in` | `out` | `label`, `duration`, `unit` |
| `device_behavior.interval` | Interval | `in` | `out` | `label`, `duration`, `unit` |
| `device_behavior.file_read` | File Read | `in` | `out` | `label`, `path`, `format`, `offset`, `length` |
| `device_behavior.file_write` | File Write | `a`, `b` | `out` | `label`, `path`, `format`, `mode`, `create` |

Time node `unit` values are `ns`, `us`, `ms`, or `s`. File `format` values
offered by the editor are `bytes`, `text`, and `json`; File Write `mode` is
`overwrite` or `append`.

The following metadata kinds remain registered for extension discovery but are
not offered as active runtime constructs:

- `device_behavior.command_trigger`
- `device_behavior.event_trigger`
- `device_behavior.guard`
- `device_behavior.set_register`
- `device_behavior.reset_register`
- `device_behavior.emit_event`
- `device_behavior.start_operation`
- `device_behavior.complete_operation`
- `device_behavior.end`

In v1, triggers, guards, and delays belong to transition edges, while register
actions belong to state nodes.

## Reusable editor nodes

The editor can link multiple visual instances by storing the same generated
string in `node.ui.reusable_id`. Linked instances share their `data` settings,
but retain independent IDs, positions, and connections.

`ui.reusable_id` is editor metadata and is not part of the compiled runtime
state-machine contract. The v1 validator still requires every serialized state
node to have a unique `state_name`, so multiple visual instances of the same
runtime state must not be committed as separate state nodes in a distributable
flow. Authors generating files outside the editor should normally omit
`reusable_id`.

## Validation rules

A compilable behavior flow must satisfy all of the following:

- exactly one `device_behavior.initial_state` exists;
- every state has a non-empty, valid, unique `state_name`;
- every behavior transition connects runtime state nodes;
- every transition has a trigger and a valid trigger type;
- terminal states have no outgoing transitions;
- guarded transitions provide a valid register and non-negative integer values;
- transition priority is a safe integer;
- delayed events convert exactly to positive whole microseconds;
- command transitions do not define delayed events;
- transitions with the same source, trigger, guard, and priority do not target
  different states.

States with no incoming edge and states unreachable from the Initial State
produce warnings. They do not by themselves prevent compilation.

## Deterministic compilation

Compilation is independent of node coordinates, viewport, selection, and
runtime highlighting.

States are ordered by `state_name`. Transitions are ordered by source state,
descending priority, event, target state, and finally edge ID. The compiler
produces:

```json
{
  "state_machine": {
    "initial_state": "resetting",
    "states": {
      "ready": {},
      "resetting": {
        "transitions": [
          { "event": "reset_complete", "target": "ready" }
        ],
        "delayed_events": [
          { "event": "reset_complete", "delay_us": 5000 }
        ]
      }
    }
  }
}
```

## Community authoring workflow

1. Start from
   [`device-models/examples/micron-mt25ql256aba8esf-0sit/flows/behavior.yaml`](../../device-models/examples/micron-mt25ql256aba8esf-0sit/flows/behavior.yaml).
2. Give every node and edge a stable unique ID.
3. Define exactly one Initial State and add regular State nodes.
4. Add state entry/exit register actions using register names from the device
   package.
5. Connect states with `device_behavior.transition` edges.
6. Open the flow in the Device Behavior Editor and run **Validate**.
7. Use **Compile** to inspect the generated runtime fragment.
8. Test reset, state transitions, and register side effects against the device
   package fixtures before contributing the model.

For the surrounding device-package layout and schemas, see the
[Device Package SDK guide](../development/device-package-sdk.md). For compiler
architecture and runtime boundaries, see
[Visual device behavior authoring](../development/visual-device-behavior-authoring.md).
