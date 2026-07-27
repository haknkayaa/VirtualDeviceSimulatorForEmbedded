use super::*;

#[derive(Serialize)]
pub(super) struct ScenarioSummary {
    id: String,
    name: String,
    timeout_ms: u64,
    steps: usize,
    device_ids: Vec<String>,
}
pub(super) async fn scenarios(State(state): State<ApiState>) -> Json<Vec<ScenarioSummary>> {
    let mut values = state
        .scenarios
        .values()
        .map(|scenario| ScenarioSummary {
            id: scenario.scenario.id.clone(),
            name: scenario.scenario.name.clone(),
            timeout_ms: scenario.scenario.timeout_ms,
            steps: scenario.steps.len(),
            device_ids: scenario.referenced_devices(),
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| left.id.cmp(&right.id));
    Json(values)
}
pub(super) async fn scenario(
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
pub(super) async fn run_scenario(
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
pub(super) struct RunScenarioQuery {
    revision: Option<u64>,
}
pub(super) async fn run(
    State(state): State<ApiState>,
    Path(run_id): Path<String>,
) -> ApiResult<Json<RunRecord>> {
    state.runs.get(&run_id).map(Json).ok_or_else(|| {
        ApiError::not_found("run_not_found", format!("run '{run_id}' was not found"))
    })
}
pub(super) async fn run_result(
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

pub(super) async fn run_result_junit(
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
