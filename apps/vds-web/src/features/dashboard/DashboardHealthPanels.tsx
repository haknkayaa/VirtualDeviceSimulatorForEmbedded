import {
  Activity,
  Blocks,
  Box,
  Cpu,
  Database,
  Gauge,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  RadioTower,
  Server,
  TerminalSquare,
} from 'lucide-react'

import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import type { SystemMetrics } from '../../types/api'
import type { EventConnectionStatus } from '../../types/events'

interface DashboardHealthPanelsProps {
  connectionStatus: EventConnectionStatus
  healthStatus?: string
  systemMetrics?: SystemMetrics
}

const runtimeModules = [
  'vds-core',
  'vds-device-model',
  'vds-events',
  'vds-protocol',
  'vds-registers',
  'vds-scenario',
] as const

function percent(used?: number, total?: number) {
  if (used === undefined || total === undefined || total <= 0) return undefined
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function formatBytes(value?: number) {
  if (value === undefined) return 'Not exposed'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`
  return `${value} B`
}

export function DashboardHealthPanels({
  connectionStatus,
  healthStatus,
  systemMetrics,
}: DashboardHealthPanelsProps) {
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
        action={<StatusBadge status={healthStatus === 'ok' ? 'healthy' : healthStatus ?? 'checking'} />}
        className="server-health-panel"
        eyebrow="Platform nodes"
        title="Server Health"
      >
        <div className="platform-node-map">
          <article className="platform-node platform-node-primary">
            <span><Server aria-hidden="true" size={16} /></span>
            <div><strong>vds-server</strong><small>Control API · WebSocket · Unix socket</small></div>
            <i className={healthStatus === 'ok' ? 'online' : ''} />
          </article>
          <div aria-hidden="true" className="node-map-rail" />
          <div className="platform-node-clients">
            <article className="platform-node">
              <span><Globe2 aria-hidden="true" size={15} /></span>
              <div><strong>vds-web</strong><small>Operator UI</small></div>
              <i className="online" />
            </article>
            <article className="platform-node">
              <span><TerminalSquare aria-hidden="true" size={15} /></span>
              <div><strong>vds-cli</strong><small>Automation client</small></div>
              <i className="available" />
            </article>
            <article className="platform-node">
              <span><RadioTower aria-hidden="true" size={15} /></span>
              <div><strong>Event stream</strong><small>Domain telemetry</small></div>
              <i className={connectionStatus === 'connected' ? 'online' : ''} />
            </article>
            <article className="platform-node">
              <span><Box aria-hidden="true" size={15} /></span>
              <div><strong>C client SDK</strong><small>Application data plane</small></div>
              <i className="available" />
            </article>
          </div>
        </div>
        <div className="runtime-module-list">
          <span><Blocks aria-hidden="true" size={12} /> Linked runtime modules</span>
          <div>
            {runtimeModules.map((module) => <code key={module}>{module}</code>)}
          </div>
        </div>
      </GlassPanel>

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
                <span><Gauge aria-hidden="true" size={11} /> RX <b>{formatBytes(systemMetrics?.network_rx_bytes_per_sec)}/s</b></span>
                <span><Database aria-hidden="true" size={11} /> TX <b>{formatBytes(systemMetrics?.network_tx_bytes_per_sec)}/s</b></span>
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>
    </aside>
  )
}
