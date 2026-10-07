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

#[test]
fn signal_changes_are_published_as_domain_events() {
    use vds_events::{EventBus, EventPayload, EventType};

    let path = write_topology(
        "events",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO16 }}\n"),
    );
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config(&path), clock.clone()).unwrap();
    let events = Arc::new(EventBus::new(64, 64));
    vds_server::publish_signal_events(&registry, Arc::clone(&events), None);

    registry
        .transfer_spi(SENSOR, &[0x10], 0, SpiWireConfig::default())
        .unwrap();
    clock.advance(Duration::from_millis(1)).unwrap();
    registry.run_due_events().unwrap();
    registry
        .transfer_spi(SENSOR, &[0x20], 0, SpiWireConfig::default())
        .unwrap();

    let steps = events
        .events_after(0)
        .into_iter()
        .filter(|event| event.event_type == EventType::SignalChanged)
        .map(|event| {
            let EventPayload::SignalChanged {
                phase,
                source,
                target,
                value,
                delay_ns,
            } = &event.payload
            else {
                unreachable!("filtered by event type");
            };
            (
                phase.clone(),
                event.device_id.clone().unwrap(),
                source.clone(),
                target.clone(),
                *value,
                *delay_ns,
                event.timestamp_virtual_ns,
            )
        })
        .collect::<Vec<_>>();
    let source = format!("{SENSOR}.drdy");
    let target = format!("{BANK}.GPIO16");
    let expect = |phase: &str, device: &str, value: bool, time: u64| {
        (
            phase.to_owned(),
            device.to_owned(),
            source.clone(),
            target.clone(),
            value,
            0,
            time,
        )
    };
    assert_eq!(
        steps,
        [
            expect("emitted", SENSOR, true, 1_000_000),
            expect("delivered", BANK, true, 1_000_000),
            expect("emitted", SENSOR, false, 1_000_000),
            expect("delivered", BANK, false, 1_000_000),
        ]
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn pump_applies_a_real_time_deadline_without_further_traffic() {
    use vds_core::clock::{RealTimeClock, SimulatorClock};

    let path = write_topology(
        "pump",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO16 }}\n"),
    );
    let clock: Arc<dyn SimulatorClock> = Arc::new(RealTimeClock::new());
    let registry = Arc::new(load_registry_with_clock(&config(&path), Arc::clone(&clock)).unwrap());
    let pump = vds_server::spawn_signal_pump(Arc::clone(&registry), Arc::clone(&clock));

    // START begins a 1 ms conversion. No other bus access follows, so only the
    // pump can apply the timer and raise DRDY.
    let started = std::time::Instant::now();
    registry
        .transfer_spi(SENSOR, &[0x10], 0, SpiWireConfig::default())
        .unwrap();
    let mut raised = None;
    while started.elapsed() < Duration::from_secs(2) {
        if line(&registry, "GPIO16_STATE") == 1 {
            raised = Some(started.elapsed());
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    pump.abort();
    let raised = raised.expect("DRDY must rise without another bus transaction");
    assert!(
        raised >= Duration::from_millis(1),
        "the 1 ms conversion cannot finish early: {raised:?}"
    );
    assert!(
        raised < Duration::from_millis(250),
        "the pump should apply the deadline promptly: {raised:?}"
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn signal_events_reach_websocket_clients() {
    use futures_util::StreamExt;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message;
    use vds_events::EventBus;
    use vds_server::http::{ApiState, router};

    let path = write_topology(
        "ws",
        &format!("  - {{ from: {SENSOR}.drdy, to: {BANK}.GPIO16 }}\n"),
    );
    let clock = Arc::new(ManualClock::default());
    let config = config(&path);
    let registry = Arc::new(load_registry_with_clock(&config, clock.clone()).unwrap());
    let events = Arc::new(EventBus::default());
    vds_server::publish_signal_events(&registry, Arc::clone(&events), None);
    let state = ApiState::new(config, Arc::clone(&registry), events, clock.clone()).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}/api/v1/events"))
        .await
        .unwrap();

    registry
        .transfer_spi(SENSOR, &[0x10], 0, SpiWireConfig::default())
        .unwrap();
    clock.advance(Duration::from_millis(1)).unwrap();
    registry.run_due_events().unwrap();

    let mut payloads = Vec::new();
    while payloads.len() < 2 {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("signal events must arrive")
            .unwrap()
            .unwrap();
        let Message::Text(text) = message else {
            continue;
        };
        let batch: serde_json::Value = serde_json::from_str(&text).unwrap();
        for event in batch.as_array().unwrap() {
            if event["event_type"] == "signal_changed" {
                payloads.push(event.clone());
            }
        }
    }
    server.abort();
    assert_eq!(payloads[0]["device_id"], SENSOR);
    assert_eq!(payloads[0]["payload"]["phase"], "emitted");
    assert_eq!(payloads[0]["payload"]["source"], format!("{SENSOR}.drdy"));
    assert_eq!(payloads[1]["device_id"], BANK);
    assert_eq!(payloads[1]["payload"]["phase"], "delivered");
    assert_eq!(payloads[1]["payload"]["target"], format!("{BANK}.GPIO16"));
    assert_eq!(payloads[1]["payload"]["value"], true);
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn idle_pump_wakes_only_for_the_safety_backstop() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use vds_core::{
        clock::{RealTimeClock, SimulatorClock},
        device::{BusType, Device, DeviceError, DeviceTransfer},
        event::DeviceEvent,
        registry::DeviceRegistry,
    };

    /// Counts how often the pump asks the registry to apply due events.
    struct Probe(Arc<AtomicUsize>, &'static str);
    impl Device for Probe {
        fn id(&self) -> &str {
            self.1
        }
        fn bus_type(&self) -> BusType {
            BusType::Spi
        }
        fn transfer(&self, _request: &[u8]) -> Result<DeviceTransfer, DeviceError> {
            Ok(DeviceTransfer::response(Vec::new()))
        }
        fn transfer_spi(
            &self,
            _request: &[u8],
            _rx_length: usize,
            _wire: SpiWireConfig,
        ) -> Result<DeviceTransfer, DeviceError> {
            Ok(DeviceTransfer::response(Vec::new()))
        }
        fn run_due_events(&self) -> Result<Vec<DeviceEvent>, DeviceError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        }
    }

    let passes = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(DeviceRegistry::new());
    registry
        .register(Arc::new(Probe(Arc::clone(&passes), "probe")))
        .unwrap();
    let clock: Arc<dyn SimulatorClock> = Arc::new(RealTimeClock::new());
    let pump = vds_server::spawn_signal_pump(Arc::clone(&registry), clock);

    tokio::time::sleep(Duration::from_millis(500)).await;
    let idle = passes.load(Ordering::SeqCst);
    // A fixed 2 ms tick would run about 250 passes; the 50 ms backstop runs about 10.
    assert!(idle <= 20, "idle pump ran {idle} passes in 500 ms");

    // A transaction wakes it immediately.
    registry
        .transfer_spi("probe", &[0], 0, SpiWireConfig::default())
        .unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        passes.load(Ordering::SeqCst) > idle,
        "a transaction must wake the pump"
    );
    pump.abort();
}
