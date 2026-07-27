use std::{sync::Arc, time::Duration};

use vds_core::{
    clock::ManualClock,
    device::{Device, DeviceError, FaultErrorCode, StateErrorCode, TimingErrorCode},
    event::DeviceEvent,
};

use super::{DeviceModel, GenericSpiDevice, ModelError};

const MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Example SPI Flash
  bus: spi
  model: generic-spi-command
  commands:
    - name: READ_ID
      opcode: 0x9F
      response: [0xEF, 0x40, 0x18]
";

const TIMED_MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Timed SPI Device
  bus: spi
  model: generic-spi-command
  commands:
    - name: READ_ID
      opcode: 0x9F
      response: [0xEF, 0x40, 0x18]
    - name: READ_REGISTER
      opcode: 0x03
      operation: register_read
      address_bytes: 1
    - name: WRITE_REGISTER
      opcode: 0x02
      operation: register_write
      address_bytes: 1
      timing:
        latency_us: 10000
        busy_during_operation: true
  busy:
    register_address: 0x00
    mask: 0x01
  registers:
    - name: STATUS
      address: 0x00
      width_bits: 8
      reset_value: 0x00
      access: ro
    - name: CONTROL
      address: 0x01
      width_bits: 8
      reset_value: 0x12
      access: rw
";

const STATE_MODEL: &str = r"
schema_version: 1
device:
  id: spi-flash-0
  name: Stateful SPI Device
  bus: spi
  model: generic-spi-command
  commands:
    - name: READ_ID
      opcode: 0x9F
      response: [0xEF, 0x40, 0x18]
    - name: READ_REGISTER
      opcode: 0x03
      operation: register_read
      address_bytes: 1
    - name: WRITE_REGISTER
      opcode: 0x02
      operation: register_write
      address_bytes: 1
      allowed_states: [ready]
      timing:
        latency_us: 10000
        busy_during_operation: true
  busy:
    register_address: 0x00
    mask: 0x01
  state_machine:
    initial_state: resetting
    states:
      resetting:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x01
        transitions:
          - event: reset_complete
            target: ready
        delayed_events:
          - event: reset_complete
            delay_us: 5000
      ready:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x00
        exit_actions:
          - set_register:
              name: CONTROL
              value: 0x34
        transitions:
          - event: write_started
            target: busy
            guard:
              register:
                name: STATUS
                mask: 0x01
                equals: 0x00
      busy:
        entry_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x01
        exit_actions:
          - set_register:
              name: STATUS
              mask: 0x01
              value: 0x00
        transitions:
          - event: operation_completed
            target: ready
  registers:
    - name: STATUS
      address: 0x00
      width_bits: 8
      reset_value: 0x00
      access: ro
    - name: CONTROL
      address: 0x01
      width_bits: 8
      reset_value: 0x12
      access: rw
";

#[test]
fn executes_read_id() {
    let device = DeviceModel::from_yaml(MODEL)
        .expect("model should parse")
        .into_spi_device()
        .expect("SPI model should build");

    assert_eq!(
        device
            .transfer(&[0x9f])
            .expect("READ_ID should work")
            .response,
        vec![0xef, 0x40, 0x18]
    );
}

#[test]
fn rejects_unknown_opcode() {
    let device = DeviceModel::from_yaml(MODEL)
        .expect("model should parse")
        .into_spi_device()
        .expect("SPI model should build");

    assert_eq!(
        device.transfer(&[0x00]),
        Err(DeviceError::UnknownOpcode(0x00))
    );
}

#[test]
fn rejects_duplicate_opcodes() {
    let duplicate = MODEL.replace(
            "      response: [0xEF, 0x40, 0x18]",
            "      response: [0xEF, 0x40, 0x18]\n    - name: DUPLICATE\n      opcode: 0x9F\n      response: []",
        );

    assert!(matches!(
        DeviceModel::from_yaml(&duplicate),
        Err(ModelError::DuplicateOpcode { opcode: 0x9f, .. })
    ));
}

#[test]
fn parses_command_timing_and_busy_binding() {
    let model = DeviceModel::from_yaml(TIMED_MODEL).expect("timed model should parse");

    assert_eq!(model.device.busy.expect("busy binding").mask, 1);
    assert_eq!(
        model.device.commands[2]
            .timing
            .expect("write timing")
            .latency_us,
        10_000
    );
}

