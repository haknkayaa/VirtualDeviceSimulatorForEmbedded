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
