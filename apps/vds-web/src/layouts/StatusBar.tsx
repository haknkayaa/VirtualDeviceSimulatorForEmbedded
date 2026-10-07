import { CircleAlert, CircleX, Moon, Sun, Timer } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useHealth } from '../api/queries'
import { useWorkspaceProblems } from '../hooks/useWorkspaceProblems'
import { useEventStore } from '../stores/eventStore'
import type { Theme } from '../hooks/useTheme'
import { humanize } from '../utils/format'
import { countProblems } from '../utils/problems'

function gigabytes(bytes: number) {
  return (bytes / 1_000_000_000).toFixed(1)
}

function HostLoad() {
  const health = useHealth()
  const system = health.data?.system
  return (
    <>
      <span className="statusbar-item" title="Host CPU load reported by vds-server">
        CPU <span className="mono">{system?.cpu_percent === undefined ? '—' : `${system.cpu_percent.toFixed(0)}%`}</span>
      </span>
      <span className="statusbar-item" title="Host memory in use">
        RAM <span className="mono">{system?.memory_used_bytes === undefined ? '—' : `${gigabytes(system.memory_used_bytes)} GB`}</span>
      </span>
    </>
  )
}

function StreamStatus() {
  const status = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const tone = status === 'connected' ? 'ok' : status === 'disconnected' ? 'err' : 'warn'
  return (
    <span className="statusbar-item" title={`Domain event stream · cursor #${lastEventId}`}>
      <i className={`status-dot ${tone}`} />
      Event stream {humanize(status)}
    </span>
  )
}

function ProblemCounter() {
  const { errors, warnings } = countProblems(useWorkspaceProblems())
  return (
    <Link aria-label={`${errors} errors, ${warnings} warnings`} className={`statusbar-item statusbar-link${errors ? ' has-errors' : ''}`} title="Show problems on Overview" to="/">
      <CircleX aria-hidden="true" size={13} /> <span className="mono">{errors}</span>
      <CircleAlert aria-hidden="true" size={13} /> <span className="mono">{warnings}</span>
    </Link>
  )
}

function ServerAddress() {
  const health = useHealth()
  const tone = health.isError ? 'err' : health.data?.status === 'ok' ? 'ok' : 'warn'
  return (
    <span className="statusbar-item" title="Control API address">
      {window.location.host}
      <i className={`status-dot ${tone}`} />
    </span>
  )
}

export function StatusBar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <footer aria-label="Simulator status" className="statusbar">
      <HostLoad />
      <StreamStatus />
      <span className="statusbar-item" title="Device time advances on the simulator's virtual clock">
        <Timer aria-hidden="true" size={13} /> Simulation clock (virtual time)
      </span>
      <ProblemCounter />
      <span className="statusbar-spacer" />
      <span className="statusbar-item">VDS4E v{__APP_VERSION__}</span>
      <ServerAddress />
      <button
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        className="statusbar-item statusbar-button"
        onClick={onToggleTheme}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        type="button"
      >
        {theme === 'dark' ? <Sun aria-hidden="true" size={13} /> : <Moon aria-hidden="true" size={13} />}
      </button>
    </footer>
  )
}
