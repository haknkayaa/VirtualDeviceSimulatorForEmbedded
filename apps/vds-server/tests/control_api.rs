use std::{fs, path::Path, sync::Arc, time::Duration};

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;
use vds_core::{clock::ManualClock, config::ServerConfig};
use vds_events::{EventBus, EventDraft, EventPayload, EventType};
use vds_server::{
    http::{
        AdapterDriver, AdapterError, AdapterManager, AdapterSnapshot, ApiState, DriverReadiness,
        router,
    },
    load_registry_with_clock,
};

struct FakeAdapterDriver;

impl AdapterDriver for FakeAdapterDriver {
    fn readiness(&self) -> DriverReadiness {
        DriverReadiness::Ready
    }

    fn load(&self, adapter: &AdapterSnapshot) -> Result<Vec<u32>, AdapterError> {
        Ok((2000_u32..)
            .zip(adapter.bindings.iter())
            .map(|(pid, _)| pid)
            .collect())
    }

    fn attach_endpoint(
        &self,
        _adapter: &AdapterSnapshot,
        _binding: &vds_server::http::AdapterBinding,
    ) -> Result<u32, AdapterError> {
        Ok(2999)
    }

    fn detach_endpoint(
        &self,
        adapter: &AdapterSnapshot,
        binding: &vds_server::http::AdapterBinding,
    ) -> Result<u32, AdapterError> {
        let position = adapter
            .bindings
            .iter()
            .position(|existing| existing.device_id == binding.device_id)
            .unwrap();
        Ok(adapter.daemon_pids[position])
    }

    fn unload(&self, _adapter: &AdapterSnapshot) -> Result<(), AdapterError> {
        Ok(())
    }
}

fn config() -> ServerConfig {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let package = root
        .join("device-models/examples/generic-spi-flash")
        .canonicalize()
        .unwrap();
    ServerConfig::from_yaml(&format!(
        r"
schema_version: 1
server: {{ control_address: '127.0.0.1:0' }}
data_plane: {{ unix_socket: /tmp/vds4e-control-test.sock }}
observability: {{ log_level: info }}
device_packages: ['{}']
",
        package.display()
    ))
    .unwrap()
}

fn copy_directory(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let destination = target.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

fn package_config(package: &Path) -> ServerConfig {
    ServerConfig::from_yaml(&format!(
        r"
schema_version: 1
server: {{ control_address: '127.0.0.1:0' }}
data_plane: {{ unix_socket: /tmp/vds4e-package-test.sock }}
observability: {{ log_level: info }}
device_packages: ['{}']
",
        package.display()
    ))
    .unwrap()
}

fn state() -> ApiState {
    let config = config();
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config, clock.clone()).unwrap();
    ApiState::new(
        config,
        Arc::new(registry),
        Arc::new(EventBus::default()),
        clock,
    )
    .unwrap()
}

fn state_with_fake_adapters() -> ApiState {
    let mut state = state();
    state.adapters = Arc::new(AdapterManager::new(Arc::new(FakeAdapterDriver)));
    state
}

