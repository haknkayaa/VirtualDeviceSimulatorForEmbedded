use std::{
    io::Write,
    sync::{Arc, Mutex},
};

use vds_core::{clock::ManualClock, registry::DeviceRegistry};
use vds_device_model::DeviceModel;
use vds_scenario::{
    RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioError, ScenarioExecutor,
    StepFailureKind,
};

const DEVICE: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Scenario Device
  bus: spi
  model: generic-spi-command
  commands:
    - { name: READ_ID, opcode: 0x9F, response: [0xEF, 0x40, 0x18] }
    - { name: READ_REGISTER, opcode: 0x03, operation: register_read, address_bytes: 1 }
    - { name: WRITE_REGISTER, opcode: 0x02, operation: register_write, address_bytes: 1, allowed_states: [ready] }
  state_machine:
    initial_state: resetting
    states:
      resetting:
        transitions: [{ event: reset_complete, target: ready }]
        delayed_events: [{ event: reset_complete, delay_us: 5000 }]
      ready: {}
  registers:
    - { name: CONTROL, address: 0x01, width_bits: 8, reset_value: 0x12, access: rw }
  faults:
    - id: read_id_timeout
      enabled: false
      target: { command: READ_ID }
      trigger: always
      action: { type: timeout, duration_ms: 500 }
";

const COMPLETE_SCENARIO: &str = r#"
schema_version: 1
scenario:
  id: delayed_write_with_timeout
  name: Delayed Write With Timeout
  timeout_ms: 1000
steps:
  - { id: reset, action: reset_device, device: spi-flash-0 }
  - { id: wait_ready_event, action: wait_for_event, device: spi-flash-0, event: state_transition, timeout_ms: 5 }
  - { id: complete_reset, action: advance_time, duration_ms: 5 }
  - { id: check_ready, action: assert_state, device: spi-flash-0, expected: ready }
  - { id: check_control, action: assert_register, device: spi-flash-0, register: CONTROL, expected: 0x12 }
  - { id: normal_read, action: send_spi, device: spi-flash-0, tx: "9F", save_as: normal }
  - { id: check_response, action: assert_response, source: normal, expected: "EF 40 18" }
  - { id: enable_timeout, action: enable_fault, fault: read_id_timeout }
  - { id: faulted_read, action: send_spi, device: spi-flash-0, tx: "9F", save_as: faulted }
  - { id: check_timeout, action: assert_error, source: faulted, expected_code: fault_timeout }
  - { id: disable_timeout, action: disable_fault, fault: read_id_timeout }
  - { id: final_read, action: send_spi, device: spi-flash-0, tx: "9F", save_as: final }
  - { id: check_final, action: assert_response, source: final, expected: "EF 40 18" }
"#;

fn executor() -> ScenarioExecutor<RegistryRuntime> {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(DEVICE)
        .unwrap()
        .into_spi_device_with_clock(clock.clone())
        .unwrap();
    let registry = DeviceRegistry::new();
    registry.register(Arc::new(device)).unwrap();
    ScenarioExecutor::new(RegistryRuntime::new(Arc::new(registry), clock))
}

#[test]
fn parses_yaml_and_rejects_duplicate_ids_and_unknown_actions() {
    assert_eq!(
        ScenarioDocument::from_yaml(COMPLETE_SCENARIO)
            .unwrap()
            .steps
            .len(),
        13
    );
    let duplicate = COMPLETE_SCENARIO.replace("id: check_ready", "id: reset");
    assert!(
        matches!(ScenarioDocument::from_yaml(&duplicate), Err(ScenarioError::DuplicateStepId(id)) if id == "reset")
    );
    let unknown = COMPLETE_SCENARIO.replace("action: reset_device", "action: launch_process");
    assert!(matches!(
        ScenarioDocument::from_yaml(&unknown),
        Err(ScenarioError::Validation(_))
    ));
}

#[test]
fn executes_sequential_actions_and_exports_json() {
    let document = ScenarioDocument::from_yaml(COMPLETE_SCENARIO).unwrap();
    let result = executor().run(&document);
    assert_eq!(result.status, ResultStatus::Passed, "{result:#?}");
    assert_eq!(result.duration_virtual_ns, 5_000_000);
    assert_eq!(result.steps_passed, 13);
    let json = result.to_json_pretty().unwrap();
    assert!(json.contains("\"scenario_id\": \"delayed_write_with_timeout\""));
    assert!(json.contains("\"status\": \"passed\""));
}

