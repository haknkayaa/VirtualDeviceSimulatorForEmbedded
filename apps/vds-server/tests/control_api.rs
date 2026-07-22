use std::{path::Path, sync::Arc};

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
    http::{ApiState, router},
    load_registry_with_clock,
};

fn config() -> ServerConfig {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let model = root
        .join("device-models/examples/spi-flash.yaml")
        .canonicalize()
        .unwrap();
    let scenario = root
        .join("scenarios/examples/delayed-write-with-timeout.yaml")
        .canonicalize()
        .unwrap();
    ServerConfig::from_yaml(&format!(
        r"
schema_version: 1
server: {{ control_address: '127.0.0.1:0' }}
data_plane: {{ unix_socket: /tmp/vds4e-control-test.sock }}
observability: {{ log_level: info }}
device_models: ['{}']
scenarios: ['{}']
",
        model.display(),
        scenario.display()
    ))
    .unwrap()
}

fn state() -> ApiState {
    let config = config();
    let clock = Arc::new(ManualClock::default());
    let registry = load_registry_with_clock(&config, clock).unwrap();
    ApiState::new(config, Arc::new(registry), Arc::new(EventBus::default())).unwrap()
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
async fn health_device_register_state_reset_and_fault_endpoints_work() {
    let app = router(state());
    let (status, health) = json_request(app.clone(), "GET", "/api/v1/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["status"], "ok");

    let (status, devices) = json_request(app.clone(), "GET", "/api/v1/devices").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(devices[0]["id"], "spi-flash-0");
    let (_, detail) = json_request(app.clone(), "GET", "/api/v1/devices/spi-flash-0").await;
    assert_eq!(detail["bus"], "spi");
    let (_, registers) =
        json_request(app.clone(), "GET", "/api/v1/devices/spi-flash-0/registers").await;
    assert!(
        registers
            .as_array()
            .unwrap()
            .iter()
            .any(|register| register["name"] == "CONTROL")
    );
    let (_, device_state) =
        json_request(app.clone(), "GET", "/api/v1/devices/spi-flash-0/state").await;
    assert_eq!(device_state["state"], "resetting");
    let (status, _) = json_request(app.clone(), "POST", "/api/v1/devices/spi-flash-0/reset").await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) =
        json_request(app.clone(), "POST", "/api/v1/faults/read_id_timeout/enable").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, faults) = json_request(app.clone(), "GET", "/api/v1/faults").await;
    assert_eq!(faults[0]["enabled"], true);
    let (status, _) = json_request(app, "POST", "/api/v1/faults/read_id_timeout/disable").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn scenario_run_is_asynchronous_and_result_is_retrievable() {
    let state = state();
    let events = Arc::clone(&state.events);
    let app = router(state);
    let (status, scenarios) = json_request(app.clone(), "GET", "/api/v1/scenarios").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(scenarios[0]["id"], "delayed_write_with_timeout");
    let (status, scenario) = json_request(
        app.clone(),
        "GET",
        "/api/v1/scenarios/delayed_write_with_timeout",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(scenario["steps"].as_array().unwrap().len(), 7);
    let (status, started) = json_request(
        app.clone(),
        "POST",
        "/api/v1/scenarios/delayed_write_with_timeout/run",
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
        "steps": [{ "id": "reset", "continue_on_failure": false, "action": "reset_device", "device": "spi-flash-0" }]
    });
    let (status, record) = json_request_with_body(
        app.clone(),
        "POST",
        "/api/v1/scenarios/visual_reset/run",
        definition,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(record["scenario_id"], "visual_reset");

    let mismatch = serde_json::json!({
        "schema_version": 1,
        "scenario": { "id": "other", "name": "Other", "timeout_ms": 1 },
        "steps": [{ "id": "reset", "action": "reset_device", "device": "spi-flash-0" }]
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
    assert_eq!(event["event_id"], second.event_id);
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
    assert_eq!(event["event_id"], third.event_id);
    server.abort();
}
