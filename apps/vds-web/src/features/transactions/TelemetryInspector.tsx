import { Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { BusTelemetry } from '../../types/api'

interface TelemetrySample {
  generatedAtWallNs: number
  throughputBytesPerSecond: number
  latencyP95Us: number
}

const HISTORY_LENGTH = 30

/** Keeps a short per-device history of the 2 s telemetry polls for sparklines. */
function useTelemetryHistory(
  deviceId: string | undefined,
  generatedAtWallNs: number | undefined,
  throughputBytesPerSecond: number | undefined,
  latencyP95Us: number | undefined,
) {
  const [history, setHistory] = useState<Record<string, TelemetrySample[]>>({})

  useEffect(() => {
    if (
      deviceId === undefined ||
      generatedAtWallNs === undefined ||
      throughputBytesPerSecond === undefined ||
      latencyP95Us === undefined
    ) return

    const updateId = window.setTimeout(() => {
      setHistory((current) => {
        const deviceHistory = current[deviceId] ?? []
        if (deviceHistory.at(-1)?.generatedAtWallNs === generatedAtWallNs) return current
        return {
          ...current,
          [deviceId]: [
            ...deviceHistory,
            { generatedAtWallNs, throughputBytesPerSecond, latencyP95Us },
          ].slice(-HISTORY_LENGTH),
        }
      })
    }, 0)

    return () => window.clearTimeout(updateId)
  }, [deviceId, generatedAtWallNs, latencyP95Us, throughputBytesPerSecond])

  return deviceId === undefined ? [] : history[deviceId] ?? []
}

function formatRate(bytesPerSecond: number | undefined) {
  if (bytesPerSecond === undefined) return '—'
  if (bytesPerSecond >= 1_000_000) return `${(bytesPerSecond / 1_000_000).toFixed(2)} MB/s`
  if (bytesPerSecond >= 1_000) return `${(bytesPerSecond / 1_000).toFixed(1)} KB/s`
  return `${bytesPerSecond.toFixed(2)} B/s`
}

function formatMicros(value: number) {
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)} ms`
  if (value >= 100) return `${value.toFixed(0)} µs`
  return `${value.toFixed(value >= 10 ? 0 : 1)} µs`
}

function Sparkline({ points, label, tone }: { points: number[]; label: string; tone: 'rate' | 'latency' }) {
  if (points.length < 2) {
    return <div aria-hidden="true" className="txa-spark txa-spark-empty">{points.length ? 'collecting…' : 'no samples'}</div>
  }
  const max = Math.max(...points, Number.EPSILON)
  const path = points
    .map((point, index) => `${(index / (HISTORY_LENGTH - 1)) * 100},${30 - (point / max) * 28}`)
    .join(' ')
  return (
    <svg aria-label={label} className={`txa-spark txa-spark-${tone}`} preserveAspectRatio="none" role="img" viewBox="0 0 100 31">
      <line className="txa-spark-base" x1="0" x2="100" y1="30" y2="30" />
      <polyline points={path} />
    </svg>
  )
}

interface TelemetryInspectorProps {
  telemetry?: BusTelemetry
  /** True when the telemetry shown is for a fallback device, not the selection. */
  fallback: boolean
  generatedAtWallNs?: number
  windowSeconds: number
  loading: boolean
  error: boolean
}

/** Compact per-bus health readouts for the device behind the selected transaction. */
export function TelemetryInspector({
  telemetry,
  fallback,
  generatedAtWallNs,
  windowSeconds,
  loading,
  error,
}: TelemetryInspectorProps) {
  const throughput = telemetry
    ? telemetry.throughput.tx_bytes_per_second + telemetry.throughput.rx_bytes_per_second
    : undefined
  const history = useTelemetryHistory(telemetry?.device_id, generatedAtWallNs, throughput, telemetry?.latency.wall_p95_us)
  const completed = (telemetry?.transactions_total ?? 0) > 0
  const errorRate = completed && telemetry ? telemetry.errors.rate * 100 : undefined
  const successRate = errorRate === undefined ? undefined : Math.max(0, Math.min(100, 100 - errorRate))
  const successText = successRate === undefined ? '—' : `${successRate.toFixed(1)}%`
  const successTone = successRate === undefined ? '' : successRate < 95 ? ' err' : successRate < 99.5 ? ' warn' : ' ok'

  return (
    <Panel
      className="txa-telemetry"
      flush
      icon={Gauge}
      meta={`${windowSeconds}s window`}
      title="Bus telemetry"
    >
      {!telemetry && loading && <AsyncState kind="loading" title="Loading bus telemetry" />}
      {!telemetry && !loading && error && <AsyncState kind="error" title="Bus telemetry unavailable" />}
      {!telemetry && !loading && !error && <AsyncState detail="Telemetry appears once a device handles traffic." kind="empty" title="No bus telemetry" />}
      {telemetry && (
        <>
          <div className="txa-tel-head">
            <BusTag bus={telemetry.bus_type} />
            <strong className="truncate" title={telemetry.device_id}>{telemetry.device_id}</strong>
            <StatusBadge status={telemetry.health} />
          </div>
          {fallback && <p className="txa-tel-note">No telemetry for the selected device; showing the first active bus.</p>}

          <div className="txa-tel-section">
            <div className="txa-tel-readout">
              <span>Success rate</span>
              <strong>{successText}</strong>
            </div>
            <div
              aria-label={`Success rate: ${successText}`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={successRate}
              className={`meter${successTone}`}
              role="meter"
            >
              <i style={{ width: `${successRate ?? 0}%` }} />
            </div>
            <dl className="kv-grid txa-tel-kv">
              <div><dt>Error rate</dt><dd className={`mono${errorRate ? ' text-err' : ''}`}>{errorRate === undefined ? '—' : `${errorRate.toFixed(2)}%`}</dd></div>
              <div><dt>Errors</dt><dd className="mono">{telemetry.errors.count}</dd></div>
              <div><dt>Retries</dt><dd className="mono">{telemetry.retries.count}</dd></div>
              <div><dt>Last error</dt><dd className={`mono${telemetry.errors.last_code ? ' text-err' : ' dim'}`}>{telemetry.errors.last_code ?? 'none'}</dd></div>
              <div><dt>Transactions</dt><dd className="mono">{telemetry.transactions_total}</dd></div>
              <div><dt>In flight</dt><dd className={`mono${telemetry.in_flight ? ' text-warn' : ''}`}>{telemetry.in_flight}</dd></div>
            </dl>
          </div>

          <div className="txa-tel-section">
            <div className="txa-tel-readout">
              <span>Throughput</span>
              <strong>{formatRate(throughput)}</strong>
            </div>
            <Sparkline label="Throughput history" points={history.map((sample) => sample.throughputBytesPerSecond)} tone="rate" />
            <dl className="kv-grid txa-tel-kv">
              <div><dt>TX</dt><dd className="mono">{formatRate(telemetry.throughput.tx_bytes_per_second)}</dd></div>
              <div><dt>RX</dt><dd className="mono">{formatRate(telemetry.throughput.rx_bytes_per_second)}</dd></div>
            </dl>
          </div>

          <div className="txa-tel-section">
            <div className="txa-tel-readout">
              <span>Latency p95</span>
              <strong>{completed ? formatMicros(telemetry.latency.wall_p95_us) : '—'}</strong>
            </div>
            <Sparkline label="Latency p95 history" points={history.map((sample) => sample.latencyP95Us)} tone="latency" />
            <dl className="kv-grid txa-tel-kv">
              <div><dt>Average</dt><dd className="mono">{completed ? formatMicros(telemetry.latency.wall_avg_us) : '—'}</dd></div>
              <div><dt>Maximum</dt><dd className="mono">{completed ? formatMicros(telemetry.latency.wall_max_us) : '—'}</dd></div>
              <div><dt>Virtual avg</dt><dd className="mono">{completed ? `${telemetry.latency.virtual_avg_ns.toFixed(0)} ns` : '—'}</dd></div>
            </dl>
          </div>
        </>
      )}
    </Panel>
  )
}
