use super::{
    AdapterError, AdapterSnapshot, ApiError, ApiResult, ApiState, Arc, Deserialize, Json, Path,
    State, StatusCode,
};

pub(super) async fn adapters(
    State(state): State<ApiState>,
) -> ApiResult<Json<Vec<AdapterSnapshot>>> {
    Ok(Json(state.adapters.list().map_err(ApiError::adapter)?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateAdapterRequest {
    id: String,
    name: String,
    bus_type: String,
    bus_number: u16,
}

pub(super) async fn create_adapter(
    State(state): State<ApiState>,
    Json(request): Json<CreateAdapterRequest>,
) -> ApiResult<(StatusCode, Json<AdapterSnapshot>)> {
    if !request.bus_type.eq_ignore_ascii_case("spi") {
        return Err(ApiError::bad_request(
            "adapter_bus_unsupported",
            format!(
                "bus type '{}' does not have a runtime adapter driver",
                request.bus_type
            ),
        ));
    }
    let adapter = state
        .adapters
        .create_spi(request.id, request.name, request.bus_number)
        .map_err(ApiError::adapter)?;
    Ok((StatusCode::CREATED, Json(adapter)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct AttachAdapterDeviceRequest {
    device_id: String,
    endpoint: u16,
}

pub(super) async fn attach_adapter_device(
    State(state): State<ApiState>,
    Path(adapter_id): Path<String>,
    Json(request): Json<AttachAdapterDeviceRequest>,
) -> ApiResult<Json<AdapterSnapshot>> {
    let device = state
        .registry
        .snapshots()
        .map_err(ApiError::device)?
        .into_iter()
        .find(|device| device.id == request.device_id)
        .ok_or_else(|| {
            ApiError::not_found(
                "adapter_device_not_found",
                format!("device '{}' was not found", request.device_id),
            )
        })?;
    if device.bus != "spi" {
        return Err(ApiError::bad_request(
            "adapter_bus_mismatch",
            format!("device '{}' is not an SPI device", request.device_id),
        ));
    }
    Ok(Json(
        state
            .adapters
            .attach(&adapter_id, request.device_id, request.endpoint)
            .map_err(ApiError::adapter)?,
    ))
}

pub(super) async fn detach_adapter_device(
    State(state): State<ApiState>,
    Path((adapter_id, device_id)): Path<(String, String)>,
) -> ApiResult<Json<AdapterSnapshot>> {
    Ok(Json(
        state
            .adapters
            .detach(&adapter_id, &device_id)
            .map_err(ApiError::adapter)?,
    ))
}

pub(super) async fn load_adapter(
    State(state): State<ApiState>,
    Path(adapter_id): Path<String>,
) -> ApiResult<Json<AdapterSnapshot>> {
    let adapters = Arc::clone(&state.adapters);
    let loaded = tokio::task::spawn_blocking(move || adapters.load(&adapter_id))
        .await
        .map_err(|error| {
            ApiError::adapter(AdapterError::Process(format!(
                "adapter load task failed: {error}"
            )))
        })?
        .map_err(ApiError::adapter)?;
    Ok(Json(loaded))
}

pub(super) async fn unload_adapter(
    State(state): State<ApiState>,
    Path(adapter_id): Path<String>,
) -> ApiResult<Json<AdapterSnapshot>> {
    let adapters = Arc::clone(&state.adapters);
    let unloaded = tokio::task::spawn_blocking(move || adapters.unload(&adapter_id))
        .await
        .map_err(|error| {
            ApiError::adapter(AdapterError::Process(format!(
                "adapter unload task failed: {error}"
            )))
        })?
        .map_err(ApiError::adapter)?;
    Ok(Json(unloaded))
}
