# 0013: Measure scenario coverage against device models

- Status: Proposed
- Date: 2026-10-08

## Context

Scenario runs report pass/fail per step, but not how much of a device model a
scenario exercised. A suite can pass while never sending a declared command,
never reaching a declared state, or never triggering a declared fault. CI users
asked for this in the roadmap ("coverage metrics for models, state transitions,
registers, faults, and scenarios").

Everything needed is already observable without new runtime hooks:

- the declared surface lives in each package's device model (`commands`,
  `registers`, `state_machine`, `faults`);
- the executor sees every SPI request it sends, the register trace returned by
  each transfer, and every device event (`state_transition`,
  `operation_completed` with its register trace, `fault_triggered`).

## Decision

1. **Targets come from models, observations from the executor.**
   `vds_scenario::CoverageTargets` is built from the loaded `DeviceModel`s. Per
   device it holds command opcodes and names, register addresses and names,
   state names, `(from, to)` state-machine transitions and fault IDs. The
   executor records what the run exercised:

   | Metric | Exercised when |
   | --- | --- |
   | commands | an SPI request whose first byte is a declared opcode is sent, whatever the outcome |
   | registers | a transfer or completed operation returns a register trace for the register |
   | states | the device is in the state when the run starts, or a `state_transition` enters or leaves it |
   | transitions | a `state_transition` event with that `from` and `to` is observed |
   | faults | a `fault_triggered` event names the fault |

   Inspection reads by `assert_register` and `assert_state` are not counted:
   coverage measures what reached the device model through its normal paths.

2. **Scope is the devices the scenario references.** Devices the scenario never
   names are not reported. Metrics with no declared items report `0/0`.

3. **Results carry coverage as an optional field.** `ScenarioResult.coverage`
   is present only when the caller supplied targets, so results from callers
   that do not compute coverage are unchanged:

   ```json
   "coverage": { "devices": [ {
     "device_id": "flash",
     "commands": { "covered": 3, "total": 9, "missed": ["chip_erase", "..."] },
     "registers": { "covered": 1, "total": 4, "missed": ["..."] },
     "states": { ... }, "transitions": { ... }, "faults": { ... }
   } ] }
   ```

   JUnit adds one `vds4e.coverage.<device>.<metric>` property per metric with
   the value `covered/total`. The CLI prints one summary line per device.

4. **Coverage is informational.** It never changes a run's status. Thresholds
   that fail CI are left to the pipeline reading the JSON or JUnit output.

## Alternatives

- **Compute coverage in the Web UI from the event stream.** Rejected: headless
  CLI runs and JUnit consumers need it too, and the event ring buffer may have
  dropped events.
- **Count inspection reads as coverage.** Rejected: an `assert_register` read
  proves nothing about how the application path reaches the register.
- **Add command and state enumeration to the `Device` trait.** Not needed: the
  declarations are already in the models the caller loaded, and the trait stays
  focused on runtime behavior.

## Consequences

- CI can see untested commands, states, transitions and faults per scenario.
- `vds-scenario` gains a dependency on `vds-device-model` to read declarations.
- Coverage reflects SPI-driven scenarios today, because `send_spi` is the only
  bus action; I2C, GPIO and UART actions will add their own observations when
  they are introduced.
- Register traces without a name are matched by address.

## Migration impact

Additive. Existing JSON consumers ignore the new optional field; JUnit gains
properties only. No configuration change is required.
