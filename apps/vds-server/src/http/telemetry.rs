use std::{
    collections::{HashMap, HashSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{Json, extract::State};
use serde::Serialize;
use vds_events::EventPayload;

use super::{ApiError, ApiResult, ApiState};

const WINDOW_SECONDS: u64 = 60;
const NANOS_PER_SECOND: u64 = 1_000_000_000;

#[derive(Serialize)]
pub(super) struct BusTelemetryResponse {
    generated_at_wall_ns: u64,
    window_seconds: u64,
    buses: Vec<BusTelemetry>,
}

#[derive(Serialize)]
struct BusTelemetry {
    device_id: String,
    bus_type: String,
    health: &'static str,
    transactions_total: u64,
    in_flight: u64,
    throughput: Throughput,
    latency: Latency,
    errors: Errors,
    retries: Retries,
}

#[derive(Serialize)]
struct Throughput {
    tx_bytes_per_second: f64,
    rx_bytes_per_second: f64,
}

#[derive(Serialize)]
struct Latency {
    wall_avg_us: f64,
    wall_p95_us: f64,
    wall_max_us: f64,
    virtual_avg_ns: f64,
    virtual_p95_ns: u64,
    virtual_max_ns: u64,
}

#[derive(Serialize)]
struct Errors {
    count: u64,
    rate: f64,
    last_code: Option<String>,
}

#[derive(Serialize)]
struct Retries {
    count: u64,
}

#[derive(Clone)]
struct StartedTransaction {
    device_id: String,
    wall_ns: u64,
    virtual_ns: u64,
    tx_bytes: usize,
}

#[derive(Default)]
struct DeviceAccumulator {
    completed: u64,
    in_flight: u64,
    tx_bytes: u64,
    rx_bytes: u64,
    wall_latencies_ns: Vec<u64>,
    virtual_latencies_ns: Vec<u64>,
    errors: u64,
    last_error: Option<(u64, String)>,
}

pub(super) async fn bus_telemetry(
    State(state): State<ApiState>,
) -> ApiResult<Json<BusTelemetryResponse>> {
    let now_ns = wall_time_ns();
    let cutoff_ns = now_ns.saturating_sub(WINDOW_SECONDS.saturating_mul(NANOS_PER_SECOND));
    let events = state.events.events_after(0);
    let mut starts = HashMap::<(String, u64), StartedTransaction>::new();
    let mut completed_keys = HashSet::<(String, u64)>::new();
    let mut accumulators = HashMap::<String, DeviceAccumulator>::new();

    for event in &events {
        let Some(device_id) = event.device_id.as_ref() else {
            continue;
        };
        if let EventPayload::TransactionStarted {
            transaction_id: Some(transaction_id),
            request,
            ..
        } = &event.payload
        {
            starts.insert(
                (device_id.clone(), *transaction_id),
                StartedTransaction {
                    device_id: device_id.clone(),
                    wall_ns: event.timestamp_wall_ns,
                    virtual_ns: event.timestamp_virtual_ns,
                    tx_bytes: request.len(),
                },
            );
        }
    }

    for event in &events {
        let EventPayload::TransactionCompleted {
            transaction_id: Some(transaction_id),
            response,
            result,
            error_code,
        } = &event.payload
        else {
            continue;
        };
        let Some(device_id) = event.device_id.as_ref() else {
            continue;
        };
        let key = (device_id.clone(), *transaction_id);
        completed_keys.insert(key.clone());
        if event.timestamp_wall_ns < cutoff_ns {
            continue;
        }
        let accumulator = accumulators.entry(device_id.clone()).or_default();
        accumulator.completed += 1;
        accumulator.rx_bytes = accumulator
            .rx_bytes
            .saturating_add(u64::try_from(response.len()).unwrap_or(u64::MAX));
        if let Some(start) = starts.get(&key) {
            accumulator.tx_bytes = accumulator
                .tx_bytes
                .saturating_add(u64::try_from(start.tx_bytes).unwrap_or(u64::MAX));
            accumulator
                .wall_latencies_ns
                .push(event.timestamp_wall_ns.saturating_sub(start.wall_ns));
            accumulator
                .virtual_latencies_ns
                .push(event.timestamp_virtual_ns.saturating_sub(start.virtual_ns));
        }
        if result != "success" {
            accumulator.errors += 1;
            if let Some(code) = error_code {
                accumulator.last_error = Some((event.timestamp_wall_ns, code.clone()));
            }
        }
    }

    for (key, start) in starts {
        if start.wall_ns >= cutoff_ns && !completed_keys.contains(&key) {
            accumulators.entry(start.device_id).or_default().in_flight += 1;
        }
    }

    let snapshots = state.registry.snapshots().map_err(ApiError::device)?;
    let buses = snapshots
        .into_iter()
        .map(|device| {
            let accumulator = accumulators.remove(&device.id).unwrap_or_default();
            build_snapshot(device.id, device.bus.clone(), accumulator)
        })
        .collect();

    Ok(Json(BusTelemetryResponse {
        generated_at_wall_ns: now_ns,
        window_seconds: WINDOW_SECONDS,
        buses,
    }))
}

fn build_snapshot(
    device_id: String,
    bus_type: String,
    mut accumulator: DeviceAccumulator,
) -> BusTelemetry {
    accumulator.wall_latencies_ns.sort_unstable();
    accumulator.virtual_latencies_ns.sort_unstable();
    let error_rate = if accumulator.completed == 0 {
        0.0
    } else {
        bounded_count(accumulator.errors) / bounded_count(accumulator.completed)
    };
    let health = if accumulator.completed == 0 && accumulator.in_flight == 0 {
        "idle"
    } else if error_rate > 0.05 {
        "unhealthy"
    } else if error_rate >= 0.01 {
        "degraded"
    } else {
        "healthy"
    };
    let wall_avg_ns = average(&accumulator.wall_latencies_ns);
    let virtual_avg_ns = average(&accumulator.virtual_latencies_ns);

    BusTelemetry {
        device_id,
        bus_type,
        health,
        transactions_total: accumulator.completed,
        in_flight: accumulator.in_flight,
        throughput: Throughput {
            tx_bytes_per_second: bounded_count(accumulator.tx_bytes) / 60.0,
            rx_bytes_per_second: bounded_count(accumulator.rx_bytes) / 60.0,
        },
        latency: Latency {
            wall_avg_us: wall_avg_ns / 1_000.0,
            wall_p95_us: nanoseconds_as_f64(percentile_95(&accumulator.wall_latencies_ns))
                / 1_000.0,
            wall_max_us: nanoseconds_as_f64(
                accumulator.wall_latencies_ns.last().copied().unwrap_or(0),
            ) / 1_000.0,
            virtual_avg_ns,
            virtual_p95_ns: percentile_95(&accumulator.virtual_latencies_ns),
            virtual_max_ns: accumulator
                .virtual_latencies_ns
                .last()
                .copied()
                .unwrap_or(0),
        },
        errors: Errors {
            count: accumulator.errors,
            rate: error_rate,
            last_code: accumulator.last_error.map(|(_, code)| code),
        },
        retries: Retries { count: 0 },
    }
}

fn percentile_95(values: &[u64]) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let rank = values.len().saturating_mul(95).div_ceil(100);
    values[rank.saturating_sub(1)]
}

fn average(values: &[u64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values
            .iter()
            .map(|value| nanoseconds_as_f64(*value))
            .sum::<f64>()
            / f64::from(u32::try_from(values.len()).unwrap_or(u32::MAX))
    }
}

fn bounded_count(value: u64) -> f64 {
    f64::from(u32::try_from(value).unwrap_or(u32::MAX))
}

fn nanoseconds_as_f64(value: u64) -> f64 {
    Duration::from_nanos(value).as_secs_f64() * 1_000_000_000.0
}

fn wall_time_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_nanos()).unwrap_or(u64::MAX)
        })
}
