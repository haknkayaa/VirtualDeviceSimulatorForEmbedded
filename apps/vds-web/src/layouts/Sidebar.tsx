import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { useAdapters, useDevices } from '../api/queries'
import { navigationGroups } from './navigation'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

function NavCount({ to }: { to: string }) {
  const adapters = useAdapters()
  const devices = useDevices()
  if (to === '/adapters' && adapters.data) {
    const loaded = adapters.data.filter((adapter) => adapter.state === 'loaded').length
    return <span className="nav-count" title={`${loaded} of ${adapters.data.length} adapters loaded`}>{loaded}/{adapters.data.length}</span>
  }
  if (to === '/devices' && devices.data) {
    return <span className="nav-count" title={`${devices.data.length} device instances`}>{devices.data.length}</span>
  }
  return null
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <NavLink aria-label="VDS4E overview" className="wordmark" end to="/">
          <span aria-hidden="true">VDS<b>4E</b></span>
        </NavLink>
        <button
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="icon-button sm sidebar-toggle"
          onClick={onToggle}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>
      <nav aria-label="Primary navigation" className="sidebar-nav">
        {navigationGroups.map((group, index) => (
          <div className="nav-group" key={group.label ?? index}>
            {group.label && <span className="nav-group-label">{group.label}</span>}
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink className="nav-link" end={end} key={to} title={collapsed ? label : undefined} to={to}>
                <Icon aria-hidden="true" size={15} />
                <span className="nav-label">{label}</span>
                <NavCount to={to} />
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
