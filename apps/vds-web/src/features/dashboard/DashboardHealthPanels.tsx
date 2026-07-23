import {
  Activity,
  Blocks,
  Cpu,
  Database,
  Gauge,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  TerminalSquare,
} from 'lucide-react'

import { GlassPanel } from '../../components/GlassPanel'
import { StatusBadge } from '../../components/StatusBadge'
import type { SystemMetrics } from '../../types/api'

interface DashboardHealthPanelsProps {
  healthStatus?: string
  systemMetrics?: SystemMetrics
}

const platformModules = [
  { id: 'vds-web', detail: 'Operator UI', icon: Globe2 },
  { id: 'vds-cli', detail: 'Automation client', icon: TerminalSquare },
  { id: 'vds-core', detail: 'Routing & fault engine', icon: Cpu },
  { id: 'vds-device-model', detail: 'Device runtime', icon: Gauge },
  { id: 'vds-events', detail: 'Domain event bus', icon: Activity },
  { id: 'vds-protocol', detail: 'Protobuf contracts', icon: Network },
  { id: 'vds-registers', detail: 'Register engine', icon: Database },
  { id: 'vds-scenario', detail: 'Scenario runtime', icon: Blocks },
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
  healthStatus,
  systemMetrics,
}: DashboardHealthPanelsProps) {
  const serverRunning = healthStatus === 'ok'
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
                <span><Gauge aria-hidden="true" size={11} /> RX <b>{formatBytes(systemMetrics?.network_rx_bytes_per_sec)}/s</b></span>
                <span><Database aria-hidden="true" size={11} /> TX <b>{formatBytes(systemMetrics?.network_tx_bytes_per_sec)}/s</b></span>
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>

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
            <span className={`platform-node-status ${serverRunning ? 'running' : 'failed'}`}>
              <i /> {serverRunning ? 'RUNNING' : 'FAIL'}
            </span>
          </article>
          <div aria-hidden="true" className="node-map-rail" />
          <div className="platform-node-clients">
            {platformModules.map((module) => (
              <article className="platform-node" key={module.id}>
                <span><module.icon aria-hidden="true" size={15} /></span>
                <div><strong title={module.id}>{module.id}</strong><small>{module.detail}</small></div>
                <span className={`platform-node-status ${module.id === 'vds-web' || serverRunning ? 'running' : 'failed'}`}>
                  <i /> {module.id === 'vds-web' || serverRunning ? 'RUNNING' : 'FAIL'}
                </span>
              </article>
            ))}
          </div>
        </div>
      </GlassPanel>
    </aside>
  )
}
