import { Activity, Boxes, Gauge, GitBranch, PlaySquare, Radio } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import { BrandLogo } from '../components/BrandLogo'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { StatusBadge } from '../components/StatusBadge'
import { useEventStore } from '../stores/eventStore'

const navigation = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/devices', label: 'Devices', icon: Boxes, end: false },
  { to: '/transactions', label: 'Transactions', icon: Activity, end: false },
  { to: '/scenarios', label: 'Scenarios', icon: PlaySquare, end: false },
  { to: '/flows', label: 'Flows', icon: GitBranch, end: false },
] as const

export function AppShell() {
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const lastEventId = useEventStore((state) => state.lastEventId)
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink aria-label="VDS4E dashboard" className="brand-lockup" to="/">
          <BrandLogo className="sidebar-brand-logo" decorative />
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
          <div className="stream-heading"><Radio aria-hidden="true" size={15} /><span>Live stream</span></div>
          <StatusBadge status={connectionStatus} />
          <small>Cursor #{lastEventId || '—'}</small>
        </div>
      </aside>
      <main className="main-content"><Outlet /></main>
      <EventDetailDrawer />
    </div>
  )
}
