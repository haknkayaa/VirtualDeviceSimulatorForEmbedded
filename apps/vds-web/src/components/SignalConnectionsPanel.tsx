import { Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useClock, useTopology } from '../api/queries'
import type { TopologyConnection } from '../types/api'
import { formatVirtualTime } from '../utils/format'
import { AsyncState } from './AsyncState'
import { Panel } from './Panel'

interface SignalConnectionsPanelProps {
  /** Only connections that start or end at this device. */
  deviceId?: string
  className?: string
}

function levelLabel(level: boolean | null) {
  if (level === null) return { text: 'Not sampled', tone: '' }
  return level ? { text: 'High', tone: 'ok' } : { text: 'Low', tone: 'info' }
}

function inFlight(connection: TopologyConnection, nowNs: number | undefined) {
  const next = connection.pending[0]
  if (!next) return '—'
  const due = nowNs === undefined ? formatVirtualTime(next.due_ns) : `in ${formatVirtualTime(Math.max(0, next.due_ns - nowNs))}`
  const count = connection.pending.length
  return `${next.value ? 'High' : 'Low'} ${due}${count > 1 ? ` (+${count - 1})` : ''}`
}

function Endpoint({ device, name, current }: { device: string; name: string; current?: string }) {
  return (
    <span className="mono">
      {device === current ? device : <Link to={`/devices/${encodeURIComponent(device)}`}>{device}</Link>}
      <span className="dim">.</span>{name}
    </span>
  )
}

/**
 * Board topology wiring: each device output signal, the GPIO line it drives,
 * the configured virtual-time delay, the last sampled level and any delayed
 * level change still on the wire. Renders nothing without a topology.
 */
export function SignalConnectionsPanel({ deviceId, className = '' }: SignalConnectionsPanelProps) {
  const topology = useTopology()
  const clock = useClock()
  if (topology.isError) {
    return (
      <Panel className={`signal-connections ${className}`.trim()} icon={Waypoints} title="Signal connections">
        <AsyncState detail={topology.error.message} kind="error" title="Topology unavailable" />
      </Panel>
    )
  }
  if (!topology.data?.attached) return null
  const connections = topology.data.connections.filter((connection) =>
    deviceId === undefined || connection.source_device === deviceId || connection.target_device === deviceId)
  if (deviceId !== undefined && connections.length === 0) return null
  const nowNs = clock.data?.virtual_time_ns

  return (
    <Panel
      className={`signal-connections ${className}`.trim()}
      flush
      icon={Waypoints}
      meta={topology.data.path ? <span title={topology.data.path}>{topology.data.path.split('/').pop()}</span> : undefined}
      title="Signal connections"
    >
      {connections.length === 0
        ? <AsyncState detail="The attached topology declares no connections." kind="empty" title="No connections" />
        : (
          <table className="data-table signal-table">
            <thead>
              <tr>
                <th>Source signal</th>
                <th aria-label="drives" />
                <th>GPIO line</th>
                <th className="num">Delay</th>
                <th>Level</th>
                <th>In flight</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((connection) => {
                const level = levelLabel(connection.level)
                return (
                  <tr key={`${connection.from}->${connection.to}`}>
                    <td><Endpoint current={deviceId} device={connection.source_device} name={connection.source_signal} /></td>
                    <td aria-hidden="true" className="dim">→</td>
                    <td><Endpoint current={deviceId} device={connection.target_device} name={connection.target_line} /></td>
                    <td className="num mono">{connection.delay_ns === 0 ? '0' : formatVirtualTime(connection.delay_ns)}</td>
                    <td><span className="signal-level"><span className={`status-dot ${level.tone}`.trim()} />{level.text}</span></td>
                    <td className="mono">{inFlight(connection, nowNs)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
    </Panel>
  )
}
