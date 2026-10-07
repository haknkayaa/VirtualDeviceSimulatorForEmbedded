import { type KeyboardEvent, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw, Search } from 'lucide-react'

import { AsyncState } from '../../components/AsyncState'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'
import { accessLabel } from './deviceModel'

interface RegisterMapProps {
  registers: DeviceRegister[]
  selectedAddress: number | null
  onSelect: (address: number) => void
  /** Re-read the register snapshot from the runtime. */
  onRefresh?: () => void
  isRefreshing?: boolean
  /** Rows per page; large maps paginate instead of rendering thousands of rows. */
  pageSize?: number
}

type SearchField = 'all' | 'name' | 'address' | 'description'
const DEFAULT_PAGE_SIZE = 128

function isModified(register: DeviceRegister) {
  return register.reset_value != null && register.reset_value !== register.value
}

/** Addresses whose value differs between two consecutive snapshots. */
function changedAddresses(previous: DeviceRegister[], next: DeviceRegister[]) {
  const before = new Map(previous.map((register) => [register.address, register.value]))
  const changed = new Set<number>()
  for (const register of next) {
    const old = before.get(register.address)
    if (old !== undefined && old !== register.value) changed.add(register.address)
  }
  return changed
}

export function RegisterMap({ registers, selectedAddress, onSelect, onRefresh, isRefreshing = false, pageSize = DEFAULT_PAGE_SIZE }: RegisterMapProps) {
  const [search, setSearch] = useState('')
  const [access, setAccess] = useState('all')
  const [field, setField] = useState<SearchField>('all')
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(false)
  const [snapshot, setSnapshot] = useState(registers)
  const [changed, setChanged] = useState<Set<number>>(() => new Set())
  if (snapshot !== registers) {
    setSnapshot(registers)
    setChanged(changedAddresses(snapshot, registers))
  }

  const modifiedCount = useMemo(() => registers.filter(isModified).length, [registers])
  const filteredRegisters = useMemo(() => {
    const term = search.trim().toLowerCase()
    return registers.filter((register) => {
      const normalizedAccess = register.access.toLowerCase()
      if (access !== 'all' && normalizedAccess !== access) return false
      if (modifiedOnly && !isModified(register)) return false
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
  const pageCount = Math.max(1, Math.ceil(filteredRegisters.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRegisters = filteredRegisters.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = visibleRegisters.findIndex((register) => register.address === selectedAddress)
    const nextIndex = index === -1 ? 0 : Math.max(0, Math.min(visibleRegisters.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    const next = visibleRegisters[nextIndex]
    if (next) onSelect(next.address)
  }

  return (
    <section aria-label="Register map" className={`panel dv-regmap${expanded ? ' expanded' : ''}`}>
      <header className="panel-header">
        <h2 className="panel-title">Register Map</h2>
        <span className="panel-meta">{registers.length} registers{modifiedCount ? ` · ${modifiedCount} ≠ reset` : ''}</span>
        <div className="panel-actions">
          {onRefresh && (
            <button aria-label="Read registers" className="icon-button sm" disabled={isRefreshing} onClick={onRefresh} title="Re-read register snapshot" type="button">
              <RefreshCw aria-hidden="true" className={isRefreshing ? 'spin' : ''} size={13} />
            </button>
          )}
          <button
            aria-label={expanded ? 'Collapse register map' : 'Expand register map'}
            className="icon-button sm"
            onClick={() => setExpanded((current) => !current)}
            title={expanded ? 'Restore layout' : 'Maximize register map'}
            type="button"
          >
            {expanded ? <Minimize2 aria-hidden="true" size={13} /> : <Maximize2 aria-hidden="true" size={13} />}
          </button>
        </div>
      </header>
      <div className="toolbar dv-subbar">
        <label className="search-input dv-regmap-search">
          <Search aria-hidden="true" size={12} />
          <span className="sr-only">Search registers</span>
          <input onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Name, 0x addr, description" type="search" value={search} />
        </label>
        <select aria-label="Search field" onChange={(event) => { setField(event.target.value as SearchField); setPage(1) }} value={field}>
          <option value="all">All fields</option>
          <option value="name">Name</option>
          <option value="address">Address</option>
          <option value="description">Description</option>
        </select>
        <select aria-label="Filter by access" onChange={(event) => { setAccess(event.target.value); setPage(1) }} value={access}>
          <option value="all">Any access</option>
          <option value="ro">R (read only)</option>
          <option value="rw">R/W</option>
          <option value="wo">W (write only)</option>
        </select>
        <label className="field-inline dv-check">
          <input checked={modifiedOnly} onChange={(event) => { setModifiedOnly(event.target.checked); setPage(1) }} type="checkbox" />
          <span>≠ reset only</span>
        </label>
      </div>
      {filteredRegisters.length === 0
        ? <AsyncState detail="Adjust the search or filter controls." kind="empty" title="No matching registers" />
        : (
          <div aria-label="Registers" className="dv-table-scroll" onKeyDown={moveSelection} role="region" tabIndex={0}>
            <table className="data-table dv-regmap-table">
              <thead>
                <tr>
                  <th>Addr</th>
                  <th>Name</th>
                  <th>Acc</th>
                  <th className="num">Value</th>
                  <th className="num">Reset</th>
                  <th className="num dv-col-bits">Bits</th>
                  <th className="dv-regmap-desc">Description</th>
                </tr>
              </thead>
              <tbody>{visibleRegisters.map((register) => {
                const modified = isModified(register)
                return (
                  <tr
                    aria-selected={register.address === selectedAddress}
                    className={`clickable${register.address === selectedAddress ? ' selected' : ''}`}
                    key={register.address}
                    onClick={() => onSelect(register.address)}
                  >
                    <td className="mono dim">{formatHex(register.address, 16)}</td>
                    <td className="dv-regmap-name" title={register.name}><strong>{register.name}</strong></td>
                    <td className={`mono dv-access access-${register.access.toLowerCase()}`}>{accessLabel(register.access)}</td>
                    <td className="num">
                      <span
                        className={`register-current-value mono${modified ? ' dv-modified' : ''}${changed.has(register.address) ? ' dv-changed' : ''}`}
                        key={register.value}
                        title={modified ? 'Differs from reset value' : undefined}
                      >
                        {formatHex(register.value, register.width_bits)}
                      </span>
                    </td>
                    <td className="num dim">{register.reset_value == null ? '—' : formatHex(register.reset_value, register.width_bits)}</td>
                    <td className="num dim dv-col-bits">{register.width_bits}</td>
                    <td className="dv-regmap-desc" title={register.description}>{register.description ?? <span className="faint">—</span>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      {filteredRegisters.length > pageSize && (
        <nav aria-label="Register pages" className="dv-pager">
          <button aria-label="Previous page" className="icon-button sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} type="button"><ChevronLeft aria-hidden="true" size={13} /></button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
            <button
              aria-current={number === currentPage ? 'page' : undefined}
              className="dv-pager-page"
              key={number}
              onClick={() => setPage(number)}
              type="button"
            >
              {number}
            </button>
          ))}
          <button aria-label="Next page" className="icon-button sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} type="button"><ChevronRight aria-hidden="true" size={13} /></button>
          <span className="count">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRegisters.length)} of {filteredRegisters.length}</span>
        </nav>
      )}
    </section>
  )
}
