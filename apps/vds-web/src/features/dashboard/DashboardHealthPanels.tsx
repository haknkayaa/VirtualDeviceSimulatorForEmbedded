import {
  Activity,
  Cable,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server,
} from 'lucide-react'

import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Adapter, SystemMetrics } from '../../types/api'

interface DashboardHealthPanelsProps {
  adapters?: Adapter[]
  healthStatus?: string
  systemMetrics?: SystemMetrics
}

function percent(used?: number, total?: number) {
  if (used === undefined || total === undefined || total <= 0) return undefined
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function formatBytes(value?: number) {
  if (value === undefined) return 'Not exposed'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`
  return `${Math.round(value)} B`
}

function formatRate(value?: number) {
  return value === undefined ? '—' : `${formatBytes(value)}/s`
}

export function DashboardHealthPanels({
  adapters = [],
  healthStatus,
  systemMetrics,
}: DashboardHealthPanelsProps) {
  const serverRunning = healthStatus === 'ok'
  const adapterProcesses = adapters.flatMap((adapter) =>
    adapter.daemon_pids.map((pid, index) => ({
      adapter,
      endpoint: adapter.bindings[index]?.endpoint,
      pid,
    })),
  )
  const cpu = systemMetrics?.cpu_percent
  const ram = percent(systemMetrics?.memory_used_bytes, systemMetrics?.memory_total_bytes)
  const disk = percent(systemMetrics?.disk_used_bytes, systemMetrics?.disk_total_bytes)
  const metrics = [
    { id: 'cpu', label: 'CPU', icon: Cpu, value: cpu, detail: cpu === undefined ? 'Not exposed' : `${cpu.toFixed(1)}%` },
    {
      id: 'ram',
      label: 'RAM',
      icon: MemoryStick,
      value: ram,
      detail: systemMetrics?.memory_used_bytes === undefined
        ? 'Not exposed'
        : `${formatBytes(systemMetrics.memory_used_bytes)} / ${formatBytes(systemMetrics.memory_total_bytes)}`,
    },
    {
      id: 'disk',
      label: 'Disk',
      icon: HardDrive,
      value: disk,
      detail: systemMetrics?.disk_used_bytes === undefined
        ? 'Not exposed'
        : `${formatBytes(systemMetrics.disk_used_bytes)} / ${formatBytes(systemMetrics.disk_total_bytes)}`,
    },
  ] as const

  return (
    <aside aria-label="Platform health" className="dashboard-health-stack">
      <GlassPanel
        action={<span className="system-telemetry-state"><Activity aria-hidden="true" size={13} /> Host telemetry</span>}
        className="system-health-panel"
        eyebrow="Host resources"
        title="System Health"
      >
        <div className="system-metric-list">
          {metrics.map((metric) => (
            <div className={`system-metric-row${metric.value === undefined ? ' unavailable' : ''}`} key={metric.id}>
              <span><metric.icon aria-hidden="true" size={15} /></span>
              <div>
                <header><strong>{metric.label}</strong><small>{metric.detail}</small></header>
                <div className="system-meter"><i style={{ width: `${metric.value ?? 0}%` }} /></div>
              </div>
            </div>
          ))}
          <div className={`system-metric-row network-metric${systemMetrics?.network_rx_bytes_per_sec === undefined ? ' unavailable' : ''}`}>
            <span><Network aria-hidden="true" size={15} /></span>
            <div>
              <header><strong>Network Traffic</strong><small>{systemMetrics?.network_rx_bytes_per_sec === undefined ? 'Not exposed' : 'Live throughput'}</small></header>
              <div className="network-values">
                <span><Gauge aria-hidden="true" size={11} /> RX <b>{formatRate(systemMetrics?.network_rx_bytes_per_sec)}</b></span>
                <span><Database aria-hidden="true" size={11} /> TX <b>{formatRate(systemMetrics?.network_tx_bytes_per_sec)}</b></span>
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel
        action={<StatusBadge status={healthStatus === 'ok' ? 'healthy' : healthStatus ?? 'checking'} />}
        className="server-health-panel"
        eyebrow="Operating system processes"
        title="Server Health"
      >
        <div className="platform-node-map">
          <article className="platform-node platform-node-primary">
            <span><Server aria-hidden="true" size={16} /></span>
            <div><strong>vds-server</strong><small>Control API · WebSocket · Unix socket</small></div>
            <span className={`platform-node-status ${serverRunning ? 'running' : 'failed'}`}>
              <i /> {serverRunning ? 'RUNNING' : 'FAIL'}
            </span>
          </article>
          {adapterProcesses.length === 0 ? (
            <p className="platform-process-empty">No separate adapter processes are running.</p>
          ) : (
            <div className="platform-node-clients">
              {adapterProcesses.map(({ adapter, endpoint, pid }) => (
                <article className="platform-node" key={`${adapter.id}-${pid}`}>
                  <span><Cable aria-hidden="true" size={15} /></span>
                  <div>
                    <strong title={adapter.name}>{adapter.id} adapter</strong>
                    <small>{adapter.driver} daemon{endpoint === undefined ? '' : ` · endpoint ${endpoint}`} · PID {pid}</small>
                  </div>
                  <span className="platform-node-status running">
                    <i /> RUNNING
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </GlassPanel>
    </aside>
  )
}
