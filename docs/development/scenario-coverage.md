# Scenario coverage

A scenario run reports how much of each device model it exercised
([ADR 0013](../adr/0013-measure-scenario-coverage-against-device-models.md)).
Coverage is informational and never changes a run's status.

## What counts

| Metric | Declared in the model | Exercised when |
| --- | --- | --- |
| `commands` | `commands[].opcode` | a `send_spi` request starts with the opcode, whatever the outcome |
| `registers` | `registers[]` | a transfer or a completed operation returns a register trace for it |
| `states` | `state_machine.states` | the device is in the state when the run starts, or a `state_transition` enters or leaves it |
| `transitions` | each state's `transitions[].target`, as `from -> to` | a `state_transition` with that `from` and `to` is observed |
| `faults` | `faults[].id` | a `fault_triggered` event names it |

`assert_register` and `assert_state` inspect the runtime directly and do not
count. Only devices the scenario names, or whose faults it enables or disables,
are reported. A metric whose model declares nothing reports `0/0`.

## Where it appears

- JSON result, as the optional `coverage` field (here for the package's
  `04-deep-power-down.yaml`):

  ```json
  "coverage": { "devices": [ {
    "device_id": "micron-mt25ql256aba8esf-0sit",
    "commands": { "covered": 3, "total": 21, "missed": ["WRITE_DISABLE", "..."] },
    "registers": { "covered": 0, "total": 12, "missed": ["..."] },
    "states": { "covered": 3, "total": 7, "missed": ["..."] },
    "transitions": { "covered": 3, "total": 16, "missed": ["..."] },
    "faults": { "covered": 0, "total": 5, "missed": ["..."] }
  } ] }
  ```

- JUnit properties `vds4e.coverage.<device>.<metric>` = `covered/total`.
- `vds-cli scenario run` prints one line per device on standard error:

  ```text
  coverage micron-mt25ql256aba8esf-0sit: commands 3/21, registers 0/12, states 3/7, transitions 3/16, faults 0/5
  ```

- The Visual Scenario Editor result panel shows the same table, with the items
  that were not exercised listed under *Not exercised on …*.

Results produced without coverage targets, for example by a custom
`ScenarioExecutor` that does not call `with_coverage`, omit the field.
