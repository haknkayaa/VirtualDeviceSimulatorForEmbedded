//! HTTP endpoints for adapter creation, binding, loading, and removal.

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
    bus_number: Option<u16>,
    line_count: Option<u16>,
    max_frequency_hz: Option<u32>,
}

pub(super) async fn create_adapter(
    State(state): State<ApiState>,
    Json(request): Json<CreateAdapterRequest>,
) -> ApiResult<(StatusCode, Json<AdapterSnapshot>)> {
    let adapter = match request.bus_type.to_ascii_lowercase().as_str() {
        "spi" => state.adapters.create_spi(
            request.id,
            request.name,
            request.bus_number.ok_or_else(|| {
                ApiError::bad_request(
                    "adapter_bus_number_required",
                    "SPI adapters require bus_number".to_owned(),
                )
            })?,
            request.max_frequency_hz,
        ),
        "i2c" => state.adapters.create_i2c(
            request.id,
            request.name,
            request.bus_number.ok_or_else(|| {
                ApiError::bad_request(
                    "adapter_bus_number_required",
                    "I2C adapters require bus_number".to_owned(),
                )
            })?,
            request.max_frequency_hz,
        ),
        "gpio" => state.adapters.create_gpio(
            request.id,
            request.name,
            request.line_count.ok_or_else(|| {
                ApiError::bad_request(
                    "adapter_line_count_required",
                    "GPIO adapters require line_count".to_owned(),
                )
            })?,
        ),
        "uart" => state.adapters.create_uart(
            request.id,
            request.name,
            request.bus_number.ok_or_else(|| {
                ApiError::bad_request(
                    "adapter_bus_number_required",
                    "UART adapters require bus_number".to_owned(),
                )
            })?,
        ),
        _ => {
            return Err(ApiError::bad_request(
                "adapter_bus_unsupported",
                format!(
                    "bus type '{}' does not have a runtime adapter driver",
                    request.bus_type
                ),
            ));
        }
    }
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
    let adapter = state
        .adapters
        .list()
        .map_err(ApiError::adapter)?
        .into_iter()
        .find(|adapter| adapter.id == adapter_id)
        .ok_or_else(|| {
            ApiError::not_found(
                "adapter_not_found",
                format!("adapter '{adapter_id}' was not found"),
            )
        })?;
    if device.bus != adapter.bus_type {
        return Err(ApiError::bad_request(
            "adapter_bus_mismatch",
            format!(
                "device '{}' uses bus '{}' but adapter '{}' uses '{}'",
                request.device_id, device.bus, adapter.id, adapter.bus_type
            ),
        ));
    }
    let attached = if adapter.bus_type == "gpio" {
        let line_names = state
            .registry
            .gpio_lines(&request.device_id)
            .map_err(ApiError::device)?
            .into_iter()
            .map(|line| line.name)
            .collect();
        state
            .adapters
            .attach_gpio(&adapter_id, request.device_id, line_names)
    } else {
        state
            .adapters
            .attach(&adapter_id, request.device_id, request.endpoint)
    }
    .map_err(ApiError::adapter)?;
    Ok(Json(attached))
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
