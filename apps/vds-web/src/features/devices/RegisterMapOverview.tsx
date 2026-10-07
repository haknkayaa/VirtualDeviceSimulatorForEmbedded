import { Grid3X3 } from 'lucide-react'
import { useMemo } from 'react'

import { Panel } from '../../components/Panel'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'

interface RegisterMapOverviewProps {
  registers: DeviceRegister[]
  selectedAddress: number | null
  onSelect: (address: number) => void
}

const MIN_ROWS = 4
/** Above this many 16-byte rows only populated rows are drawn, so sparse maps stay small. */
const DENSE_ROW_LIMIT = 32

/** 16-column address-space map: each cell is one register address. */
export function RegisterMapOverview({ registers, selectedAddress, onSelect }: RegisterMapOverviewProps) {
  const { byAddress, rows } = useMemo(() => {
    const map = new Map(registers.map((register) => [register.address, register]))
    const highest = registers.reduce((max, register) => Math.max(max, register.address), 0)
    const rowCount = Math.max(MIN_ROWS, Math.floor(highest / 16) + 1)
    const starts = rowCount <= DENSE_ROW_LIMIT
      ? Array.from({ length: rowCount }, (_, index) => index * 16)
      : [...new Set(registers.map((register) => Math.floor(register.address / 16) * 16))].sort((left, right) => left - right)
    return { byAddress: map, rows: starts }
  }, [registers])

  return (
    <Panel className="dv-addrmap" icon={Grid3X3} meta={`${registers.length} mapped`} title="Address Map">
      <div aria-label="Register address overview" className="dv-addrmap-grid" role="group">
        <span aria-hidden="true" />
        {Array.from({ length: 16 }, (_, offset) => <span aria-hidden="true" className="dv-addrmap-col" key={offset}>{offset.toString(16).toUpperCase()}</span>)}
        {rows.map((startAddress) => (
          <div className="dv-addrmap-row" key={startAddress}>
            <span className="dv-addrmap-label">{formatHex(startAddress, 16)}</span>
            {Array.from({ length: 16 }, (_, offset) => {
              const address = startAddress + offset
              const register = byAddress.get(address)
              return register
                ? (
                  <button
                    aria-label={`${register.name} at ${formatHex(register.address, 16)}`}
                    aria-pressed={register.address === selectedAddress}
                    className={`dv-addrmap-cell access-${register.access.toLowerCase()}`}
                    key={address}
                    onClick={() => onSelect(register.address)}
                    title={`${formatHex(register.address, 16)} · ${register.name} · ${register.access.toUpperCase()}`}
                    type="button"
                  />
                )
                : <span aria-hidden="true" className="dv-addrmap-cell empty" key={address} />
            })}
          </div>
        ))}
      </div>
      <div className="dv-addrmap-legend">
        <span><i className="access-rw" /> R/W</span>
        <span><i className="access-ro" /> R</span>
        <span><i className="access-wo" /> W</span>
      </div>
    </Panel>
  )
}
