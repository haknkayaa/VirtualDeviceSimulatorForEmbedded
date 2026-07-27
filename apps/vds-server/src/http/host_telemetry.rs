use std::{
    fs,
    process::Command,
    time::{Duration, Instant},
};

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub(super) struct SystemMetrics {
    pub cpu_percent: Option<f64>,
    pub memory_used_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub disk_used_bytes: Option<u64>,
    pub disk_total_bytes: Option<u64>,
    pub network_rx_bytes_per_sec: Option<f64>,
    pub network_tx_bytes_per_sec: Option<f64>,
}

#[derive(Clone, Copy, Debug)]
struct CounterSnapshot {
    captured_at: Instant,
    cpu_idle: u64,
    cpu_total: u64,
    network_rx: u64,
    network_tx: u64,
}

#[derive(Debug)]
pub(super) struct HostTelemetrySampler {
    previous: Option<CounterSnapshot>,
}

impl HostTelemetrySampler {
    pub(super) fn new() -> Self {
        Self {
            previous: counter_snapshot(),
        }
    }

    pub(super) fn sample(&mut self) -> SystemMetrics {
        let current = counter_snapshot();
        let rates = self
            .previous
            .zip(current)
            .and_then(|(previous, current)| rate_metrics(previous, current));
        if current.is_some() {
            self.previous = current;
        }
        let (memory_used_bytes, memory_total_bytes) =
            memory_metrics().map_or((None, None), |(used, total)| (Some(used), Some(total)));
        let (disk_used_bytes, disk_total_bytes) =
            disk_metrics().map_or((None, None), |(used, total)| (Some(used), Some(total)));

        SystemMetrics {
            cpu_percent: rates.map(|values| values.0),
            memory_used_bytes,
            memory_total_bytes,
            disk_used_bytes,
            disk_total_bytes,
            network_rx_bytes_per_sec: rates.map(|values| values.1),
            network_tx_bytes_per_sec: rates.map(|values| values.2),
        }
    }
}

fn counter_snapshot() -> Option<CounterSnapshot> {
    let (cpu_idle, cpu_total) = cpu_counters()?;
    let (network_rx, network_tx) = network_counters().unwrap_or_default();
    Some(CounterSnapshot {
        captured_at: Instant::now(),
        cpu_idle,
        cpu_total,
        network_rx,
        network_tx,
    })
}

fn cpu_counters() -> Option<(u64, u64)> {
    let stat = fs::read_to_string("/proc/stat").ok()?;
    let values = stat
        .lines()
        .next()?
        .split_whitespace()
        .skip(1)
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let idle = values
        .get(3)
        .copied()?
        .saturating_add(values.get(4).copied().unwrap_or(0));
    Some((idle, values.into_iter().sum()))
}

fn memory_metrics() -> Option<(u64, u64)> {
    let meminfo = fs::read_to_string("/proc/meminfo").ok()?;
    let value = |key: &str| {
        meminfo.lines().find_map(|line| {
            let (name, rest) = line.split_once(':')?;
            (name == key)
                .then(|| rest.split_whitespace().next()?.parse::<u64>().ok())
                .flatten()
        })
    };
    let total = value("MemTotal")?.saturating_mul(1024);
    let available = value("MemAvailable")?.saturating_mul(1024);
    Some((total.saturating_sub(available), total))
}

fn network_counters() -> Option<(u64, u64)> {
    let contents = fs::read_to_string("/proc/net/dev").ok()?;
    let mut rx = 0_u64;
    let mut tx = 0_u64;
    for line in contents.lines().skip(2) {
        let (interface, counters) = line.split_once(':')?;
        if interface.trim() == "lo" {
            continue;
        }
        let values = counters.split_whitespace().collect::<Vec<_>>();
        rx = rx.saturating_add(values.first()?.parse::<u64>().ok()?);
        tx = tx.saturating_add(values.get(8)?.parse::<u64>().ok()?);
    }
    Some((rx, tx))
}

fn disk_metrics() -> Option<(u64, u64)> {
    let output = Command::new("df")
        .args(["-B1", "--output=size,used", "/"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .nth(1)?
        .to_owned();
    let mut values = line.split_whitespace().map(str::parse::<u64>);
    let total = values.next()?.ok()?;
    let used = values.next()?.ok()?;
    Some((used, total))
}

#[allow(clippy::cast_precision_loss)]
fn rate_metrics(previous: CounterSnapshot, current: CounterSnapshot) -> Option<(f64, f64, f64)> {
    let elapsed = current
        .captured_at
        .saturating_duration_since(previous.captured_at);
    if elapsed < Duration::from_millis(1) {
        return None;
    }
    let total_delta = current.cpu_total.saturating_sub(previous.cpu_total);
    let idle_delta = current.cpu_idle.saturating_sub(previous.cpu_idle);
    let cpu = if total_delta == 0 {
        0.0
    } else {
        (1.0 - idle_delta as f64 / total_delta as f64) * 100.0
    };
    let seconds = elapsed.as_secs_f64();
    Some((
        cpu.clamp(0.0, 100.0),
        current.network_rx.saturating_sub(previous.network_rx) as f64 / seconds,
        current.network_tx.saturating_sub(previous.network_tx) as f64 / seconds,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_linux_host_metrics() {
        let mut sampler = HostTelemetrySampler::new();
        std::thread::sleep(Duration::from_millis(5));
        let metrics = sampler.sample();

        assert!(
            metrics
                .cpu_percent
                .is_some_and(|value| (0.0..=100.0).contains(&value))
        );
        assert!(metrics.memory_total_bytes.is_some_and(|value| value > 0));
        assert!(metrics.memory_used_bytes.is_some_and(|value| value > 0));
        assert!(metrics.disk_total_bytes.is_some_and(|value| value > 0));
        assert!(metrics.network_rx_bytes_per_sec.is_some());
    }
}
