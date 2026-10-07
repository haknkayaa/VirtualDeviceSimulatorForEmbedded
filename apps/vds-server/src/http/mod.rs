//! HTTP control-plane state, routing, and shared API responses.

mod adapters;
mod host_telemetry;
mod runs;
mod telemetry;

mod packages;
use packages::{
    IMPORT_BODY_LIMIT_BYTES, device_package_image, device_packages, import_device_package,
};
mod adapter_routes;
use adapter_routes::{
    adapters, attach_adapter_device, create_adapter, detach_adapter_device, load_adapter,
    unload_adapter,
};
mod devices;
use devices::{
    create_device, device, device_commands, device_flow, device_state, device_templates, devices,
    registers, reset_device, write_register,
};
mod scenarios;
use scenarios::{cancel_run, run, run_result, run_result_junit, run_scenario, scenario, scenarios};
mod faults;
use faults::{disable_fault, enable_fault, faults};
mod events;
use events::events;

use std::{
    collections::HashMap,
    fs,
    path::{Component, PathBuf},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use vds_core::{
    clock::SimulatorClock,
    config::ServerConfig,
    device::Device,
    device_package::{DevicePackage, install_device_package, installed_device_packages},
    registry::{DeviceRegistry, DeviceSnapshot},
};
use vds_device_model::DeviceModel;
use vds_events::{EventBus, EventDraft, EventPayload};
use vds_scenario::{JUnitReportMetadata, ScenarioDocument, ScenarioResult, to_junit_xml};

pub use adapters::{
    AdapterBinding, AdapterDriver, AdapterError, AdapterManager, AdapterSnapshot, AdapterState,
    DriverReadiness,
};
pub use runs::{RunManager, RunRecord, RunStatus};

#[derive(Clone)]
pub struct ApiState {
    pub registry: Arc<DeviceRegistry>,
    pub events: Arc<EventBus>,
    pub scenarios: Arc<HashMap<String, ScenarioDocument>>,
    pub runs: Arc<RunManager>,
    pub adapters: Arc<AdapterManager>,
    pub config: ServerConfig,
    device_templates: Arc<HashMap<String, DeviceModel>>,
    device_template_images: Arc<HashMap<String, String>>,
    device_flows: Arc<HashMap<String, serde_json::Value>>,
    device_template_instances: Arc<RwLock<HashMap<String, String>>>,
    clock: Arc<dyn SimulatorClock>,
    host_telemetry: Arc<std::sync::Mutex<host_telemetry::HostTelemetrySampler>>,
}

impl ApiState {
    pub(crate) fn new_persistent(
        config: ServerConfig,
        registry: Arc<DeviceRegistry>,
        events: Arc<EventBus>,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<Self, String> {
        let mut state = Self::new(config, registry, events, clock)?;
        state.adapters = Arc::new(
            AdapterManager::system(&state.config)
                .map_err(|error| format!("adapter state: {error}"))?,
        );
        Ok(state)
    }

    /// Creates API state and loads configured scenario documents.
    ///
    /// # Errors
    /// Returns an error when a scenario file cannot be read or parsed.
    pub fn new(
        config: ServerConfig,
        registry: Arc<DeviceRegistry>,
        events: Arc<EventBus>,
        clock: Arc<dyn SimulatorClock>,
    ) -> Result<Self, String> {
        let mut scenarios = HashMap::new();
        for path in config
            .resolved_scenarios()
            .map_err(|error| error.to_string())?
        {
            let yaml = fs::read_to_string(&path).map_err(|error| {
                format!("failed to read scenario '{}': {error}", path.display())
            })?;
            let scenario = ScenarioDocument::from_yaml(&yaml)
                .map_err(|error| format!("invalid scenario '{}': {error}", path.display()))?;
            let id = scenario.scenario.id.clone();
            if scenarios.insert(id.clone(), scenario).is_some() {
                return Err(format!("duplicate scenario id '{id}'"));
            }
        }
        let mut device_templates = HashMap::new();
        let mut device_template_images = HashMap::new();
        let mut device_template_instances = HashMap::new();
        let mut device_flows = HashMap::new();
        for package in config
            .resolved_device_packages()
            .map_err(|error| error.to_string())?
        {
            let model_path = package.model_path();
            let model = crate::load_package_runtime_model(&package).map_err(|error| {
                format!(
                    "invalid device package runtime '{}': {error}",
                    model_path.display()
                )
            })?;
            crate::validate_device_package_model(&package, &model)?;
            let template_id = model.device.id.clone();
            if packages::package_image(&package).is_some() {
                let package_id = &package.manifest().metadata.id;
                device_template_images.insert(
                    template_id.clone(),
                    format!("/api/v1/device-packages/{package_id}/image"),
                );
            }
            device_templates
                .entry(template_id.clone())
                .or_insert_with(|| model.clone());
            device_template_instances
                .entry(template_id.clone())
                .or_insert(template_id);
            let Some(flow_path) = package.behavior_flow_path() else {
                continue;
            };
            let yaml = fs::read_to_string(&flow_path).map_err(|error| {
                format!("failed to read flow '{}': {error}", flow_path.display())
            })?;
            let yaml_value: serde_yaml::Value = serde_yaml::from_str(&yaml)
                .map_err(|error| format!("invalid flow '{}': {error}", flow_path.display()))?;
            let flow = serde_json::to_value(yaml_value)
                .map_err(|error| format!("invalid flow '{}': {error}", flow_path.display()))?;
            device_flows.insert(model.device.id, flow);
        }
        Ok(Self {
            registry,
            events,
            scenarios: Arc::new(scenarios),
            runs: Arc::new(RunManager::default()),
            adapters: Arc::new(AdapterManager::system_ephemeral(&config)),
            config,
            device_templates: Arc::new(device_templates),
            device_template_images: Arc::new(device_template_images),
            device_flows: Arc::new(device_flows),
            device_template_instances: Arc::new(RwLock::new(device_template_instances)),
            clock,
            host_telemetry: Arc::new(std::sync::Mutex::new(
                host_telemetry::HostTelemetrySampler::new(),
            )),
        })
    }
}

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/clock", get(clock))
        .route("/api/v1/devices", get(devices).post(create_device))
        .route("/api/v1/device-models", get(device_templates))
        .route("/api/v1/device-packages", get(device_packages))
        .route(
            "/api/v1/device-packages/{id}/image",
            get(device_package_image),
        )
        .route(
            "/api/v1/device-packages/import",
            post(import_device_package).layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT_BYTES)),
        )
        .route("/api/v1/adapters", get(adapters).post(create_adapter))
        .route("/api/v1/adapters/{id}/load", post(load_adapter))
        .route("/api/v1/adapters/{id}/unload", post(unload_adapter))
        .route(
            "/api/v1/adapters/{id}/bindings",
            post(attach_adapter_device),
        )
        .route(
            "/api/v1/adapters/{id}/bindings/{device_id}",
            delete(detach_adapter_device),
        )
        .route("/api/v1/devices/{id}", get(device))
        .route("/api/v1/devices/{id}/commands", get(device_commands))
        .route("/api/v1/devices/{id}/flow", get(device_flow))
        .route("/api/v1/devices/{id}/registers", get(registers))
        .route(
            "/api/v1/devices/{id}/registers/{address}",
            post(write_register),
        )
        .route("/api/v1/devices/{id}/state", get(device_state))
        .route("/api/v1/devices/{id}/reset", post(reset_device))
        .route("/api/v1/scenarios", get(scenarios))
        .route("/api/v1/scenarios/{id}", get(scenario))
        .route("/api/v1/scenarios/{id}/run", post(run_scenario))
        .route("/api/v1/runs/{run_id}", get(run))
        .route("/api/v1/runs/{run_id}/cancel", post(cancel_run))
        .route("/api/v1/runs/{run_id}/result", get(run_result))
        .route("/api/v1/runs/{run_id}/result/junit", get(run_result_junit))
        .route("/api/v1/faults", get(faults))
        .route("/api/v1/faults/{id}/enable", post(enable_fault))
        .route("/api/v1/faults/{id}/disable", post(disable_fault))
        .route("/api/v1/telemetry/buses", get(telemetry::bus_telemetry))
        .route("/api/v1/events", get(events))
        .with_state(state)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    system: host_telemetry::SystemMetrics,
}
async fn health(State(state): State<ApiState>) -> Json<Health> {
    let system = state
        .host_telemetry
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .sample();
    Json(Health {
        status: "ok",
        system,
    })
}

