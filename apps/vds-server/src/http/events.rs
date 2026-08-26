//! HTTP and WebSocket endpoints for domain events.

use super::{
    ApiState, Arc, Deserialize, EventBus, Message, Query, Response, State, WebSocket,
    WebSocketUpgrade,
};

#[derive(Deserialize, Default)]
pub(super) struct EventsQuery {
    after_event_id: Option<u64>,
}
pub(super) async fn events(
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
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
            first = subscription.recv() => {
                let Some(first) = first else { break };
                let mut batch = vec![first];
                let deadline = tokio::time::sleep(std::time::Duration::from_millis(20));
                tokio::pin!(deadline);
                while batch.len() < 256 {
                    tokio::select! {
                        event = subscription.recv() => {
                            let Some(event) = event else { break };
                            batch.push(event);
                        }
                        () = &mut deadline => break,
                    }
                }
                let serializable = batch.iter().map(AsRef::as_ref).collect::<Vec<_>>();
                let Ok(json) = serde_json::to_string(&serializable) else {
                    continue;
                };
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}