#[test]
fn failure_stops_and_continue_on_failure_is_optional() {
    let stopped = COMPLETE_SCENARIO.replace("expected: ready", "expected: broken");
    let result = executor().run(&ScenarioDocument::from_yaml(&stopped).unwrap());
    assert_eq!(result.steps_failed, 1);
    assert!(result.steps_skipped > 0);
    assert_eq!(
        result.steps[3].failure_kind,
        Some(StepFailureKind::Assertion)
    );

    let continued = stopped.replace(
        "id: check_ready, action: assert_state",
        "id: check_ready, continue_on_failure: true, action: assert_state",
    );
    let result = executor().run(&ScenarioDocument::from_yaml(&continued).unwrap());
    assert_eq!(result.status, ResultStatus::Failed);
    assert_eq!(result.steps_failed, 1);
    assert_eq!(result.steps_skipped, 0);
}

#[test]
fn event_wait_times_out_at_exact_virtual_deadline() {
    let yaml = r"
schema_version: 1
scenario: { id: timeout, name: Timeout, timeout_ms: 20 }
steps:
  - { id: wait, action: wait_for_event, event: device_operation_completed, timeout_ms: 7 }
  - { id: skipped, action: advance_time, duration_ms: 1 }
";
    let result = executor().run(&ScenarioDocument::from_yaml(yaml).unwrap());
    assert_eq!(result.status, ResultStatus::Failed);
    assert_eq!(result.duration_virtual_ns, 7_000_000);
    assert_eq!(result.steps_skipped, 1);
    assert_eq!(result.steps[0].failure_kind, Some(StepFailureKind::Timeout));
    assert!(result.timed_out());
}

#[test]
fn event_wait_advances_to_the_scheduled_event() {
    let yaml = r"
schema_version: 1
scenario: { id: wait_success, name: Wait Success, timeout_ms: 10 }
steps:
  - { id: wait, action: wait_for_event, device: spi-flash-0, event: state_transition, timeout_ms: 5 }
  - { id: ready, action: assert_state, device: spi-flash-0, expected: ready }
";
    let result = executor().run(&ScenarioDocument::from_yaml(yaml).unwrap());
    assert_eq!(result.status, ResultStatus::Passed, "{result:#?}");
    assert_eq!(result.duration_virtual_ns, 5_000_000);
}

#[test]
fn scenario_timeout_prevents_time_from_advancing_past_deadline() {
    let yaml = r"
schema_version: 1
scenario: { id: bounded, name: Bounded, timeout_ms: 3 }
steps:
  - { id: too_far, action: advance_time, duration_ms: 4 }
";
    let result = executor().run(&ScenarioDocument::from_yaml(yaml).unwrap());
    assert_eq!(result.status, ResultStatus::Failed);
    assert_eq!(result.duration_virtual_ns, 0);
    assert!(
        result.steps[0]
            .error
            .as_deref()
            .unwrap()
            .contains("timeout")
    );
}

#[test]
fn replay_is_deterministic() {
    let document = ScenarioDocument::from_yaml(COMPLETE_SCENARIO).unwrap();
    assert_eq!(executor().run(&document), executor().run(&document));
}

#[derive(Clone)]
struct LogWriter(Arc<Mutex<Vec<u8>>>);

impl Write for LogWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn emits_structured_scenario_and_step_logs() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let writer = LogWriter(buffer.clone());
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let document = ScenarioDocument::from_yaml(COMPLETE_SCENARIO).unwrap();
    tracing::subscriber::set_global_default(subscriber).unwrap();
    assert_eq!(executor().run(&document).status, ResultStatus::Passed);
    let logs = String::from_utf8(buffer.lock().unwrap().clone()).unwrap();
    assert!(logs.contains("\"event\":\"scenario_started\""));
    assert!(
        logs.contains("\"event\":\"scenario_step_completed\""),
        "{logs}"
    );
    assert!(logs.contains("\"event\":\"scenario_completed\""));
    assert!(logs.contains("\"scenario_id\":\"delayed_write_with_timeout\""));
}
