import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { AsyncState } from '../components/AsyncState'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { useTheme } from '../hooks/useTheme'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

const SIDEBAR_KEY = 'vds4e-sidebar-collapsed'

function readCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  const { theme, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleSidebar = () => setCollapsed((current) => {
    const next = !current
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
    } catch {
      // Collapse state is a per-browser convenience only.
    }
    return next
  })

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <main className="workspace">
        <Suspense fallback={<AsyncState centered kind="loading" title="Loading view" />}>
          <Outlet />
        </Suspense>
      </main>
      <StatusBar onToggleTheme={toggleTheme} theme={theme} />
      <EventDetailDrawer />
    </div>
  )
}