#[test]
fn delayed_write_observes_busy_lifecycle() {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(TIMED_MODEL)
        .expect("model should parse")
        .into_spi_device_with_clock(clock.clone())
        .expect("device should build");

    let accepted = device
        .transfer(&[0x02, 0x01, 0x5a])
        .expect("write should be accepted");
    assert!(accepted.response.is_empty());
    assert!(matches!(
        accepted.events.as_slice(),
        [DeviceEvent::OperationStarted {
            scheduled_duration_ns: 10_000_000,
            busy: true,
            ..
        }]
    ));
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x01]
    );

    clock
        .advance(Duration::from_millis(9))
        .expect("manual time should advance");
    assert_eq!(
        device
            .transfer(&[0x03, 0x01])
            .expect("control should read")
            .response,
        [0x12]
    );

    clock
        .advance(Duration::from_millis(1))
        .expect("manual time should advance");
    let completed = device
        .transfer(&[0x03, 0x01])
        .expect("control should read after completion");
    assert_eq!(completed.response, [0x5a]);
    assert!(matches!(
        completed.events.as_slice(),
        [DeviceEvent::OperationCompleted {
            scheduled_duration_ns: 10_000_000,
            started_at_ns: 0,
            completed_at_ns: 10_000_000,
            busy: false,
            ..
        }]
    ));
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x00]
    );
}

#[test]
fn reset_cancels_pending_operations() {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(TIMED_MODEL)
        .expect("model should parse")
        .into_spi_device_with_clock(clock.clone())
        .expect("device should build");
    device
        .transfer(&[0x02, 0x01, 0x5a])
        .expect("write should be accepted");

    device.reset().expect("reset should succeed");
    clock
        .advance(Duration::from_millis(10))
        .expect("manual time should advance");

    assert!(
        device
            .run_due_events()
            .expect("due events should run")
            .is_empty()
    );
    assert_eq!(
        device
            .transfer(&[0x03, 0x01])
            .expect("control should read")
            .response,
        [0x12]
    );
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x00]
    );
}

#[test]
fn timed_write_is_rejected_while_device_is_busy() {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(TIMED_MODEL)
        .expect("model should parse")
        .into_spi_device_with_clock(clock)
        .expect("device should build");
    device
        .transfer(&[0x02, 0x01, 0x5a])
        .expect("first write should be accepted");

    assert!(matches!(
        device.transfer(&[0x02, 0x01, 0x34]),
        Err(DeviceError::Timing(failure))
            if failure.code == TimingErrorCode::DeviceBusy
    ));
}

#[test]
fn state_machine_initial_state_and_targets_are_validated() {
    let model = DeviceModel::from_yaml(STATE_MODEL).expect("state model should parse");
    assert_eq!(
        model
            .device
            .state_machine
            .expect("state machine should exist")
            .initial_state,
        "resetting"
    );

    let unknown_initial = STATE_MODEL.replace("initial_state: resetting", "initial_state: missing");
    assert!(matches!(
        DeviceModel::from_yaml(&unknown_initial),
        Err(ModelError::StateMachine(
            vds_core::state_machine::StateMachineError::UnknownInitialState { .. }
        ))
    ));

    let unknown_target = STATE_MODEL.replacen("target: ready", "target: missing", 1);
    assert!(matches!(
        DeviceModel::from_yaml(&unknown_target),
        Err(ModelError::StateMachine(
            vds_core::state_machine::StateMachineError::UnknownTransitionTarget { .. }
        ))
    ));
}

#[test]
fn delayed_transition_and_state_actions_execute_at_exact_deadline() {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(STATE_MODEL)
        .expect("model should parse")
        .into_spi_device_with_clock(clock.clone())
        .expect("device should build");

    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("resetting")
    );
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x01]
    );

    clock
        .advance(Duration::from_millis(4))
        .expect("manual time should advance");
    assert!(
        device
            .run_due_events()
            .expect("events should run")
            .is_empty()
    );
    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("resetting")
    );

    clock
        .advance(Duration::from_millis(1))
        .expect("manual time should advance");
    let events = device.run_due_events().expect("events should run");
    assert!(matches!(
        events.as_slice(),
        [DeviceEvent::StateTransition {
            from_state,
            to_state,
            trigger,
            virtual_time_ns: 5_000_000,
            ..
        }] if from_state == "resetting" && to_state == "ready" && trigger == "reset_complete"
    ));
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x00]
    );

    assert_write_state_lifecycle(&device, &clock);
}