async fn json_request(
    app: axum::Router,
    method: &str,
    uri: &str,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

#[tokio::test]
async fn reloads_a_complete_device_package_after_it_is_moved_out_and_back() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let source = root.join("device-models/examples/generic-spi-flash");
    let temporary_root =
        std::env::temp_dir().join(format!("vds4e-portable-package-{}", std::process::id()));
    let package = temporary_root.join("generic-spi-flash");
    let parked = temporary_root.join("package-outside-device-directory");
    if temporary_root.exists() {
        fs::remove_dir_all(&temporary_root).unwrap();
    }
    copy_directory(&source, &package);
    let config = package_config(&package);

    let initial = load_registry_with_clock(&config, Arc::new(ManualClock::default())).unwrap();
    assert_eq!(initial.snapshots().unwrap().len(), 1);

    fs::rename(&package, &parked).unwrap();
    assert!(
        load_registry_with_clock(&config, Arc::new(ManualClock::default())).is_err(),
        "a package that is physically absent must not remain partially loaded"
    );

    fs::rename(&parked, &package).unwrap();
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config, clock.clone()).unwrap();
    clock.advance(Duration::from_millis(5)).unwrap();
    registry
        .transfer("generic-spi-flash-128m", &[0x9F])
        .expect("transfer should drain the delayed state event and activate the signal graph");
    assert_eq!(
        registry
            .current_state("generic-spi-flash-128m")
            .unwrap()
            .as_deref(),
        Some("ready")
    );
    assert_eq!(
        fs::read_to_string(package.join("runtime-data/signal-output.txt")).unwrap(),
        "VDS4E generic SPI signal graph fixture.\n"
    );
    let state = ApiState::new(
        config,
        Arc::new(registry),
        Arc::new(EventBus::default()),
        clock,
    )
    .unwrap();
    assert_eq!(state.scenarios.len(), 10);
    let (status, flow) = json_request(
        router(state),
        "GET",
        "/api/v1/devices/generic-spi-flash-128m/flow",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(flow["flow"]["id"], "generic-spi-flash-128m-behavior");
    assert_eq!(
        flow["metadata"]["behavior"]["device_id"],
        "generic-spi-flash-128m"
    );

    fs::remove_dir_all(&temporary_root).unwrap();
}

