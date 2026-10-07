import { Activity, AudioWaveform, Bell, Boxes, Cable, CircleHelp, Gauge, LibraryBig, Moon, Radio, ScrollText, Settings, Sun, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { BrandLogo } from '../components/BrandLogo'
import { EventDetailDrawer } from '../components/EventDetailDrawer'
import { StatusBadge } from '../components/StatusBadge'
import { useAdapters, useClock, useDevices } from '../api/queries'
import { useEventStore } from '../stores/eventStore'
import { useTheme } from '../hooks/useTheme'
import { attachedDevices } from '../utils/adapterBindings'
import { formatVirtualTime } from '../utils/format'

const navigation = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/devices', label: 'Devices', icon: Boxes, end: false },
  { to: '/adapters', label: 'Adapters', icon: Cable, end: false },
  { to: '/transactions', label: 'Transactions', icon: Activity, end: false },
  { to: '/waveform', label: 'Logic Analyzer', icon: AudioWaveform, end: false },
  { to: '/device-library', label: 'Device Library', icon: LibraryBig, end: false },
  { to: '/logs', label: 'Logs', icon: ScrollText, end: false },
] as const

const workspaceNavigation = [
  { to: '/', label: 'Overview', end: true },
  { to: '/devices', label: 'Devices', end: false },
  { to: '/adapters', label: 'Adapters', end: false },
  { to: '/transactions', label: 'Transactions', end: false },
  { to: '/waveform', label: 'Logic Analyzer', end: false },
  { to: '/device-library', label: 'Device Library', end: false },
  { to: '/logs', label: 'Logs', end: false },
] as const

const currentYear = new Date().getFullYear()

export function AppShell() {
  const { theme, toggleTheme } = useTheme()
  const adapters = useAdapters()
  const clock = useClock()
  const devices = useDevices()
  const visibleDevices = useMemo(
    () => attachedDevices(devices.data, adapters.data),
    [adapters.data, devices.data],
  )
  const deviceInventoryPending = devices.isPending || adapters.isPending
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const virtualTime = clock.data?.virtual_time_ns ?? 0
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
          </dl>
          <div className="sidebar-resource-groups">
            <section>
              <header><Cable aria-hidden="true" size={13} /><strong>Adapters</strong><span>{adapters.data?.length ?? 0}</span></header>
              <div className="sidebar-resource-list">
                {adapters.isPending && <small>Loading adapters…</small>}
                {adapters.data?.map((adapter) => {
                  const online = adapter.state === 'loaded'
                  return (
                    <div className="sidebar-resource-row" key={adapter.id}>
                      <i className={online ? 'online' : adapter.state === 'error' ? 'error' : 'offline'} />
                      <strong title={adapter.name}>{adapter.name}</strong>
                      <span>{online ? 'Online' : adapter.state === 'error' ? 'Error' : 'Offline'}</span>
                    </div>
                  )
                })}
                {!adapters.isPending && adapters.data?.length === 0 && <small>No adapters</small>}
              </div>
            </section>
            <section>
              <header><Boxes aria-hidden="true" size={13} /><strong>Devices</strong><span>{visibleDevices.length}</span></header>
              <div className="sidebar-resource-list">
                {deviceInventoryPending && <small>Loading devices…</small>}
                {visibleDevices.map((device) => {
                  const adapterLoaded = adapters.data?.some(
                    (adapter) => adapter.state === 'loaded'
                      && adapter.bindings.some((binding) => binding.device_id === device.id),
                  )
                  return (
                    <div className="sidebar-resource-row" key={device.id}>
                      <i className={adapterLoaded ? 'online' : 'offline'} />
                      <strong title={device.id}>{device.name ?? device.id}</strong>
                      <span>{adapterLoaded ? 'Attached' : 'Offline'}</span>
                    </div>
                  )
                })}
                {!deviceInventoryPending && visibleDevices.length === 0 && <small>No attached devices</small>}
              </div>
            </section>
          </div>
        </div>
        <div className="workspace-identity">
          <label className="environment-context sidebar-environment">
            <span>Environment</span>
            <select aria-label="Environment" defaultValue="local">
              <option value="local">Local simulator</option>
              <option disabled value="new">+ New Environment</option>
            </select>
          </label>
        </div>
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
            <div className="account-context">
              <span aria-label="Anonymous profile image" className="account-avatar" role="img"><UserRound aria-hidden="true" size={18} /></span>
              <div>
                <div className="account-tier-row"><small>Account</small><span className="account-tier">Pro+</span></div>
                <strong>Hakan Kaya</strong>
              </div>
            </div>
          </div>
        </header>
        <main className="main-content"><Outlet /></main>
        <footer className="app-footer">
          <div>
            <strong>VDS<span>4E</span></strong>
            <span>Virtual Device Simulator for Embedded</span>
          </div>
          <span className="footer-credit">
            Crafted by <a href="https://www.hakankaya.kim" rel="noreferrer" target="_blank">Hakan Kaya</a>
          </span>
          <div>
            <code>v0.1.0-alpha</code>
            <span>Local Control Panel</span>
            <span>© {currentYear} VDS4E</span>
          </div>
        </footer>
      </div>
      <EventDetailDrawer />
    </div>
  )
}
