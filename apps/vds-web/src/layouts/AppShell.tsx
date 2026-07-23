import { Activity, Bell, Boxes, CircleHelp, Gauge, GitBranch, LibraryBig, Moon, PlaySquare, Radio, Settings, Sun } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import { BrandLogo } from '../components/BrandLogo'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { StatusBadge } from '../components/StatusBadge'
import { useEventStore } from '../stores/eventStore'
import { useTheme } from '../hooks/useTheme'
import { formatVirtualTime } from '../utils/format'

const navigation = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/devices', label: 'Devices', icon: Boxes, end: false },
  { to: '/transactions', label: 'Transactions', icon: Activity, end: false },
  { to: '/scenarios', label: 'Scenarios', icon: PlaySquare, end: false },
  { to: '/device-library', label: 'Device Library', icon: LibraryBig, end: false },
  { to: '/flows', label: 'Flows', icon: GitBranch, end: false },
] as const

const workspaceNavigation = [
  { to: '/', label: 'Overview', end: true },
  { to: '/devices', label: 'Devices', end: false },
  { to: '/transactions', label: 'Transactions', end: false },
  { to: '/scenarios', label: 'Scenarios', end: false },
  { to: '/device-library', label: 'Device Library', end: false },
  { to: '/flows', label: 'Flow editor', end: false },
] as const

export function AppShell() {
  const { theme, toggleTheme } = useTheme()
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  const retainedEvents = useEventStore((state) => state.events.length)
  const virtualTime = useEventStore((state) => state.events.at(-1)?.timestamp_virtual_ns ?? 0)
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink aria-label="VDS4E dashboard" className="brand-lockup" to="/">
          <BrandLogo className="sidebar-brand-logo" decorative variant={theme} />
        </NavLink>
        <nav aria-label="Primary navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} end={end} key={to} to={to}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-stream">
          <div className="stream-heading"><Radio aria-hidden="true" size={15} /><span>Simulator status</span></div>
          <div className="sidebar-runtime-row"><span>Event stream</span><StatusBadge status={connectionStatus} /></div>
          <dl className="sidebar-runtime-stats">
            <div><dt>Virtual time</dt><dd>{virtualTime ? formatVirtualTime(virtualTime) : '—'}</dd></div>
            <div><dt>Retained</dt><dd>{retainedEvents.toLocaleString()}</dd></div>
            <div><dt>Cursor</dt><dd>#{lastEventId || '—'}</dd></div>
          </dl>
        </div>
        <div className="workspace-identity"><span>LW</span><div><strong>Local workspace</strong><small>Control plane</small></div></div>
      </aside>
      <div className="workspace-shell">
        <header className="workspace-topbar">
          <nav aria-label="Workspace navigation" className="workspace-tabs">
            {workspaceNavigation.map(({ to, label, end }) => (
              <NavLink className={({ isActive }) => isActive ? 'active' : ''} end={end} key={to} to={to}>{label}</NavLink>
            ))}
          </nav>
          <div className="workspace-context">
            <div className="header-actions" role="group" aria-label="Workspace actions">
              <button aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} type="button">
                {theme === 'dark' ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
              </button>
              <button aria-label="Notifications" title="Notifications" type="button"><Bell aria-hidden="true" size={17} /><span className="header-action-dot" /></button>
              <button aria-label="Help" title="Help" type="button"><CircleHelp aria-hidden="true" size={17} /></button>
              <button aria-label="Settings" title="Settings" type="button"><Settings aria-hidden="true" size={17} /></button>
            </div>
            <label className="environment-context">
              <span>Environment</span>
              <select aria-label="Environment" defaultValue="local">
                <option value="local">Local simulator</option>
                <option disabled value="new">+ New Environment</option>
              </select>
            </label>
          </div>
        </header>
        <main className="main-content"><Outlet /></main>
      </div>
      <EventDetailDrawer />
    </div>
  )
}
