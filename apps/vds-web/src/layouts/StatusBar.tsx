import { CircleAlert, CircleX, Clock3, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useClock, useHealth } from '../api/queries'
import { useWorkspaceProblems } from '../hooks/useWorkspaceProblems'
import { useEventStore } from '../stores/eventStore'
import type { Theme } from '../hooks/useTheme'
import { formatVirtualTime, humanize } from '../utils/format'
import { countProblems } from '../utils/problems'

function VirtualClock() {
  const clock = useClock()
  const virtualTime = clock.data?.virtual_time_ns
  return (
    <span className="statusbar-item" title="Simulator virtual time">
      <Clock3 aria-hidden="true" size={12} />
      <span className="mono">{virtualTime === undefined ? '—' : formatVirtualTime(virtualTime)}</span>
    </span>
  )
}

function ServerStatus() {
  const health = useHealth()
  const tone = health.isError ? 'err' : health.data?.status === 'ok' ? 'ok' : 'warn'
  const label = health.isError ? 'unreachable' : health.data?.status ?? 'checking'
  return (
    <span className="statusbar-item" title="vds-server Control API">
      <i className={`status-dot ${tone}`} />
      <span>vds-server <span className="statusbar-dim">{label}</span></span>
    </span>
  )
}

function StreamStatus() {
  const status = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const tone = status === 'connected' ? 'live' : status === 'disconnected' ? 'err' : 'warn'
  return (
    <span className="statusbar-item" title={`Domain event stream · cursor #${lastEventId}`}>
      <i className={`status-dot ${tone}`} />
      <span>events <span className="statusbar-dim">{humanize(status)}</span></span>
      <span className="mono statusbar-dim">#{lastEventId}</span>
    </span>
  )
}

function gigabytes(bytes: number) {
  return (bytes / 1_000_000_000).toFixed(1)
}

function HostLoad() {
  const health = useHealth()
  const system = health.data?.system
  if (system?.cpu_percent === undefined && system?.memory_used_bytes === undefined) return null
  const memory = system.memory_used_bytes !== undefined && system.memory_total_bytes
    ? `RAM ${gigabytes(system.memory_used_bytes)}/${gigabytes(system.memory_total_bytes)} GB`
    : undefined
  return (
    <span className="statusbar-item statusbar-dim" title="Host load reported by vds-server">
      <span className="mono">{[system.cpu_percent === undefined ? undefined : `CPU ${system.cpu_percent.toFixed(0)}%`, memory].filter(Boolean).join(' · ')}</span>
    </span>
  )
}

function ProblemCounter() {
  const { errors, warnings } = countProblems(useWorkspaceProblems())
  return (
    <Link aria-label={`${errors} errors, ${warnings} warnings`} className={`statusbar-item statusbar-link${errors ? ' has-errors' : ''}`} title="Show problems on Overview" to="/">
      <CircleX aria-hidden="true" size={12} /> <span className="mono">{errors}</span>
      <CircleAlert aria-hidden="true" size={12} /> <span className="mono">{warnings}</span>
    </Link>
  )
}

export function StatusBar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <footer aria-label="Simulator status" className="statusbar">
      <ServerStatus />
      <StreamStatus />
      <VirtualClock />
      <ProblemCounter />
      <span className="statusbar-spacer" />
      <HostLoad />
      <span className="statusbar-item statusbar-dim" title="Workspace environment">local simulator</span>
      <button
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        className="statusbar-item statusbar-button"
        onClick={onToggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        type="button"
      >
        {theme === 'dark' ? <Sun aria-hidden="true" size={12} /> : <Moon aria-hidden="true" size={12} />}
      </button>
    </footer>
  )
}
