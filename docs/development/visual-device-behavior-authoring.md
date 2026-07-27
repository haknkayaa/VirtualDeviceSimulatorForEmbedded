# Visual device behavior authoring

The public file-format, node, port, and parameter contract is documented in the
[Device behavior flow reference](../device-models/device-behavior-flow-reference.md).
The package-load compilation and runtime execution decision is recorded in
[ADR 0007](../adr/0007-compile-device-behavior-flows-into-typed-runtime-graphs.md).

Visual Device Behavior Editor v1 is an authoring surface for the existing
device-model state-machine schema. It does not execute transitions in React and
does not introduce another register engine, clock, scheduler, or state-machine
runtime.

## Graph model

The editor uses one unambiguous edge-centric model:

- `Initial State` and `State` nodes are runtime states.
- Exactly one Initial State is required and supplies `initial_state`.
- Directed `State transition` edges contain the event or command-dispatched
  event, optional register-equals guard, optional state-entry delay, and
  deterministic priority.
- Entry and exit register actions belong to state nodes.
- Typed logical, timing, and file-I/O nodes form a signal graph connected by
  `device_behavior.signal` edges. A state-to-signal edge activates its target
  when that state is entered.
- Cycles are valid. Generic scenario cycle rejection is not applied.

An edge delay compiles to the source state's existing `delayed_events` entry and
uses the runtime scheduler. Values must convert exactly to whole microseconds;
the editor never sleeps on wall-clock time.

## Compiler mapping and ordering

States are ordered by state name and transitions by source state, descending
priority, event, target state, then edge ID. Coordinates, viewport, selection,
and runtime highlights never influence output. Equal-priority transitions with
the same source, trigger, and guard but different targets are rejected as
ambiguous. The generated JSON is a device-model `state_machine` fragment:

- state name → state map key
- Initial State name → `initial_state`
- state entry/exit actions → existing `set_register` internal actions
- edge trigger/target → existing transition
- edge register guard → existing register guard
- edge delay → existing state `delayed_events`

`Reset Register` requires an explicitly authored configured reset value because
the Control API register snapshot does not expose model reset values. It
compiles to the same runtime-supported internal `set_register` action. A
read-only register action must be explicitly marked device-internal; authored
values are otherwise rejected.

## Runtime observation and recovery

REST supplies the authoritative current device state and register snapshot.
The existing shared WebSocket connection supplies ordered/replayed
`state_transition` and `device_reset` events. State names and
source/trigger/target transition keys map those events to transient node and
edge highlights. Replayed runtime data does not enter the flow document,
dirty-state calculation, or undo history.

The v1 test panel exposes reset and observation only. Manual event dispatch,
virtual-time advancement, and command execution are not shown because the
current Control API has no safe adapter for them. No REST hardware transaction
endpoint is added.

## Supported and unsupported constructs

Supported behavior includes flat states, event transitions, register-equals
guards, state-entry delayed events, internal register actions, typed boolean
logic, virtual-clock Timer/Delay/Timeout/Interval nodes, and sandboxed
File Read/File Write nodes. File reads remain inside the package root; writes
are restricted to the package `runtime-data/` directory. Hierarchical or
parallel states, history states, arbitrary expressions, scripts, runtime
JavaScript, and ambiguous mixed node/edge semantics are rejected.

Resource selectors use REST snapshots. If a device or register disappears, its
authored identifier remains visible and validation reports the missing
resource; data is never silently cleared.

The included example is a generic resetting/ready/busy model and contains no
company-private protocols or device knowledge.

## Phase gate

Visual Device Behavior Editor v1 is complete only when its validation,
deterministic compiler, local persistence, snapshot/replay highlighting, and
frontend regression gates pass. Topology Editor work has not started.