fn assert_write_state_lifecycle(device: &GenericSpiDevice, clock: &ManualClock) {
    let accepted = device
        .transfer(&[0x02, 0x01, 0x5a])
        .expect("write should start from ready");
    assert!(accepted.events.iter().any(|event| matches!(
        event,
        DeviceEvent::StateTransition {
            from_state,
            to_state,
            trigger,
            ..
        } if from_state == "ready" && to_state == "busy" && trigger == "write_started"
    )));
    assert_eq!(
        device
            .transfer(&[0x03, 0x01])
            .expect("control should read")
            .response,
        [0x34],
        "ready exit action should execute"
    );
    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("busy")
    );

    assert!(matches!(
        device.transfer(&[0x02, 0x01, 0x22]),
        Err(DeviceError::State(failure))
            if failure.code == StateErrorCode::CommandRejected && failure.state == "busy"
    ));

    clock
        .advance(Duration::from_millis(10))
        .expect("manual time should advance");
    let events = device.run_due_events().expect("events should run");
    assert!(events.iter().any(|event| matches!(
        event,
        DeviceEvent::StateTransition {
            from_state,
            to_state,
            trigger,
            virtual_time_ns: 15_000_000,
            ..
        } if from_state == "busy" && to_state == "ready" && trigger == "operation_completed"
    )));
    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("ready")
    );
    assert_eq!(
        device
            .transfer(&[0x03, 0x00])
            .expect("status should read")
            .response,
        [0x00],
        "busy exit action should execute"
    );
}

#[test]
fn state_machine_reset_cancels_operations_and_reenters_initial_state() {
    let clock = Arc::new(ManualClock::default());
    let device = DeviceModel::from_yaml(STATE_MODEL)
        .expect("model should parse")
        .into_spi_device_with_clock(clock.clone())
        .expect("device should build");
    clock
        .advance(Duration::from_millis(5))
        .expect("manual time should advance");
    device.run_due_events().expect("reset should complete");
    device
        .transfer(&[0x02, 0x01, 0x5a])
        .expect("write should start");

    let events = device.reset().expect("device reset should succeed");
    assert!(matches!(
        events.as_slice(),
        [DeviceEvent::StateTransition {
            from_state,
            to_state,
            trigger,
            ..
        }] if from_state == "busy" && to_state == "resetting" && trigger == "reset"
    ));
    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("resetting")
    );

    clock
        .advance(Duration::from_millis(5))
        .expect("manual time should advance");
    device.run_due_events().expect("reset should complete");
    assert_eq!(
        device
            .current_state()
            .expect("state should read")
            .as_deref(),
        Some("ready")
    );
    clock
        .advance(Duration::from_millis(5))
        .expect("manual time should advance");
    assert!(
        device
            .run_due_events()
            .expect("cancelled write must not complete")
            .is_empty()
    );
    assert_eq!(
        device
            .transfer(&[0x03, 0x01])
            .expect("control should read")
            .response,
        [0x12]
    );
}

fn fault_model(faults: &str) -> String {
    format!(
        r"schema_version: 1
device:
  id: spi-flash-0
  name: Fault Device
  bus: spi
  model: generic-spi-command
  commands:
    - {{ name: READ_ID, opcode: 0x9F, response: [0xEF, 0x40, 0x18] }}
    - {{ name: READ_REGISTER, opcode: 0x03, operation: register_read, address_bytes: 1 }}
    - {{ name: WRITE_REGISTER, opcode: 0x02, operation: register_write, address_bytes: 1 }}
  registers:
    - {{ name: CONTROL, address: 0x01, width_bits: 8, reset_value: 0x12, access: rw }}
  faults:
{faults}"
    )
}

#[test]
fn fault_yaml_rejects_duplicate_ids_and_unknown_actions() {
    let duplicate = fault_model(
        "    - { id: same, target: {}, trigger: always, action: { type: drop } }\n    - { id: same, target: {}, trigger: always, action: { type: drop } }",
    );
    assert!(matches!(
        DeviceModel::from_yaml(&duplicate),
        Err(ModelError::DuplicateFaultId { .. })
    ));
    let unknown =
        fault_model("    - { id: bad, target: {}, trigger: always, action: { type: explode } }");
    assert!(matches!(
        DeviceModel::from_yaml(&unknown),
        Err(ModelError::Validation(_))
    ));
}

