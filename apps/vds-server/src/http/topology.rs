//! HTTP endpoint for inspecting the board topology's signal connections.

use super::{ApiState, Json, Serialize, State};

#[derive(Serialize)]
pub(super) struct TopologyDto {
    /// Whether a topology file is attached to the runtime.
    attached: bool,
    /// The configured topology file, when one is attached.
    path: Option<String>,
    connections: Vec<ConnectionDto>,
}

#[derive(Serialize)]
struct ConnectionDto {
    /// Source endpoint, `<device>.<signal>`.
    from: String,
    /// Target endpoint, `<device>.<line>`.
    to: String,
    source_device: String,
    source_signal: String,
    target_device: String,
    target_line: String,
    delay_ns: u64,
    /// Last source level the router sampled; `null` until first sampled.
    level: Option<bool>,
    /// Delayed deliveries still travelling along the connection.
    pending: Vec<PendingDto>,
}

#[derive(Serialize)]
struct PendingDto {
    due_ns: u64,
    value: bool,
}

pub(super) async fn topology(State(state): State<ApiState>) -> Json<TopologyDto> {
    let connections = state.registry.topology_connections();
    Json(TopologyDto {
        attached: connections.is_some(),
        path: state
            .config
            .topology
            .as_ref()
            .filter(|_| connections.is_some())
            .map(|path| path.display().to_string()),
        connections: connections
            .unwrap_or_default()
            .into_iter()
            .map(|connection| ConnectionDto {
                from: format!("{}.{}", connection.source_device, connection.source_signal),
                to: format!("{}.{}", connection.target_device, connection.target_line),
                source_device: connection.source_device,
                source_signal: connection.source_signal,
                target_device: connection.target_device,
                target_line: connection.target_line,
                delay_ns: connection.delay_ns,
                level: connection.level,
                pending: connection
                    .pending
                    .into_iter()
                    .map(|pending| PendingDto {
                        due_ns: pending.due_ns,
                        value: pending.value,
                    })
                    .collect(),
            })
            .collect(),
    })
}
