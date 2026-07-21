# Phase gates

No work may begin on the next development phase unless every Register Engine
v1 gate below passes in the same `cargo test --workspace` run.

| Gate | Automated coverage |
| --- | --- |
| READ_ID fixed response | `read_id_round_trips_over_the_unix_socket` |
| RW register read | `spi_register_write_then_read_round_trips_and_logs_metadata` |
| RW register write | `spi_register_write_then_read_round_trips_and_logs_metadata` |
| RO register write rejection | `register_access_errors_remain_structured_over_the_socket` |
| Unknown register rejection | `register_access_errors_remain_structured_over_the_socket` |
| Invalid payload length rejection | `invalid_register_payload_lengths_are_rejected` |
| Reset restores reset value | `reset_restores_reset_value` |
| Concurrent read consistency | `concurrent_register_reads_are_consistent` |
| Transaction log includes register information | `spi_register_write_then_read_round_trips_and_logs_metadata` |

Required command:

```shell
cargo test --workspace
```

Formatting and lint gates must also pass:

```shell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Virtual Clock and Timing Engine v1

No work may begin on the state-machine engine until every timing gate below
passes in the same workspace test run.

| Gate | Automated coverage |
| --- | --- |
| Manual clock starts at a deterministic value | `manual_clock_starts_at_zero_and_advances` |
| Scheduled event fires at its exact deadline | `events_fire_at_the_exact_deadline` |
| Event does not fire early | `events_do_not_fire_early` |
| Same-deadline events preserve deterministic order | `same_deadline_events_preserve_insertion_order` |
| Cancelled event does not execute | `cancelled_events_do_not_execute` |
| Device enters busy state | `delayed_write_observes_busy_lifecycle` |
| Write completes after configured latency | `delayed_write_observes_busy_lifecycle` |
| Busy clears after completion | `delayed_write_observes_busy_lifecycle` |
| Reset cancels pending operations | `reset_cancels_pending_operations` |
| READ_ID remains backward compatible | `read_id_round_trips_over_the_unix_socket` |
| C client wire format remains compatible | `c_client_read_id_remains_compatible` |
| Transaction logs include timing start/completion | `timed_write_logs_start_and_completion` |

## Device State Machine v1

No work may begin on fault injection or scenario behavior until every state
machine gate below passes in the same workspace test run.

| Gate | Automated coverage |
| --- | --- |
| Initial state loads from YAML | `state_machine_initial_state_and_targets_are_validated` |
| Unknown initial state is rejected | `state_machine_initial_state_and_targets_are_validated` |
| Unknown transition target is rejected | `state_machine_initial_state_and_targets_are_validated` |
| Valid transition succeeds | `valid_transition_returns_exit_and_entry_actions` |
| Invalid event is rejected | `rejects_invalid_event` |
| Guard condition controls transition | `rejects_transition_when_guard_is_false` |
| Entry action executes | `delayed_transition_and_state_actions_execute_at_exact_deadline` |
| Exit action executes | `delayed_transition_and_state_actions_execute_at_exact_deadline` |
| Delayed event transitions at exact deadline | `delayed_transition_and_state_actions_execute_at_exact_deadline` |
| Reset returns to initial state and cancels pending work | `state_machine_reset_cancels_operations_and_reenters_initial_state` |
| Busy command rejection is state-aware | `delayed_transition_and_state_actions_execute_at_exact_deadline` |
| State transitions are structured logs | `timed_write_logs_start_and_completion` |
| Existing timing behavior remains compatible | `delayed_write_observes_busy_lifecycle` |
| READ_ID remains compatible | `read_id_round_trips_over_the_unix_socket` |

## Fault Injection Engine v1

No work may begin on scenario behavior until every fault gate below passes in
the same workspace test run.

| Gate | Automated coverage |
| --- | --- |
| YAML parsing and action validation | `fault_yaml_rejects_duplicate_ids_and_unknown_actions` |
| Disabled faults are ignored | `disabled_fault_is_ignored` |
| First-N and Every-Nth are deterministic | `first_n_and_every_nth_are_deterministic` |
| Priority, YAML order, and terminal precedence | `priority_then_yaml_order_and_terminal_stop` |
| Timeout, returned error, and drop are structured | `terminal_faults_return_structured_errors` |
| Delay uses the virtual scheduler | `delay_uses_virtual_scheduler_and_stuck_at_blocks_writes` |
| Response corruption and forced values work | `fault_actions_are_deterministic_and_structured` |
| Stuck-at constrains normal writes | `delay_uses_virtual_scheduler_and_stuck_at_blocks_writes` |
| Reset honors transient/persistent behavior | `reset_clears_transient_counters_but_preserves_persistent_counters` |
| Fault activation is structured in protocol and logs | `timeout_fault_is_structured_and_logged` |
| Existing state, timing, register, READ_ID and C client behavior remains compatible | `cargo test --workspace` |
