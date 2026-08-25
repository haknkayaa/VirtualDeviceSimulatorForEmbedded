//! HTTP endpoints for device fault inspection and control.

use super::{ApiError, ApiResult, ApiState, Json, Path, Serialize, State, StatusCode};

#[derive(Serialize)]
pub(super) struct FaultDto {
    id: String,
    device_id: String,
    enabled: bool,
    priority: i32,
    persistent: bool,
    trigger: String,
    action: String,
}
pub(super) async fn faults(State(state): State<ApiState>) -> ApiResult<Json<Vec<FaultDto>>> {
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
pub(super) async fn enable_fault(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    set_fault(&state, &id, true)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(super) async fn disable_fault(
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
