//! Scenario coverage against the Micron MT25QL256 reference model (ADR 0013).

use std::sync::Arc;

use vds_core::{clock::ManualClock, registry::DeviceRegistry};
use vds_device_model::DeviceModel;
use vds_scenario::{
    CoverageMetric, CoverageTargets, DeviceCoverage, JUnitReportMetadata, RegistryRuntime,
    ResultStatus, ScenarioDocument, ScenarioExecutor, to_junit_xml,
};

const DEVICE: &str = "micron-mt25ql256aba8esf-0sit";
const MODEL: &str =
    include_str!("../../../device-models/examples/micron-mt25ql256aba8esf-0sit/model/device.yaml");
const DEEP_POWER_DOWN: &str = include_str!(
    "../../../device-models/examples/micron-mt25ql256aba8esf-0sit/scenarios/04-deep-power-down.yaml"
);

fn run(scenario: &str, coverage: bool) -> vds_scenario::ScenarioResult {
    let clock = Arc::new(ManualClock::default());
    let model = DeviceModel::from_yaml(MODEL).unwrap();
    let targets = Arc::new(CoverageTargets::from_models([&model]));
    let registry = DeviceRegistry::new();
    registry
        .register(Arc::new(
            model.into_spi_device_with_clock(clock.clone()).unwrap(),
        ))
        .unwrap();
    let executor = ScenarioExecutor::new(RegistryRuntime::new(Arc::new(registry), clock));
    let mut executor = if coverage {
        executor.with_coverage(targets)
    } else {
        executor
    };
    executor.run(&ScenarioDocument::from_yaml(scenario).unwrap())
}

fn device(result: &vds_scenario::ScenarioResult) -> &DeviceCoverage {
    let coverage = result.coverage.as_ref().expect("coverage requested");
    assert_eq!(coverage.devices.len(), 1);
    &coverage.devices[0]
}

fn covered(metric: &CoverageMetric, item: &str) -> bool {
    !metric.missed.iter().any(|missed| missed == item)
}

#[test]
fn deep_power_down_scenario_reports_what_it_exercised() {
    let result = run(DEEP_POWER_DOWN, true);
    assert_eq!(result.status, ResultStatus::Passed, "{result:#?}");
    let device = device(&result);
    assert_eq!(device.device_id, DEVICE);

    // ENTER (B9), the rejected READ_ID (9F) and RELEASE (AB) were sent.
    assert_eq!(device.commands.covered, 3, "{:?}", device.commands);
    for command in [
        "READ_ID",
        "ENTER_DEEP_POWER_DOWN",
        "RELEASE_FROM_DEEP_POWER_DOWN",
    ] {
        assert!(covered(&device.commands, command), "{command}");
    }
    assert!(
        device
            .commands
            .missed
            .contains(&"PAGE_PROGRAM_4_BYTE".to_owned())
    );
    assert_eq!(
        device.commands.covered + device.commands.missed.len(),
        device.commands.total
    );

    for state in ["resetting", "ready", "deep_power_down"] {
        assert!(covered(&device.states, state), "{state}");
    }
    assert!(!covered(&device.states, "programming"));
    assert_eq!(device.states.total, 8);

    for transition in [
        "resetting -> ready",
        "ready -> deep_power_down",
        "deep_power_down -> ready",
    ] {
        assert!(covered(&device.transitions, transition), "{transition}");
    }
    assert_eq!(device.transitions.covered, 3, "{:?}", device.transitions);
    assert_eq!(device.faults.covered, 0);
    assert_eq!(device.faults.total, 5);
}

#[test]
fn fault_triggers_and_register_traces_count_only_through_device_paths() {
    let result = run(
        &format!(
            r#"
schema_version: 1
scenario: {{ id: coverage-faults, name: Stuck WIP, timeout_ms: 20 }}
steps:
  - {{ id: settle, action: advance_time, duration_ms: 1 }}
  - {{ id: inspect, action: assert_register, device: {DEVICE}, register: FLAG_STATUS_REGISTER, expected: 0x80 }}
  - {{ id: stuck, action: enable_fault, fault: mt25ql_status_wip_stuck }}
  - {{ id: status, action: send_spi, device: {DEVICE}, tx: "05 00", save_as: status }}
"#
        ),
        true,
    );
    assert_eq!(result.status, ResultStatus::Passed, "{result:#?}");
    let device = device(&result);
    assert!(covered(&device.faults, "mt25ql_status_wip_stuck"));
    assert_eq!(device.faults.covered, 1);
    assert!(covered(&device.registers, "STATUS_REGISTER"));
    assert!(
        !covered(&device.registers, "FLAG_STATUS_REGISTER"),
        "an assert_register inspection read is not coverage"
    );

    let xml = to_junit_xml(
        &result,
        JUnitReportMetadata {
            run_id: "run-1",
            scenario_revision: 1,
        },
    );
    assert!(xml.contains(&format!(
        "<property name=\"vds4e.coverage.{DEVICE}.faults\" value=\"1/5\"/>"
    )));
}

#[test]
fn results_without_targets_keep_their_shape() {
    let result = run(DEEP_POWER_DOWN, false);
    assert!(result.coverage.is_none());
    assert!(!result.to_json_pretty().unwrap().contains("coverage"));
}