#[test]
fn fault_actions_are_deterministic_and_structured() {
    let yaml = fault_model(
        "    - { id: corrupt, target: { command: READ_ID }, trigger: { every_nth: 2 }, action: { type: corrupt_response, xor_mask: 1 } }\n    - { id: force, target: { command: READ_REGISTER, register: CONTROL }, trigger: always, action: { type: force_register_value, value: 90 } }",
    );
    let device = DeviceModel::from_yaml(&yaml)
        .unwrap()
        .into_spi_device()
        .unwrap();
    assert_eq!(
        device.transfer(&[0x9f]).unwrap().response,
        [0xef, 0x40, 0x18]
    );
    let corrupted = device.transfer(&[0x9f]).unwrap();
    assert_eq!(corrupted.response, [0xee, 0x41, 0x19]);
    assert!(corrupted.events.iter().any(|event| matches!(event, DeviceEvent::FaultTriggered { fault_id, trigger_count: 2, .. } if fault_id == "corrupt")));
    assert_eq!(device.transfer(&[0x03, 0x01]).unwrap().response, [0x5a]);
}

#[test]
fn terminal_faults_return_structured_errors() {
    for (action, expected) in [
        (
            "{ type: timeout, duration_ms: 500 }",
            FaultErrorCode::Timeout,
        ),
        (
            "{ type: return_error, code: injected, message: failed }",
            FaultErrorCode::ReturnError,
        ),
        ("{ type: drop }", FaultErrorCode::Dropped),
    ] {
        let yaml = fault_model(&format!(
            "    - {{ id: terminal, target: {{ command: READ_ID }}, trigger: always, action: {action} }}"
        ));
        let device = DeviceModel::from_yaml(&yaml)
            .unwrap()
            .into_spi_device()
            .unwrap();
        assert!(
            matches!(device.transfer(&[0x9f]), Err(DeviceError::Fault(failure)) if failure.code == expected && failure.trigger_count == 1)
        );
    }
}

#[test]
fn delay_uses_virtual_scheduler_and_stuck_at_blocks_writes() {
    let clock = Arc::new(ManualClock::default());
    let yaml = fault_model(
        "    - { id: delay, target: { command: READ_ID }, trigger: { first_n: 1 }, action: { type: delay, duration_ms: 5 } }\n    - { id: stuck, target: { command: WRITE_REGISTER, register: CONTROL }, trigger: always, action: { type: stuck_at, value: 240, mask: 240 } }",
    );
    let device = DeviceModel::from_yaml(&yaml)
        .unwrap()
        .into_spi_device_with_clock(clock.clone())
        .unwrap();
    device.transfer(&[0x9f]).unwrap();
    clock.advance(Duration::from_millis(4)).unwrap();
    assert!(device.run_due_events().unwrap().is_empty());
    clock.advance(Duration::from_millis(1)).unwrap();
    assert!(matches!(
        device.run_due_events().unwrap().as_slice(),
        [DeviceEvent::FaultDelayCompleted {
            completed_at_ns: 5_000_000,
            ..
        }]
    ));
    device.transfer(&[0x02, 0x01, 0x05]).unwrap();
    assert_eq!(device.transfer(&[0x03, 0x01]).unwrap().response, [0xf5]);
}

#[test]
fn reset_clears_transient_counters_but_preserves_persistent_counters() {
    for persistent in [false, true] {
        let yaml = fault_model(&format!(
            "    - {{ id: counted, persistent: {persistent}, target: {{ command: READ_ID }}, trigger: {{ operation_count: 2 }}, action: {{ type: corrupt_response, xor_mask: 1 }} }}"
        ));
        let device = DeviceModel::from_yaml(&yaml)
            .unwrap()
            .into_spi_device()
            .unwrap();
        device.transfer(&[0x9f]).unwrap();
        device.reset().unwrap();
        let response = device.transfer(&[0x9f]).unwrap().response;
        assert_eq!(
            response,
            if persistent {
                vec![0xee, 0x41, 0x19]
            } else {
                vec![0xef, 0x40, 0x18]
            }
        );
    }
}
