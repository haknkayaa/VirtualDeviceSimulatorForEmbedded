mod runs;

use std::{collections::HashMap, fs, sync::Arc};

use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use vds_core::{
    clock::SimulatorClock,
    config::ServerConfig,
    device::Device,
    registry::{DeviceRegistry, DeviceSnapshot},
};
use vds_device_model::DeviceModel;
use vds_events::{EventBus, EventDraft, EventPayload};
use vds_scenario::{JUnitReportMetadata, ScenarioDocument, ScenarioResult, to_junit_xml};

pub use runs::{RunManager, RunRecord, RunStatus};

#[derive(Clone)]
pub struct ApiState {
    pub registry: Arc<DeviceRegistry>,
    pub events: Arc<EventBus>,
    pub scenarios: Arc<HashMap<String, ScenarioDocument>>,
    pub runs: Arc<RunManager>,
    pub config: ServerConfig,
    device_templates: Arc<HashMap<String, DeviceModel>>,
    clock: Arc<dyn SimulatorClock>,
}

impl ApiState {
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
        for path in &config.scenarios {
            let yaml = fs::read_to_string(path).map_err(|error| {
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
        for path in &config.device_models {
            let model = DeviceModel::load(path)
                .map_err(|error| format!("invalid device model '{}': {error}", path.display()))?;
            let template_id = model.device.id.clone();
            if device_templates
                .insert(template_id.clone(), model)
                .is_some()
            {
                return Err(format!("duplicate device template id '{template_id}'"));
            }
        }
        Ok(Self {
            registry,
            events,
            scenarios: Arc::new(scenarios),
            runs: Arc::new(RunManager::default()),
            config,
            device_templates: Arc::new(device_templates),
            clock,
        })
    }
}

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/devices", get(devices).post(create_device))
        .route("/api/v1/device-models", get(device_templates))
        .route("/api/v1/devices/{id}", get(device))
        .route("/api/v1/devices/{id}/registers", get(registers))
        .route("/api/v1/devices/{id}/state", get(device_state))
        .route("/api/v1/devices/{id}/reset", post(reset_device))
        .route("/api/v1/scenarios", get(scenarios))
        .route("/api/v1/scenarios/{id}", get(scenario))
        .route("/api/v1/scenarios/{id}/run", post(run_scenario))
        .route("/api/v1/runs/{run_id}", get(run))
        .route("/api/v1/runs/{run_id}/result", get(run_result))
        .route("/api/v1/runs/{run_id}/result/junit", get(run_result_junit))
        .route("/api/v1/faults", get(faults))
        .route("/api/v1/faults/{id}/enable", post(enable_fault))
        .route("/api/v1/faults/{id}/disable", post(disable_fault))
        .route("/api/v1/events", get(events))
        .with_state(state)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}
async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

#[derive(Serialize)]
struct DeviceDto {
    id: String,
    bus: String,
    state: Option<String>,
}

#[derive(Serialize)]
struct DeviceTemplateDto {
    id: String,
    name: String,
    bus: String,
    model: String,
}

async fn device_templates(State(state): State<ApiState>) -> Json<Vec<DeviceTemplateDto>> {
    let mut templates = state
        .device_templates
        .iter()
        .map(|(id, template)| DeviceTemplateDto {
            id: id.clone(),
            name: template.device.name.clone(),
            bus: template.device.bus.clone(),
            model: template.device.model.clone(),
        })
        .collect::<Vec<_>>();
    templates.sort_by(|left, right| left.id.cmp(&right.id));
    Json(templates)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateDeviceRequest {
    template_id: String,
    device_id: String,
}

async fn create_device(
    State(state): State<ApiState>,
    Json(request): Json<CreateDeviceRequest>,
) -> ApiResult<(StatusCode, Json<DeviceDto>)> {
    if !valid_device_id(&request.device_id) {
        return Err(ApiError::bad_request(
            "invalid_device_id",
            "device_id must be 1-64 ASCII letters, numbers, '.', '_' or '-', and start with a letter or number".to_owned(),
        ));
    }
    if state
        .registry
        .snapshots()
        .map_err(ApiError::device)?
        .iter()
        .any(|device| device.id == request.device_id)
    {
        return Err(ApiError::conflict(
            "device_id_conflict",
            format!("device '{}' already exists", request.device_id),
        ));
    }
    let mut model = state
        .device_templates
        .get(&request.template_id)
        .cloned()
        .ok_or_else(|| {
            ApiError::not_found(
                "device_template_not_found",
                format!("device template '{}' was not found", request.template_id),
            )
        })?;
    model.device.id.clone_from(&request.device_id);
    let device = model
        .into_spi_device_with_clock(Arc::clone(&state.clock))
        .map_err(|error| {
            ApiError::bad_request(
                "device_instance_create_failed",
                format!("device instance could not be created: {error}"),
            )
        })?;
    let snapshot = DeviceDto {
        id: device.id().to_owned(),
        bus: device.bus_type().to_string(),
        state: device.current_state().map_err(ApiError::device)?,
    };
    state.registry.register(Arc::new(device)).map_err(|error| {
        if error.to_string().contains("duplicate device id") {
            ApiError::conflict("device_id_conflict", error.to_string())
        } else {
            ApiError::device(error)
        }
    })?;
    Ok((StatusCode::CREATED, Json(snapshot)))
}

fn valid_device_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.len() <= 64
        && first.is_ascii_alphanumeric()
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

impl From<DeviceSnapshot> for DeviceDto {
    fn from(value: DeviceSnapshot) -> Self {
        Self {
            id: value.id,
            bus: value.bus,
            state: value.state,
        }
    }
}

async fn devices(State(state): State<ApiState>) -> ApiResult<Json<Vec<DeviceDto>>> {
    Ok(Json(
        state
            .registry
            .snapshots()
            .map_err(ApiError::device)?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

async fn device(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<DeviceDto>> {
    let found = state
        .registry
        .snapshots()
        .map_err(ApiError::device)?
        .into_iter()
        .find(|device| device.id == id)
        .ok_or_else(|| {
            ApiError::not_found("device_not_found", format!("device '{id}' was not found"))
        })?;
    Ok(Json(found.into()))
}

#[derive(Serialize)]
struct RegisterDto {
    name: String,
    address: u64,
    width_bits: u8,
    access: String,
    value: u64,
}
async fn registers(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<RegisterDto>>> {
    Ok(Json(
        state
            .registry
            .registers(&id)
            .map_err(ApiError::device)?
            .into_iter()
            .map(|register| RegisterDto {
                name: register.name,
                address: register.address,
                width_bits: register.width_bits,
                access: register.access.to_string(),
                value: register.value,
            })
            .collect(),
    ))
}

#[derive(Serialize)]
struct StateDto {
    device_id: String,
    state: Option<String>,
}
async fn device_state(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StateDto>> {
    let current = state
        .registry
        .current_state(&id)
        .map_err(ApiError::device)?;
    Ok(Json(StateDto {
        device_id: id,
        state: current,
    }))
}

async fn reset_device(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StateDto>> {
    let events = state.registry.reset(&id).map_err(ApiError::device)?;
    let now = state
        .registry
        .virtual_time_ns(&id)
        .map_err(ApiError::device)?;
    let _ = state.events.publish(EventDraft {
        virtual_time_ns: now,
        device_id: Some(id.clone()),
        scenario_run_id: None,
        payload: EventPayload::DeviceReset {
            result: "success".to_owned(),
        },
    });
    for event in events {
        let _ = state.events.publish(EventDraft {
            virtual_time_ns: now,
            device_id: Some(id.clone()),
            scenario_run_id: None,
            payload: EventPayload::from_device_event(&event),
        });
    }
    let current = state
        .registry
        .current_state(&id)
        .map_err(ApiError::device)?;
    Ok(Json(StateDto {
        device_id: id,
        state: current,
    }))
}

#[derive(Serialize)]
struct ScenarioSummary {
    id: String,
    name: String,
    timeout_ms: u64,
    steps: usize,
}
async fn scenarios(State(state): State<ApiState>) -> Json<Vec<ScenarioSummary>> {
    let mut values = state
        .scenarios
        .values()
        .map(|scenario| ScenarioSummary {
            id: scenario.scenario.id.clone(),
            name: scenario.scenario.name.clone(),
            timeout_ms: scenario.scenario.timeout_ms,
            steps: scenario.steps.len(),
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.id.cmp(&right.id));
    Json(values)
}
async fn scenario(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<ScenarioDocument>> {
    state.scenarios.get(&id).cloned().map(Json).ok_or_else(|| {
        ApiError::not_found(
            "scenario_not_found",
            format!("scenario '{id}' was not found"),
        )
    })
}
async fn run_scenario(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Query(query): Query<RunScenarioQuery>,
    body: Option<Json<serde_json::Value>>,
) -> ApiResult<(StatusCode, Json<RunRecord>)> {
    let scenario_revision = query.revision.unwrap_or(1);
    if scenario_revision == 0 {
        return Err(ApiError::bad_request(
            "invalid_scenario_revision",
            "scenario revision must be greater than zero".to_owned(),
        ));
    }
    let scenario = if let Some(Json(value)) = body {
        let scenario = ScenarioDocument::from_json_value(value).map_err(|error| {
            ApiError::bad_request("invalid_scenario", format!("invalid scenario: {error}"))
        })?;
        if scenario.scenario.id != id {
            return Err(ApiError::bad_request(
                "scenario_id_mismatch",
                format!(
                    "path scenario '{id}' does not match body scenario '{}'",
                    scenario.scenario.id
                ),
            ));
        }
        scenario
    } else {
        state.scenarios.get(&id).cloned().ok_or_else(|| {
            ApiError::not_found(
                "scenario_not_found",
                format!("scenario '{id}' was not found"),
            )
        })?
    };
    let record = state.runs.start(
        scenario,
        scenario_revision,
        state.config.clone(),
        Arc::clone(&state.events),
    );
    Ok((StatusCode::ACCEPTED, Json(record)))
}

#[derive(Deserialize, Default)]
struct RunScenarioQuery {
    revision: Option<u64>,
}
async fn run(
    State(state): State<ApiState>,
    Path(run_id): Path<String>,
) -> ApiResult<Json<RunRecord>> {
    state.runs.get(&run_id).map(Json).ok_or_else(|| {
        ApiError::not_found("run_not_found", format!("run '{run_id}' was not found"))
    })
}
async fn run_result(
    State(state): State<ApiState>,
    Path(run_id): Path<String>,
) -> ApiResult<Json<ScenarioResult>> {
    let record = state.runs.get(&run_id).ok_or_else(|| {
        ApiError::not_found("run_not_found", format!("run '{run_id}' was not found"))
    })?;
    record.result.map(Json).ok_or_else(|| {
        ApiError::conflict(
            "run_not_complete",
            format!("run '{run_id}' is not complete"),
        )
    })
}

async fn run_result_junit(
    State(state): State<ApiState>,
    Path(run_id): Path<String>,
) -> ApiResult<Response> {
    let record = state.runs.get(&run_id).ok_or_else(|| {
        ApiError::not_found("run_not_found", format!("run '{run_id}' was not found"))
    })?;
    let result = record.result.as_ref().ok_or_else(|| {
        ApiError::conflict(
            "run_not_complete",
            format!("run '{run_id}' is not complete"),
        )
    })?;
    let xml = to_junit_xml(
        result,
        JUnitReportMetadata {
            run_id: &run_id,
            scenario_revision: record.scenario_revision,
        },
    );
    let filename = junit_filename(&record.scenario_id, &run_id);
    let mut response = xml.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/xml; charset=utf-8"
            .parse()
            .expect("static content type is valid"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{filename}\"")
            .parse()
            .expect("sanitized filename creates a valid header"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("static cache control is valid"),
    );
    Ok(response)
}

fn junit_filename(scenario_id: &str, run_id: &str) -> String {
    let safe = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect::<String>()
    };
    format!("{}-{}.junit.xml", safe(scenario_id), safe(run_id))
}

#[derive(Serialize)]
struct FaultDto {
    id: String,
    device_id: String,
    enabled: bool,
    priority: i32,
    persistent: bool,
    trigger: String,
    action: String,
}
async fn faults(State(state): State<ApiState>) -> ApiResult<Json<Vec<FaultDto>>> {
    Ok(Json(
        state
            .registry
            .fault_snapshots()
            .map_err(ApiError::device)?
            .into_iter()
            .map(|item| FaultDto {
                id: item.fault.id,
                device_id: item.device_id,
                enabled: item.fault.enabled,
                priority: item.fault.priority,
                persistent: item.fault.persistent,
                trigger: item.fault.trigger.to_owned(),
                action: item.fault.action.to_owned(),
            })
            .collect(),
    ))
}
async fn enable_fault(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    set_fault(&state, &id, true)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn disable_fault(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    set_fault(&state, &id, false)?;
    Ok(StatusCode::NO_CONTENT)
}
fn set_fault(state: &ApiState, id: &str, enabled: bool) -> ApiResult<()> {
    match state
        .registry
        .set_fault_enabled(id, enabled)
        .map_err(ApiError::device)?
    {
        1 => Ok(()),
        0 => Err(ApiError::not_found(
            "fault_not_found",
            format!("fault '{id}' was not found"),
        )),
        count => Err(ApiError::conflict(
            "fault_ambiguous",
            format!("fault '{id}' matched {count} devices"),
        )),
    }
}

#[derive(Deserialize, Default)]
struct EventsQuery {
    after_event_id: Option<u64>,
}
async fn events(
    State(state): State<ApiState>,
    Query(query): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| {
        event_socket(socket, state.events, query.after_event_id.unwrap_or(0))
    })
}
async fn event_socket(mut socket: WebSocket, events: Arc<EventBus>, after_event_id: u64) {
    let mut subscription = events.subscribe_from(after_event_id);
    while let Some(event) = subscription.recv().await {
        let Ok(json) = serde_json::to_string(event.as_ref()) else {
            continue;
        };
        if socket.send(Message::Text(json.into())).await.is_err() {
            break;
        }
    }
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
