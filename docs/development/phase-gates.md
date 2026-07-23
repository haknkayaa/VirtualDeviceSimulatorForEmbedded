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

## Scenario Engine v1

| Gate | Automated coverage |
| --- | --- |
| YAML parsing, duplicate IDs, and unknown actions | `parses_yaml_and_rejects_duplicate_ids_and_unknown_actions` |
| Sequential reset, SPI, time, fault, and assertion execution | `executes_sequential_actions_and_exports_json` |
| Failure stops and remaining steps are skipped | `failure_stops_and_continue_on_failure_is_optional` |
| Optional continue-on-failure executes remaining steps | `failure_stops_and_continue_on_failure_is_optional` |
| Manual time and global scenario timeout | `scenario_timeout_prevents_time_from_advancing_past_deadline` |
| Event wait success | `event_wait_advances_to_the_scheduled_event` |
| Event wait timeout | `event_wait_times_out_at_exact_virtual_deadline` |
| JSON result export | `executes_sequential_actions_and_exports_json` |
| Deterministic replay | `replay_is_deterministic` |
| Structured scenario and step logs | `emits_structured_scenario_and_step_logs` |
| Existing fault, state, timing, register, READ_ID and C client behavior remains compatible | `cargo test --workspace` |

## Control API and Live Event Stream v1

| Gate | Automated coverage |
| --- | --- |
| Event ordering and exclusive replay by event ID | `event_ids_are_ordered_and_replay_is_exclusive` |
| Deterministic bounded-ring eviction | `ring_eviction_is_fifo_and_deterministic` |
| Slow subscribers do not block publishers or peers | `slow_subscriber_does_not_block_publishers_or_other_subscribers` |
| Health, device, register, state, reset, and fault endpoints | `health_device_register_state_reset_and_fault_endpoints_work` |
| Scenario start is asynchronous and result is retrievable | `scenario_run_is_asynchronous_and_result_is_retrievable` |
| Scenario execution emits typed domain events | `scenario_run_is_asynchronous_and_result_is_retrievable` |
| Structured API errors and no REST SPI data plane | `structured_errors_and_data_plane_separation_are_enforced` |
| WebSocket ordered replay and live delivery | `websocket_delivers_ordered_replay_after_event_id` |
| Existing scenario, fault, state, timing, register, READ_ID, and C client behavior remains compatible | `cargo test --workspace` |

## Web UI Foundation v1

| Gate | Automated coverage |
| --- | --- |
| Typed REST response and structured error mapping | `REST API mapping` |
| WebSocket reconnect resumes from the latest cursor | `event stream reconnect` |
| Replay cursor rejects duplicates and moves monotonically | `event replay cursor` |
| Device and register snapshots render | `devices page` |
| Fault enable action uses the control API | `devices page` |
| Scenario start, polling, steps, and JSON result render | `scenario run lifecycle` |
| Disconnected and API error states are explicit | `transactions connection states`, `devices page` |
| Production bundle type-checks and builds | `npm run build` |
| No REST hardware transaction route is introduced | API client review and `structured_errors_and_data_plane_separation_are_enforced` |

## Visual Scenario Editor v1

| Gate | Automated coverage |
| --- | --- |
| All visual scenario node kinds register through the generic registry | `scenario node registry` |
| Linear graphs compile deterministically independent of coordinates and edge insertion | `scenario flow compiler` |
| Start and End remain visual-only | `scenario flow compiler` |
| All ten existing runtime actions map to the existing scenario schema | `scenario flow compiler` |
| Branches, cycles, disconnected nodes, invalid parameters, and forward result references are rejected | `scenario flow validation`, `scenario flow compiler` |
| Runtime events map to external highlights without changing document history | `scenario runtime mapping` |
| Browser-compiled definitions use the existing run manager and executor | `compiled_visual_scenario_uses_the_existing_run_endpoint_and_executor` |
| Empty-body configured scenario runs remain backward compatible | `scenario_run_is_asynchronous_and_result_is_retrievable` |
| No REST hardware transaction route is introduced | `structured_errors_and_data_plane_separation_are_enforced` |

## Visual Device Behavior Editor v1

| Gate | Automated coverage |
| --- | --- |
| All behavior node kinds and the typed transition edge register through the generic registries | `device behavior registries` |
| Edge-centric state graphs compile deterministically independent of coordinates and insertion order | `device behavior compiler` |
| Initial state, entry/exit actions, guards, delayed events, and cyclic transitions map to the existing schema | `device behavior compiler`, `device behavior validation` |
| Ambiguous transitions, unsupported guards, invalid delays, and invalid register actions are rejected | `device behavior validation` |
| REST snapshot and WebSocket replay map to transient runtime highlights without changing history | `behavior runtime mapping` |
| Local save and deterministic import/export preserve semantic data | `device behavior persistence` |
| No new runtime or REST hardware transaction route is introduced | architecture review and API client review |
| Complete public Generic SPI Flash 128 Mbit example loads, compiles, and runs all ten conformance scenarios | `generic_spi_flash_reference`, `device behavior compiler`, `device behavior persistence` |

Topology Editor work has not started. Passing this gate does not authorize that phase.

## JUnit XML Export v1

| Gate | Automated coverage |
| --- | --- |
| Passing, assertion failure, execution error, and skipped steps map to JUnit elements | `junit::tests::maps_pass_failure_error_and_skipped_with_deterministic_durations` |
| XML escaping, XML 1.0 character safety, duration conversion, and deterministic output | `junit::tests::maps_pass_failure_error_and_skipped_with_deterministic_durations` |
| Sensitive raw diagnostics are omitted | `junit::tests::maps_pass_failure_error_and_skipped_with_deterministic_durations` |
| Existing JSON result shape remains unchanged | `junit::tests::preserves_the_existing_json_result_shape` |
| CLI writes JSON and JUnit artifacts through the existing executor | `scenario_command_writes_json_and_junit_files` |
| API returns JUnit body and artifact headers | `compiled_visual_scenario_uses_the_existing_run_endpoint_and_executor` |
| Visual Scenario Editor delegates XML creation to the API | `ScenarioResultPanel`, `REST API mapping` |
| Existing scenario runtime semantics remain compatible | `cargo test --workspace` |
