import { useMemo, useState } from 'react'
import { Maximize2, Minimize2, Search } from 'lucide-react'

import { AsyncState } from '../../components/AsyncState'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'

interface RegisterMapProps {
  registers: DeviceRegister[]
  selectedAddress: number | null
  onSelect: (address: number) => void
}

type SearchField = 'all' | 'name' | 'address' | 'description'
const PAGE_SIZE = 8

function accessLabel(access: string) {
  const normalized = access.toLowerCase()
  if (normalized === 'rw') return 'R/W'
  if (normalized === 'ro') return 'R'
  if (normalized === 'wo') return 'W'
  return access.toUpperCase()
}

export function RegisterMap({ registers, selectedAddress, onSelect }: RegisterMapProps) {
  const [search, setSearch] = useState('')
  const [access, setAccess] = useState('all')
  const [field, setField] = useState<SearchField>('all')
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(false)

  const filteredRegisters = useMemo(() => {
    const term = search.trim().toLowerCase()
    return registers.filter((register) => {
      const normalizedAccess = register.access.toLowerCase()
      if (access !== 'all' && normalizedAccess !== access) return false
      if (modifiedOnly && (register.reset_value == null || register.reset_value === register.value)) return false
      if (!term) return true
      const values: Record<Exclude<SearchField, 'all'>, string> = {
        name: register.name,
        address: formatHex(register.address, 16),
        description: register.description ?? '',
      }
      return field === 'all'
        ? Object.values(values).some((value) => value.toLowerCase().includes(term))
        : values[field].toLowerCase().includes(term)
    })
  }, [access, field, modifiedOnly, registers, search])
  const pageCount = Math.max(1, Math.ceil(filteredRegisters.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleRegisters = filteredRegisters.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <section className={`glass-panel register-map-panel${expanded ? ' expanded' : ''}`}>
      <header className="register-map-toolbar">
        <div className="register-map-title">
          <h2>Register Map</h2>
          <span>{registers.length} Registers</span>
        </div>
        <label className="register-search">
          <Search aria-hidden="true" size={14} />
          <span className="sr-only">Search registers</span>
          <input onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search registers..." type="search" value={search} />
        </label>
        <select aria-label="Filter by access" onChange={(event) => { setAccess(event.target.value); setPage(1) }} value={access}>
          <option value="all">All Access</option>
          <option value="ro">Read only</option>
          <option value="rw">Read / Write</option>
          <option value="wo">Write only</option>
        </select>
        <select aria-label="Search field" onChange={(event) => { setField(event.target.value as SearchField); setPage(1) }} value={field}>
          <option value="all">All Fields</option>
          <option value="name">Register Name</option>
          <option value="address">Address</option>
          <option value="description">Description</option>
        </select>
        <label className="modified-filter">
          <input checked={modifiedOnly} onChange={(event) => { setModifiedOnly(event.target.checked); setPage(1) }} type="checkbox" />
          <span>Show Modified Only</span>
        </label>
        <button
          aria-label={expanded ? 'Collapse register map' : 'Expand register map'}
          className="icon-button register-expand-button"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? <Minimize2 aria-hidden="true" size={15} /> : <Maximize2 aria-hidden="true" size={15} />}
        </button>
      </header>
      {filteredRegisters.length === 0
        ? <AsyncState detail="Adjust the search or filter controls." kind="empty" title="No matching registers" />
        : (
          <div className="table-scroll register-map-scroll">
            <table className="register-map-table">
              <thead><tr><th>Address</th><th>Register Name</th><th>Access</th><th>Reset Value</th><th>Current Value</th><th>Description</th></tr></thead>
              <tbody>{visibleRegisters.map((register) => (
                <tr
                  aria-selected={register.address === selectedAddress}
                  className={register.address === selectedAddress ? 'selected' : ''}
                  key={register.address}
                  onClick={() => onSelect(register.address)}
                >
                  <td className="mono register-address">{formatHex(register.address, 16)}</td>
                  <td><strong>{register.name}</strong></td>
                  <td><span className={`register-access access-${register.access.toLowerCase()}`}>{accessLabel(register.access)}</span></td>
                  <td className="mono">{register.reset_value == null ? '—' : formatHex(register.reset_value, register.width_bits)}</td>
                  <td><span className="register-current-value mono">{formatHex(register.value, register.width_bits)}</span></td>
                  <td className="register-description">{register.description ?? 'No description exposed'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      {filteredRegisters.length > PAGE_SIZE && (
        <nav aria-label="Register pages" className="register-pagination">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
            <button
              aria-current={number === currentPage ? 'page' : undefined}
              key={number}
              onClick={() => setPage(number)}
              type="button"
            >
              {number}
            </button>
          ))}
        </nav>
      )}
    </section>
  )
}
