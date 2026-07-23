import { Activity, Clock3, Gauge, RefreshCcw, TriangleAlert } from 'lucide-react'

import type { BusTelemetry } from '../../types/api'

interface BusTelemetrySidebarProps {
  telemetry?: BusTelemetry
  loading: boolean
  error: boolean
}

function rate(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MB/s`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} KB/s`
  return `${value.toFixed(2)} B/s`
}

export function BusTelemetrySidebar({
  telemetry,
  loading,
  error,
}: BusTelemetrySidebarProps) {
  if (loading && !telemetry) {
    return <aside className="bus-telemetry-sidebar"><div className="telemetry-empty">Loading bus telemetry…</div></aside>
  }
  if (error && !telemetry) {
    return <aside className="bus-telemetry-sidebar"><div className="telemetry-empty error">Bus telemetry unavailable</div></aside>
  }
  if (!telemetry) {
    return <aside className="bus-telemetry-sidebar"><div className="telemetry-empty">Select a live device</div></aside>
  }

  return (
    <aside aria-label="Bus telemetry summary" className="bus-telemetry-sidebar">
      <section className="bus-metric-card bus-health-summary">
        <header><span><Activity size={15} /> Bus Health Summary</span><i className={`health-${telemetry.health}`}>{telemetry.health}</i></header>
        <strong>{telemetry.device_id}</strong>
        <small>{telemetry.bus_type.toUpperCase()} · {telemetry.transactions_total} transactions · {telemetry.in_flight} active</small>
      </section>
      <section className="bus-metric-card">
        <header><span><Gauge size={15} /> Throughput</span><small>60 sec window</small></header>
        <dl>
          <div><dt>TX</dt><dd>{rate(telemetry.throughput.tx_bytes_per_second)}</dd></div>
          <div><dt>RX</dt><dd>{rate(telemetry.throughput.rx_bytes_per_second)}</dd></div>
        </dl>
      </section>
      <section className="bus-metric-card">
        <header><span><Clock3 size={15} /> Latency</span><small>Wall / Virtual</small></header>
        <dl>
          <div><dt>Average</dt><dd>{telemetry.latency.wall_avg_us.toFixed(2)} µs</dd></div>
          <div><dt>P95</dt><dd>{telemetry.latency.wall_p95_us.toFixed(2)} µs</dd></div>
          <div><dt>Maximum</dt><dd>{telemetry.latency.wall_max_us.toFixed(2)} µs</dd></div>
          <div><dt>Virtual avg</dt><dd>{telemetry.latency.virtual_avg_ns.toFixed(0)} ns</dd></div>
        </dl>
      </section>
      <section className="bus-metric-card">
        <header><span><TriangleAlert size={15} /> Errors & Retries</span><RefreshCcw size={13} /></header>
        <dl>
          <div><dt>Errors</dt><dd>{telemetry.errors.count}</dd></div>
          <div><dt>Error rate</dt><dd>{(telemetry.errors.rate * 100).toFixed(2)}%</dd></div>
          <div><dt>Retries</dt><dd>{telemetry.retries.count}</dd></div>
          <div><dt>Last error</dt><dd>{telemetry.errors.last_code ?? 'None'}</dd></div>
        </dl>
      </section>
    </aside>
  )
}

