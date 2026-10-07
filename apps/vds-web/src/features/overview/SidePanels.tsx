import { FlaskConical, Server, Waypoints } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useAdapters, useHealth } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import type { DomainEvent } from '../../types/events'
import { formatEventTime } from '../../utils/events'
import { formatVirtualTime } from '../../utils/format'
import { latestScenarioRun } from './overviewModel'

export function ScenarioRunPanel() {
  const events = useEventStore((state) => state.events)
  const run = useMemo(() => latestScenarioRun(events), [events])
  return (
    <Panel
      actions={run?.runId ? <Link className="button button-ghost button-sm" to="/logs">Log</Link> : undefined}
      className="overview-scenario"
      icon={FlaskConical}
      meta={run?.runId}
      title="Last scenario run"
    >
      {!run
        ? <AsyncState detail="Scenarios run from a device's Test Scenarios tab." kind="empty" title="No scenario run in this session" />
        : (
          <div className="scenario-summary">
            <div className="scenario-summary-head">
              <code className="scenario-id">{run.scenarioId}</code>
              <StatusBadge status={run.status} />
            </div>
            <dl className="kv-grid">
              <div><dt>Steps</dt><dd className="mono">
                {run.passed === undefined
                  ? `running${run.lastStep ? ` · ${run.lastStep}` : ''}`
                  : <><span className="text-ok">{run.passed} passed</span> · <span className={run.failed ? 'text-err' : ''}>{run.failed} failed</span> · {run.skipped} skipped</>}
              </dd></div>
              <div><dt>Duration</dt><dd className="mono">{run.startedVirtualNs !== undefined && run.completedVirtualNs !== undefined ? formatVirtualTime(run.completedVirtualNs - run.startedVirtualNs) : '—'} <span className="faint">virtual</span></dd></div>
              {run.lastError && <div><dt>Failure</dt><dd className="mono text-err" title={run.lastError}>{run.lastError}</dd></div>}
            </dl>
          </div>
        )}
    </Panel>
  )
}

function isSignalEvent(event: DomainEvent) {
  return event.payload.kind === 'signal_changed' && event.payload.phase === 'delivered'
}

export function SignalActivityPanel() {
  const events = useEventStore((state) => state.events)
  const signals = useMemo(() => {
    const recent: DomainEvent[] = []
    for (let index = events.length - 1; index >= 0 && recent.length < 8; index -= 1) {
      if (isSignalEvent(events[index])) recent.push(events[index])
    }
    return recent
  }, [events])
  return (
    <Panel className="overview-signals" flush icon={Waypoints} meta={signals.length ? `last ${signals.length}` : undefined} title="Signal activity">
      {signals.length === 0
        ? <AsyncState detail="Board topology routes device signal ports to GPIO lines." kind="empty" title="No signal propagation observed" />
        : (
          <ul className="signal-list">
            {signals.map((event) => {
              if (event.payload.kind !== 'signal_changed') return null
              const { source, target, value, delay_ns: delay } = event.payload
              return (
                <li className="signal-row" key={event.event_id}>
                  <time>{formatEventTime(event)}</time>
                  <span className="signal-route truncate" title={`${source} → ${target}`}><code>{source}</code> → <code>{target}</code></span>
                  <span className={`signal-level ${value ? 'high' : 'low'}`}>{value ? 'HIGH' : 'LOW'}</span>
                  <span className="signal-delay">{delay > 0 ? `+${formatVirtualTime(delay)}` : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
    </Panel>
  )
}

function formatBytes(value?: number) {
  if (value === undefined) return '—'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function ratio(used?: number, total?: number) {
  return used === undefined || total === undefined || total <= 0 ? undefined : Math.min(100, (used / total) * 100)
}

function MeterRow({ label, percent, detail }: { label: string; percent?: number; detail: string }) {
  const tone = percent === undefined ? '' : percent >= 90 ? ' err' : percent >= 75 ? ' warn' : ''
  return (
    <div className="host-meter">
      <span className="host-meter-label">{label}</span>
      <div className={`meter${tone}`}><i style={{ width: `${percent ?? 0}%` }} /></div>
      <span className="host-meter-value">{detail}</span>
    </div>
  )
}

export function HostPanel() {
  const health = useHealth()
  const adapters = useAdapters()
  const system = health.data?.system
  const daemons = (adapters.data ?? []).reduce((total, adapter) => total + adapter.daemon_pids.length, 0)
  const ram = ratio(system?.memory_used_bytes, system?.memory_total_bytes)
  const disk = ratio(system?.disk_used_bytes, system?.disk_total_bytes)
  return (
    <Panel className="overview-host" icon={Server} meta={health.isError ? 'unreachable' : health.data?.status} title="Host">
      <div className="host-meters">
        <MeterRow detail={system?.cpu_percent === undefined ? 'n/a' : `${system.cpu_percent.toFixed(1)}%`} label="CPU" percent={system?.cpu_percent} />
        <MeterRow detail={system?.memory_used_bytes === undefined ? 'n/a' : `${formatBytes(system.memory_used_bytes)} / ${formatBytes(system.memory_total_bytes)}`} label="RAM" percent={ram} />
        <MeterRow detail={system?.disk_used_bytes === undefined ? 'n/a' : `${formatBytes(system.disk_used_bytes)} / ${formatBytes(system.disk_total_bytes)}`} label="Disk" percent={disk} />
      </div>
      <dl className="kv-grid host-kv">
        <div><dt>Network</dt><dd className="mono">{system?.network_rx_bytes_per_sec === undefined ? 'n/a' : `↓ ${formatBytes(system.network_rx_bytes_per_sec)}/s  ↑ ${formatBytes(system.network_tx_bytes_per_sec)}/s`}</dd></div>
        <div><dt>Processes</dt><dd className="mono">vds-server{daemons ? ` + ${daemons} adapter daemon${daemons === 1 ? '' : 's'}` : ''}</dd></div>
      </dl>
    </Panel>
  )
}
