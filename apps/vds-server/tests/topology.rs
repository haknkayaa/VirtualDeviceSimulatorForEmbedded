//! End-to-end cross-device signal flow: sensor DRDY -> GPIO line -> read-clear.

use std::{fs, path::Path, sync::Arc, time::Duration};

use vds_core::{clock::ManualClock, config::ServerConfig, device::SpiWireConfig};
use vds_server::load_registry_with_clock;

const SENSOR: &str = "spi-sensor-drdy";
const BANK: &str = "generic-gpio-bank-32";

fn config(topology: &Path) -> ServerConfig {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let package = |name: &str| {
        root.join("device-models/examples")
            .join(name)
            .canonicalize()
            .unwrap()
    };
    ServerConfig::from_yaml(&format!(
        r"
schema_version: 1
server: {{ control_address: '127.0.0.1:0' }}
data_plane: {{ unix_socket: /tmp/vds4e-topology-test.sock }}
observability: {{ log_level: info }}
topology: '{}'
device_packages: ['{}', '{}']
",
        topology.display(),
        package(SENSOR).display(),
        package("generic-gpio-bank").display(),
    ))
    .unwrap()
}

fn write_topology(label: &str, connections: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "vds4e-topology-{label}-{}.yaml",
        std::process::id()
    ));
    fs::write(
        &path,
        format!("schema_version: 1\nconnections:\n{connections}"),
    )
    .unwrap();
    path
}

fn line(registry: &vds_core::registry::DeviceRegistry, register: &str) -> u64 {
    registry.read_register(BANK, register).unwrap()
}

#[test]
fn drdy_edge_reaches_the_gpio_line_and_read_clears() {
    let path = write_topology(
        "flow",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO16 }}\n"),
    );
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config(&path), clock.clone()).unwrap();
    let spi = |tx: &[u8]| {
        registry
            .transfer_spi(SENSOR, tx, 0, SpiWireConfig::default())
            .unwrap()
    };

    assert_eq!(line(&registry, "GPIO16_STATE"), 0);
    spi(&[0x10]); // START_CONVERSION
    assert_eq!(
        line(&registry, "GPIO16_STATE"),
        0,
        "no edge before the conversion ends"
    );

    clock.advance(Duration::from_micros(999)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(line(&registry, "GPIO16_STATE"), 0);

    clock.advance(Duration::from_micros(1)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(
        line(&registry, "GPIO16_STATE"),
        1,
        "DRDY asserted at the completion time"
    );
    let gpio = registry.exchange_gpio(BANK, &[false; 32]).unwrap();
    assert!(gpio[16], "the host-visible line level follows the sensor");

    let sample = spi(&[0x20]); // READ_SAMPLE
    assert_eq!(sample.response, [0x80, 0x00, 0x12, 0x34]);
    assert_eq!(
        line(&registry, "GPIO16_STATE"),
        0,
        "reading the sample clears DRDY"
    );
    assert!(!registry.exchange_gpio(BANK, &[false; 32]).unwrap()[16]);

    spi(&[0x10]);
    clock.advance(Duration::from_millis(1)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(
        line(&registry, "GPIO16_STATE"),
        1,
        "a new conversion raises a new edge"
    );
    let _ = fs::remove_file(path);
}

#[test]
fn delayed_connection_asserts_after_the_configured_virtual_delay() {
    let path = write_topology(
        "delay",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO17, delay_ns: 500000 }}\n"),
    );
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config(&path), clock.clone()).unwrap();
    registry
        .transfer_spi(SENSOR, &[0x10], 0, SpiWireConfig::default())
        .unwrap();
    clock.advance(Duration::from_millis(1)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(
        line(&registry, "GPIO17_STATE"),
        0,
        "still inside the wire delay"
    );
    assert_eq!(registry.next_event_deadline_ns().unwrap(), Some(1_500_000));
    clock.advance(Duration::from_micros(499)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(line(&registry, "GPIO17_STATE"), 0);
    clock.advance(Duration::from_micros(1)).unwrap();
    registry.run_due_events().unwrap();
    assert_eq!(line(&registry, "GPIO17_STATE"), 1);
    let _ = fs::remove_file(path);
}

#[test]
fn invalid_topologies_fail_registry_loading() {
    for (label, connections) in [
        (
            "host-driven",
            format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO0 }}\n"),
        ),
        (
            "unknown-signal",
            format!("  - {{ from: {SENSOR}.missing, to: {BANK}.GPIO16 }}\n"),
        ),
        (
            "unknown-device",
            format!("  - {{ from: ghost0.drdy, to: {BANK}.GPIO16 }}\n"),
        ),
    ] {
        let path = write_topology(label, &connections);
        let clock = Arc::new(ManualClock::default());
        assert!(
            load_registry_with_clock(&config(&path), clock).is_err(),
            "{label} must be rejected"
        );
        let _ = fs::remove_file(path);
    }
}

#[test]
fn scenario_asserts_the_edge_and_the_subsequent_read() {
    use vds_scenario::{RegistryRuntime, ResultStatus, ScenarioDocument, ScenarioExecutor};

    let path = write_topology(
        "scenario",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO16 }}\n"),
    );
    let clock = Arc::new(ManualClock::default());
    let registry = Arc::new(load_registry_with_clock(&config(&path), clock.clone()).unwrap());
    let scenario = ScenarioDocument::from_yaml(&format!(
        r#"
schema_version: 1
scenario: {{ id: drdy-flow, name: DRDY edge then sample read, timeout_ms: 10 }}
steps:
  - {{ id: idle_low, action: assert_register, device: {BANK}, register: GPIO16_STATE, expected: 0 }}
  - {{ id: start, action: send_spi, device: {SENSOR}, tx: "10", save_as: started }}
  - {{ id: wait, action: advance_time, duration_ms: 1 }}
  - {{ id: edge, action: assert_register, device: {BANK}, register: GPIO16_STATE, expected: 1 }}
  - {{ id: read, action: send_spi, device: {SENSOR}, tx: "20", save_as: sample }}
  - {{ id: data, action: assert_response, source: sample, expected: "80 00 12 34" }}
  - {{ id: cleared, action: assert_register, device: {BANK}, register: GPIO16_STATE, expected: 0 }}
"#
    ))
    .unwrap();
    let result = ScenarioExecutor::new(RegistryRuntime::new(registry, clock)).run(&scenario);
    assert_eq!(result.status, ResultStatus::Passed, "{result:#?}");
    let _ = fs::remove_file(path);
}
