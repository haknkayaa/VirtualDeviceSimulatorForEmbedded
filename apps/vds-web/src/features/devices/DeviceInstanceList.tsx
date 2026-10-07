import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Device } from '../../types/api'
import { humanize } from '../../utils/format'
import { deviceStateTone, type AdapterAssignment } from './deviceModel'

interface DeviceInstanceListProps {
  assignments: Map<string, AdapterAssignment>
  devices: Device[]
  errorMessage?: string
  isLoading: boolean
  selectedId?: string
}

const busOrder = ['spi', 'qspi', 'i2c', 'gpio', 'uart', 'ethernet']

function busRank(bus: string) {
  const index = busOrder.indexOf(bus)
  return index === -1 ? busOrder.length : index
}

export function DeviceInstanceList({
  assignments,
  devices,
  errorMessage,
  isLoading,
  selectedId,
}: DeviceInstanceListProps) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const byBus = new Map<string, Device[]>()
    for (const device of devices) {
      const path = assignments.get(device.id)?.binding.device_path ?? ''
      if (term && ![device.id, device.name ?? '', device.bus, device.type ?? '', path].some((value) => value.toLowerCase().includes(term))) continue
      const bus = device.bus.toLowerCase()
      byBus.set(bus, [...(byBus.get(bus) ?? []), device])
    }
    return [...byBus.entries()].sort(([left], [right]) => busRank(left) - busRank(right) || left.localeCompare(right))
  }, [assignments, devices, filter])
  const shown = groups.reduce((total, [, items]) => total + items.length, 0)

  return (
    <aside aria-label="Device instances" className="dv-list">
      <header className="dv-list-head">
        <h2 className="panel-title">Instances</h2>
        <span className="count">{filter ? `${shown}/${devices.length}` : devices.length}</span>
      </header>
      <div className="dv-list-filter">
        <label className="search-input">
          <Search aria-hidden="true" size={12} />
          <span className="sr-only">Filter devices</span>
          <input onChange={(event) => setFilter(event.target.value)} placeholder="Filter id, bus, /dev…" type="search" value={filter} />
        </label>
      </div>

      <nav aria-label="Loaded devices" className="dv-list-body">
        {isLoading && <p className="dv-list-message">Loading device instances…</p>}
        {errorMessage && <p className="dv-list-message text-err">{errorMessage}</p>}
        {!isLoading && !errorMessage && devices.length === 0 && <p className="dv-list-message">No device instances are loaded.</p>}
        {!isLoading && devices.length > 0 && shown === 0 && <p className="dv-list-message">No device matches “{filter}”.</p>}
        {groups.map(([bus, items]) => (
          <section className="dv-list-group" key={bus}>
            <h3 className={`dv-list-group-title bus-${bus}`}><i aria-hidden="true" />{bus}<span className="count">{items.length}</span></h3>
            {items.map((device) => {
              const active = device.id === selectedId
              const assignment = assignments.get(device.id)
              const exposed = assignment?.adapter.state === 'loaded'
              const label = device.name && device.name !== device.id ? device.name : undefined
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`dv-list-row${active ? ' active' : ''}`}
                  key={device.id}
                  title={`${device.id} · ${device.state ? humanize(device.state) : 'state unknown'}`}
                  to={`/devices/${encodeURIComponent(device.id)}`}
                >
                  <i aria-hidden="true" className={`status-dot ${deviceStateTone(device.state)}`} />
                  <span className="dv-list-row-main">
                    {label && <strong className="truncate">{label}</strong>}
                    <code className="truncate">{device.id}</code>
                  </span>
                  <span className={`dv-list-row-node${exposed ? ' exposed' : ''}`}>
                    {assignment ? assignment.binding.device_path.replace('/dev/', '') : '—'}
                  </span>
                </Link>
              )
            })}
          </section>
        ))}
      </nav>
    </aside>
  )
}
