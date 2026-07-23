import { Cpu, Library, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { Device } from '../../types/api'
import { humanize } from '../../utils/format'

interface DeviceInstanceListProps {
  devices: Device[]
  errorMessage?: string
  isLoading: boolean
  selectedId?: string
}

export function DeviceInstanceList({
  devices,
  errorMessage,
  isLoading,
  selectedId,
}: DeviceInstanceListProps) {
  const [showAddHelp, setShowAddHelp] = useState(false)

  return (
    <aside aria-label="Device instances" className="glass-panel device-instance-panel">
      <header className="device-instance-header">
        <div>
          <span>Runtime inventory</span>
          <strong>Device Instances</strong>
        </div>
        <span className="device-instance-count">{devices.length}</span>
      </header>

      <button
        aria-expanded={showAddHelp}
        className="button button-primary device-add-button"
        onClick={() => setShowAddHelp((visible) => !visible)}
        type="button"
      >
        <Plus aria-hidden="true" size={15} /> Add Device
      </button>

      {showAddHelp && (
        <section className="device-add-help" role="status">
          <Library aria-hidden="true" size={17} />
          <div>
            <strong>Choose an installed model</strong>
            <span>Device creation requires runtime instance API support. Browse the installed catalog in the meantime.</span>
            <Link to="/device-library">Open Device Library</Link>
          </div>
        </section>
      )}

      <nav aria-label="Loaded devices" className="device-instance-list">
        {isLoading && <span className="device-instance-message">Loading device instances…</span>}
        {errorMessage && <span className="device-instance-message error">{errorMessage}</span>}
        {!isLoading && !errorMessage && devices.length === 0 && (
          <span className="device-instance-message">No device instances are loaded.</span>
        )}
        {devices.map((device) => {
          const active = device.id === selectedId
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`device-instance-link${active ? ' active' : ''}`}
              key={device.id}
              to={`/devices/${encodeURIComponent(device.id)}`}
            >
              <span className="device-instance-icon"><Cpu aria-hidden="true" size={17} /></span>
              <span className="device-instance-copy">
                <strong>{device.name ?? device.id}</strong>
                <small>{device.id}</small>
                <span>{device.bus.toUpperCase()} · {humanize(device.type ?? 'Device')}</span>
              </span>
              <span className={`device-instance-status${device.state ? ' online' : ''}`}>
                <i aria-hidden="true" /> {device.state ? humanize(device.state) : 'Unknown'}
              </span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
