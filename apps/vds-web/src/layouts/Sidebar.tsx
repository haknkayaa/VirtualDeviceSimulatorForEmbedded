import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { navigationItems } from './navigation'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav aria-label="Primary navigation" className="sidebar-nav">
        {navigationItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink className="nav-link" end={end} key={to} title={collapsed ? label : undefined} to={to}>
            <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <button
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        type="button"
      >
        {collapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
        <span className="nav-label">Collapse</span>
      </button>
    </aside>
  )
}