async fn json_request_with_body(
    app: axum::Router,
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn register_write_endpoint_updates_runtime_state() {
    let app = router(state());
    let (_, registers) = json_request(
        app.clone(),
        "GET",
        "/api/v1/devices/generic-spi-flash-128m/registers",
    )
    .await;
    let writable = registers
        .as_array()
        .unwrap()
        .iter()
        .find(|register| register["access"] == "rw")
        .unwrap();
    let address = writable["address"].as_u64().unwrap();

    let (status, written) = json_request_with_body(
        app,
        "POST",
        &format!("/api/v1/devices/generic-spi-flash-128m/registers/{address}"),
        serde_json::json!({ "value": 0x5A }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(written["address"], address);
    assert_eq!(written["value"], 0x5A);
}

#[tokio::test]
async fn health_device_register_state_reset_and_fault_endpoints_work() {
    let app = router(state());
    let (status, health) = json_request(app.clone(), "GET", "/api/v1/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["status"], "ok");

    let (status, devices) = json_request(app.clone(), "GET", "/api/v1/devices").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(devices[0]["id"], "generic-spi-flash-128m");
    let (_, detail) =
        json_request(app.clone(), "GET", "/api/v1/devices/generic-spi-flash-128m").await;
    assert_eq!(detail["bus"], "spi");
    let (_, registers) = json_request(
        app.clone(),
        "GET",
        "/api/v1/devices/generic-spi-flash-128m/registers",
    )
    .await;
    assert!(
        registers
            .as_array()
            .unwrap()
            .iter()
            .any(|register| register["name"] == "STATUS1")
    );
    let (_, device_state) = json_request(
        app.clone(),
        "GET",
        "/api/v1/devices/generic-spi-flash-128m/state",
    )
    .await;
    assert_eq!(device_state["state"], "resetting");
    let (status, _) = json_request(
        app.clone(),
        "POST",
        "/api/v1/devices/generic-spi-flash-128m/reset",
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        app.clone(),
        "POST",
        "/api/v1/faults/page_program_timeout/enable",
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, faults) = json_request(app.clone(), "GET", "/api/v1/faults").await;
    assert!(
        faults
            .as_array()
            .unwrap()
            .iter()
            .any(|fault| fault["id"] == "page_program_timeout" && fault["enabled"] == true)
    );
    let (status, _) =
        json_request(app, "POST", "/api/v1/faults/page_program_timeout/disable").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn device_commands_are_listed_and_executed_through_control_api() {
    let app = router(state());
    let (_, devices) = json_request(app.clone(), "GET", "/api/v1/devices").await;
    let device_id = devices[0]["id"].as_str().unwrap();
    let (status, commands) = json_request(
        app.clone(),
        "GET",
        &format!("/api/v1/devices/{device_id}/commands"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        commands
            .as_array()
            .unwrap()
            .iter()
            .any(|command| command["name"] == "READ_ID")
    );

    let (status, result) = json_request_with_body(
        app,
        "POST",
        &format!("/api/v1/devices/{device_id}/commands/execute"),
        serde_json::json!({
            "tx": [159],
            "rx_length": 3,
            "wire": {
                "mode": 0,
                "bits_per_word": 8,
                "max_speed_hz": 1_000_000,
                "command_width": "single",
                "address_width": "single",
                "data_width": "single",
                "rate": "str",
                "dummy_cycles": 0,
                "lsb_first": false
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["rx"].as_array().unwrap().len(), 3);
    assert_eq!(result["rx"][1], 64);
    assert_eq!(result["rx"][2], 24);
    assert_eq!(result["state"], "resetting");
}

#[tokio::test]
async fn configured_model_creates_independent_runtime_device_instances() {
    let app = router(state());
    let (status, templates) = json_request(app.clone(), "GET", "/api/v1/device-models").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(templates.as_array().unwrap().len(), 1);
    assert_eq!(templates[0]["id"], "generic-spi-flash-128m");
    assert_eq!(templates[0]["bus"], "spi");

    let request = serde_json::json!({
        "template_id": "generic-spi-flash-128m",
        "device_id": "spi-flash-1"
    });
    let (status, created) =
        json_request_with_body(app.clone(), "POST", "/api/v1/devices", request.clone()).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["id"], "spi-flash-1");
    assert_eq!(created["bus"], "spi");

    let (_, devices) = json_request(app.clone(), "GET", "/api/v1/devices").await;
    assert_eq!(devices.as_array().unwrap().len(), 2);
    assert_eq!(devices[0]["id"], "generic-spi-flash-128m");
    assert_eq!(devices[1]["id"], "spi-flash-1");
    let (_, registers) =
        json_request(app.clone(), "GET", "/api/v1/devices/spi-flash-1/registers").await;
    assert!(!registers.as_array().unwrap().is_empty());

    let (status, duplicate) =
        json_request_with_body(app.clone(), "POST", "/api/v1/devices", request).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(duplicate["code"], "device_id_conflict");

    let (status, missing) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/devices",
        serde_json::json!({ "template_id": "missing", "device_id": "other-device" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["code"], "device_template_not_found");

    let (status, invalid) = json_request_with_body(
        app,
        "POST",
        "/api/v1/devices",
        serde_json::json!({ "template_id": "generic-spi-flash-128m", "device_id": "invalid id" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid["code"], "invalid_device_id");
}

#[tokio::test]
async fn adapter_api_manages_spi_bindings_and_lifecycle() {
    let app = router(state_with_fake_adapters());
    let (status, adapters) = json_request(app.clone(), "GET", "/api/v1/adapters").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(adapters[0]["id"], "spi0");
    assert_eq!(adapters[0]["readiness"], "ready");

    let (status, attached) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/adapters/spi0/bindings",
        serde_json::json!({ "device_id": "generic-spi-flash-128m", "endpoint": 0 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(attached["bindings"][0]["device_path"], "/dev/spidev0.0");

    let (status, duplicate) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/adapters/spi0/bindings",
        serde_json::json!({ "device_id": "generic-spi-flash-128m", "endpoint": 1 }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(duplicate["code"], "adapter_conflict");

    let (status, loaded) = json_request(app.clone(), "POST", "/api/v1/adapters/spi0/load").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(loaded["state"], "loaded");
    assert_eq!(loaded["daemon_pids"][0], 2000);

    let (status, conflict) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/adapters/spi0/bindings",
        serde_json::json!({ "device_id": "generic-spi-flash-128m", "endpoint": 1 }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(conflict["code"], "adapter_conflict");

    let (status, _) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/devices",
        serde_json::json!({ "template_id": "generic-spi-flash-128m", "device_id": "hot-device" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, hot_attached) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/adapters/spi0/bindings",
        serde_json::json!({ "device_id": "hot-device", "endpoint": 1 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hot_attached["state"], "loaded");
    assert_eq!(hot_attached["daemon_pids"][1], 2999);

    let (status, hot_detached) = json_request(
        app.clone(),
        "DELETE",
        "/api/v1/adapters/spi0/bindings/hot-device",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(hot_detached["state"], "loaded");
    assert_eq!(hot_detached["bindings"].as_array().unwrap().len(), 1);

    let (status, unloaded) =
        json_request(app.clone(), "POST", "/api/v1/adapters/spi0/unload").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unloaded["state"], "unloaded");

    let (status, detached) = json_request(
        app,
        "DELETE",
        "/api/v1/adapters/spi0/bindings/generic-spi-flash-128m",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(detached["bindings"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn bus_telemetry_is_derived_from_typed_transaction_events() {
    let state = state();
    let events = Arc::clone(&state.events);
    let _ = events.publish(EventDraft {
        virtual_time_ns: 1_000,
        device_id: Some("generic-spi-flash-128m".to_owned()),
        scenario_run_id: None,
        payload: EventPayload::TransactionStarted {
            transaction_id: Some(42),
            request: vec![0x9f, 0, 0, 0],
        },
    });
    let _ = events.publish(EventDraft {
        virtual_time_ns: 3_500,
        device_id: Some("generic-spi-flash-128m".to_owned()),
        scenario_run_id: None,
        payload: EventPayload::TransactionCompleted {
            transaction_id: Some(42),
            response: vec![0x00, 0x40, 0x18],
            result: "success".to_owned(),
            error_code: None,
        },
    });
    let _ = events.publish(EventDraft {
        virtual_time_ns: 4_000,
        device_id: Some("generic-spi-flash-128m".to_owned()),
        scenario_run_id: None,
        payload: EventPayload::TransactionStarted {
            transaction_id: Some(43),
            request: vec![0x05, 0],
        },
    });

    let app = router(state);
    let (status, telemetry) = json_request(app, "GET", "/api/v1/telemetry/buses").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(telemetry["window_seconds"], 60);
    let bus = &telemetry["buses"][0];
    assert_eq!(bus["device_id"], "generic-spi-flash-128m");
    assert_eq!(bus["bus_type"], "spi");
    assert_eq!(bus["health"], "healthy");
    assert_eq!(bus["transactions_total"], 1);
    assert_eq!(bus["in_flight"], 1);
    assert_eq!(bus["latency"]["virtual_avg_ns"], 2500.0);
    assert_eq!(bus["retries"]["count"], 0);
    assert!(bus["throughput"]["tx_bytes_per_second"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn scenario_run_is_asynchronous_and_result_is_retrievable() {
    let state = state();
    let events = Arc::clone(&state.events);
    let app = router(state);
    let (status, scenarios) = json_request(app.clone(), "GET", "/api/v1/scenarios").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        scenarios
            .as_array()
            .unwrap()
            .iter()
            .any(|scenario| scenario["id"] == "generic-flash-timeout-fault")
    );
    let (status, scenario) = json_request(
        app.clone(),
        "GET",
        "/api/v1/scenarios/generic-flash-timeout-fault",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(scenario["steps"].as_array().unwrap().len(), 6);
    let (status, started) = json_request(
        app.clone(),
        "POST",
        "/api/v1/scenarios/generic-flash-timeout-fault/run",
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let run_id = started["run_id"].as_str().unwrap().to_owned();
    assert!(matches!(
        started["status"].as_str(),
        Some("queued" | "running")
    ));

    for _ in 0..100 {
        let (_, run) = json_request(app.clone(), "GET", &format!("/api/v1/runs/{run_id}")).await;
        if run["status"] == "passed" {
            let (status, result) =
                json_request(app.clone(), "GET", &format!("/api/v1/runs/{run_id}/result")).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(result["status"], "passed");
            let event_types = events
                .events_after(0)
                .into_iter()
                .map(|event| event.event_type)
                .collect::<Vec<_>>();
            assert!(event_types.contains(&EventType::ScenarioStarted));
            assert!(event_types.contains(&EventType::ScenarioStepStarted));
            assert!(event_types.contains(&EventType::ScenarioStepCompleted));
            assert!(event_types.contains(&EventType::ScenarioCompleted));
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("scenario run did not complete");
}

#[tokio::test]
async fn compiled_visual_scenario_uses_the_existing_run_endpoint_and_executor() {
    let app = router(state());
    let definition = serde_json::json!({
        "schema_version": 1,
        "scenario": { "id": "visual_reset", "name": "Visual Reset", "timeout_ms": 1000 },
        "steps": [{ "id": "reset", "continue_on_failure": false, "action": "reset_device", "device": "generic-spi-flash-128m" }]
    });
    let (status, record) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/scenarios/visual_reset/run?revision=7",
        definition,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(record["scenario_id"], "visual_reset");
    assert!(record.get("scenario_revision").is_none());
    let run_id = record["run_id"].as_str().unwrap();
    for _ in 0..100 {
        let (_, run) = json_request(app.clone(), "GET", &format!("/api/v1/runs/{run_id}")).await;
        if run["status"] == "passed" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/runs/{run_id}/result/junit"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "application/xml; charset=utf-8"
    );
    assert_eq!(
        response.headers()["content-disposition"],
        format!("attachment; filename=\"visual_reset-{run_id}.junit.xml\"")
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let xml = String::from_utf8(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(xml.contains("<testsuite name=\"visual_reset\" tests=\"1\""));
    assert!(xml.contains("name=\"vds4e.run_id\""));
    assert!(xml.contains("name=\"vds4e.scenario_revision\" value=\"7\""));

    let mismatch = serde_json::json!({
        "schema_version": 1,
        "scenario": { "id": "other", "name": "Other", "timeout_ms": 1 },
        "steps": [{ "id": "reset", "action": "reset_device", "device": "generic-spi-flash-128m" }]
    });
    let (status, error) =
        json_request_with_body(app, "POST", "/api/v1/scenarios/not-other/run", mismatch).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["code"], "scenario_id_mismatch");
}

#[tokio::test]
async fn structured_errors_and_data_plane_separation_are_enforced() {
    let app = router(state());
    let (status, error) = json_request(app.clone(), "GET", "/api/v1/devices/missing").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["code"], "device_not_found");
    let (status, _) = json_request(app, "POST", "/api/v1/spi").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn websocket_delivers_ordered_replay_after_event_id() {
    let state = state();
    let first = state.events.publish(EventDraft {
        virtual_time_ns: 1,
        device_id: None,
        scenario_run_id: None,
        payload: EventPayload::DeviceReset {
            result: "first".into(),
        },
    });
    let second = state.events.publish(EventDraft {
        virtual_time_ns: 2,
        device_id: None,
        scenario_run_id: None,
        payload: EventPayload::DeviceReset {
            result: "second".into(),
        },
    });
    let events = Arc::clone(&state.events);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(format!(
        "ws://{address}/api/v1/events?after_event_id={}",
        first.event_id
    ))
    .await
    .unwrap();
    let message = socket.next().await.unwrap().unwrap();
    let Message::Text(text) = message else {
        panic!("expected text event");
    };
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event[0]["event_id"], second.event_id);
    let third = events.publish(EventDraft {
        virtual_time_ns: 3,
        device_id: None,
        scenario_run_id: None,
        payload: EventPayload::DeviceReset {
            result: "third".into(),
        },
    });
    let Message::Text(text) = socket.next().await.unwrap().unwrap() else {
        panic!("expected text event");
    };
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event[0]["event_id"], third.event_id);
    server.abort();
}