#[derive(Serialize)]
struct ClockSnapshot {
    virtual_time_ns: u64,
}

async fn clock(State(state): State<ApiState>) -> Json<ClockSnapshot> {
    Json(ClockSnapshot {
        virtual_time_ns: state.clock.now_ns(),
    })
}

type ApiResult<T> = Result<T, ApiError>;
#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}
impl ApiError {
    fn bad_request(code: &'static str, message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message,
        }
    }
    fn not_found(code: &'static str, message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code,
            message,
        }
    }
    fn conflict(code: &'static str, message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code,
            message,
        }
    }
    fn internal(code: &'static str, message: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code,
            message,
        }
    }
    fn adapter(error: AdapterError) -> Self {
        let (status, code, message) = match error {
            AdapterError::NotFound(message) => {
                (StatusCode::NOT_FOUND, "adapter_not_found", message)
            }
            AdapterError::Duplicate(message) => {
                (StatusCode::CONFLICT, "adapter_id_conflict", message)
            }
            AdapterError::Invalid(message) => (StatusCode::BAD_REQUEST, "adapter_invalid", message),
            AdapterError::Conflict(message) => (StatusCode::CONFLICT, "adapter_conflict", message),
            AdapterError::AuthorizationRequired(message) => (
                StatusCode::FORBIDDEN,
                "adapter_authorization_required",
                message,
            ),
            AdapterError::DriverUnavailable(message) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "adapter_driver_unavailable",
                message,
            ),
            AdapterError::Process(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "adapter_process_failed",
                message,
            ),
            AdapterError::Persistence(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "adapter_persistence_failed",
                message,
            ),
        };
        Self {
            status,
            code,
            message,
        }
    }
    fn device(error: vds_core::device::DeviceError) -> Self {
        let status = if matches!(error, vds_core::device::DeviceError::NotFound(_)) {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        let code = error.code();
        let message = error.to_string();
        drop(error);
        Self {
            status,
            code,
            message,
        }
    }
}
#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                code: self.code,
                message: self.message,
            }),
        )
            .into_response()
    }
}
