# Visual scenario authoring

The Visual Scenario Editor is an offline-capable authoring surface built on the generic flow editor. It does not execute simulator behavior. A scenario flow is validated and compiled to the existing `schema_version: 1` scenario document, then submitted through the existing control-plane run endpoint. `vds-scenario` remains the only executor.

## Document and compiler behavior

Scenario flows use the generic versioned flow document with `flow.kind = "scenario"`. Node positions, viewport data, validation metadata, and runtime highlights are authoring concerns and are not emitted into the compiled scenario. Start Scenario and End Scenario establish visual boundaries and are omitted from executable steps.

Compilation follows the single outgoing edge from the sole Start node until an End node. This makes output independent of edge insertion order and node coordinates. Authored valid step IDs are preserved. Missing step IDs are derived from stable node IDs; collisions receive deterministic numeric suffixes.

The current executor represents durations in whole milliseconds. The compiler accepts ns, us, ms, and s authoring units only when the value converts exactly to a positive whole number of milliseconds. It rejects values that would require rounding or overflow.

The current runtime schema does not expose response capacity or per-command transport timeout. Those values remain in the authored node data, produce compiler warnings, and are omitted from the runtime definition rather than implying unsupported behavior.

## Unsupported graphs

Scenario v1 execution is sequential. Compilation rejects branches, merges, cycles, loops, parallel paths, disconnected executable nodes, and paths that do not terminate at End. The generic editor can represent some of these shapes, but the scenario compiler will not run them.

## Named results

`Send SPI` result names match `^[A-Za-z_][A-Za-z0-9_]*$` and must be unique. An explicitly present but empty result name is invalid. If the field is omitted, the compiler derives a stable name from the compiled step ID. Assert Response and Assert Error may reference only a result produced earlier on the linear execution path. Forward, missing, and broken references are compiler errors.

## Runtime event mapping and recovery

The compiler returns a `step_id → node_id` map. The editor consumes the existing shared WebSocket event stream and maps `scenario_step_started` and `scenario_step_completed` events to external node runtime statuses. It does not open another WebSocket connection.

REST run snapshots and final results are authoritative. On reconnect, the shared event cursor requests events after the last accepted event ID; replayed step events restore live highlighting, while the polled run snapshot and result reconcile terminal state. Runtime status is transient: it does not mark the flow dirty and is excluded from undo/redo history.

Compiled documents are posted to the existing `POST /api/v1/scenarios/{id}/run` control-plane path. An empty request body retains the preconfigured-scenario behavior. No REST SPI transaction route is introduced; the Unix socket and Protobuf path remains the hardware data plane.

## Phase gate

Visual Scenario Editor v1 does not include or begin the Device Behavior Editor, Topology Editor, or Fault Flow Editor phases.
