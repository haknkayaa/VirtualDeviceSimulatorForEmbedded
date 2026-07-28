use super::{
    ApiError, ApiResult, ApiState, Arc, Deserialize, Device, DeviceModel, DeviceSnapshot,
    EventDraft, EventPayload, Json, Path, Serialize, State, StatusCode,
};

#[derive(Serialize)]
pub(super) struct DeviceDto {
    id: String,
    bus: String,
    state: Option<String>,
    image_url: Option<String>,
}

#[derive(Serialize)]
pub(super) struct DeviceTemplateDto {
    id: String,
    name: String,
    bus: String,
    model: String,
    image_url: Option<String>,
}

pub(super) async fn device_templates(
    State(state): State<ApiState>,
) -> Json<Vec<DeviceTemplateDto>> {
    let mut templates = state
        .device_templates
        .iter()
        .map(|(id, template)| DeviceTemplateDto {
            id: id.clone(),
            name: template.device.name.clone(),
            bus: template.device.bus.clone(),
            model: template.device.model.clone(),
            image_url: state.device_template_images.get(id).cloned(),
        })
        .collect::<Vec<_>>();
    templates.sort_by(|left, right| left.id.cmp(&right.id));
    Json(templates)
}

pub(super) async fn device_flow(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let instances = state.device_template_instances.read().map_err(|_| {
        ApiError::conflict(
            "device_package_state_unavailable",
            "device package state is unavailable".to_owned(),
        )
    })?;
    let template_id = instances.get(&id).ok_or_else(|| {
        ApiError::not_found("device_not_found", format!("device '{id}' was not found"))
    })?;
    let mut flow = state
        .device_flows
        .get(template_id)
        .cloned()
        .ok_or_else(|| {
            ApiError::not_found(
                "device_flow_not_found",
                format!("device '{id}' does not provide a packaged behavior flow"),
            )
        })?;
    if let Some(device_id) = flow.pointer_mut("/metadata/behavior/device_id") {
        *device_id = serde_json::Value::String(id);
    }
    Ok(Json(flow))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateDeviceRequest {
    template_id: String,
    device_id: String,
}

pub(super) async fn create_device(
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
    let device: Arc<dyn Device> = (if model.device.bus == "gpio" {
        model
            .into_gpio_device()
            .map(|device| Arc::new(device) as Arc<dyn Device>)
    } else {
        model
            .into_spi_device_with_clock(Arc::clone(&state.clock))
            .map(|device| Arc::new(device) as Arc<dyn Device>)
    })
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
        image_url: state
            .device_template_images
            .get(&request.template_id)
            .cloned(),
    };
    state.registry.register(device).map_err(|error| {
        if error.to_string().contains("duplicate device id") {
            ApiError::conflict("device_id_conflict", error.to_string())
        } else {
            ApiError::device(error)
        }
    })?;
    state
        .device_template_instances
        .write()
        .map_err(|_| {
            ApiError::conflict(
                "device_package_state_unavailable",
                "device package state is unavailable".to_owned(),
            )
        })?
        .insert(request.device_id, request.template_id);
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

fn device_dto(state: &ApiState, value: DeviceSnapshot) -> DeviceDto {
    let image_url = state
        .device_template_instances
        .read()
        .ok()
        .and_then(|instances| instances.get(&value.id).cloned())
        .and_then(|template_id| state.device_template_images.get(&template_id).cloned());
    DeviceDto {
        id: value.id,
        bus: value.bus,
        state: value.state,
        image_url,
    }
}

pub(super) async fn devices(State(state): State<ApiState>) -> ApiResult<Json<Vec<DeviceDto>>> {
    Ok(Json(
        state
            .registry
            .snapshots()
            .map_err(ApiError::device)?
            .into_iter()
            .map(|snapshot| device_dto(&state, snapshot))
            .collect(),
    ))
}

pub(super) async fn device(
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
    Ok(Json(device_dto(&state, found)))
}

fn device_template(state: &ApiState, id: &str) -> ApiResult<DeviceModel> {
    let instances = state.device_template_instances.read().map_err(|_| {
        ApiError::conflict(
            "device_package_state_unavailable",
            "device package state is unavailable".to_owned(),
        )
    })?;
    let template_id = instances.get(id).ok_or_else(|| {
        ApiError::not_found("device_not_found", format!("device '{id}' was not found"))
    })?;
    state
        .device_templates
        .get(template_id)
        .cloned()
        .ok_or_else(|| {
            ApiError::not_found(
                "device_template_not_found",
                format!("template metadata for device '{id}' was not found"),
            )
        })
}

pub(super) async fn device_commands(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<vds_device_model::SpiCommandDefinition>>> {
    Ok(Json(device_template(&state, &id)?.device.commands.clone()))
}

#[derive(Serialize)]
pub(super) struct RegisterDto {
    name: String,
    address: u64,
    width_bits: u8,
    access: String,
    value: u64,
    reset_value: u64,
    description: String,
    bitfields: Vec<RegisterBitFieldDto>,
}
#[derive(Serialize)]
pub(super) struct RegisterBitFieldDto {
    name: String,
    lsb: u8,
    width: u8,
    access: String,
    description: String,
}
fn register_dto(register: vds_core::device::RegisterSnapshot) -> RegisterDto {
    RegisterDto {
        name: register.name,
        address: register.address,
        width_bits: register.width_bits,
        access: register.access.to_string(),
        value: register.value,
        reset_value: register.reset_value,
        description: register.description,
        bitfields: register
            .bitfields
            .into_iter()
            .map(|field| RegisterBitFieldDto {
                name: field.name,
                lsb: field.lsb,
                width: field.width,
                access: field.access.to_string(),
                description: field.description,
            })
            .collect(),
    }
}
pub(super) async fn registers(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<RegisterDto>>> {
    Ok(Json(
        state
            .registry
            .registers(&id)
            .map_err(ApiError::device)?
            .into_iter()
            .map(register_dto)
            .collect(),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WriteRegisterRequest {
    value: u64,
}

pub(super) async fn write_register(
    State(state): State<ApiState>,
    Path((id, address)): Path<(String, u64)>,
    Json(request): Json<WriteRegisterRequest>,
) -> ApiResult<Json<RegisterDto>> {
    let trace = state
        .registry
        .write_register(&id, address, request.value)
        .map_err(ApiError::device)?;
    let now = state
        .registry
        .virtual_time_ns(&id)
        .map_err(ApiError::device)?;
    let _ = state.events.publish(EventDraft {
        virtual_time_ns: now,
        device_id: Some(id.clone()),
        scenario_run_id: None,
        payload: EventPayload::from_register(&trace),
    });
    let register = state
        .registry
        .registers(&id)
        .map_err(ApiError::device)?
        .into_iter()
        .find(|register| register.address == address)
        .ok_or_else(|| {
            ApiError::not_found(
                "register_unknown_address",
                format!("device '{id}' has no register at address 0x{address:X}"),
            )
        })?;
    Ok(Json(register_dto(register)))
}

#[derive(Serialize)]
pub(super) struct StateDto {
    device_id: String,
    state: Option<String>,
}
pub(super) async fn device_state(
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

pub(super) async fn reset_device(
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
