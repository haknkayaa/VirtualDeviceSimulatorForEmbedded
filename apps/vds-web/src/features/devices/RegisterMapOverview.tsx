import { Grid3X3 } from 'lucide-react'

import { GlassPanel } from '../../components/GlassPanel'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'

interface RegisterMapOverviewProps {
  registers: DeviceRegister[]
  selectedAddress: number | null
  onSelect: (address: number) => void
}

export function RegisterMapOverview({ registers, selectedAddress, onSelect }: RegisterMapOverviewProps) {
  const registersByAddress = new Map(registers.map((register) => [register.address, register]))
  const highestAddress = registers.reduce((highest, register) => Math.max(highest, register.address), 0)
  const rowCount = Math.max(4, Math.floor(highestAddress / 16) + 1)

  return (
    <GlassPanel className="register-map-overview" title="Register Map Overview" action={<Grid3X3 aria-hidden="true" size={15} />}>
      <div aria-label="Register address overview" className="register-sector-grid">
        {Array.from({ length: rowCount }, (_, rowIndex) => {
          const startAddress = rowIndex * 16
          return (
            <div className="register-sector-row" key={startAddress}>
              <span>{formatHex(startAddress, 16)}</span>
              <div className="register-sector-cells">
                {Array.from({ length: 16 }, (_, offset) => {
                  const address = startAddress + offset
                  const register = registersByAddress.get(address)
                  return register
                    ? (
                      <button
                        aria-label={`${register.name} at ${formatHex(register.address, 16)}`}
                        className={`register-sector access-${register.access.toLowerCase()}${register.address === selectedAddress ? ' selected' : ''}`}
                        key={address}
                        onClick={() => onSelect(register.address)}
                        title={`${formatHex(register.address, 16)} · ${register.name} · ${register.access.toUpperCase()}`}
                        type="button"
                      />
                    )
                    : <span aria-hidden="true" className="register-sector empty" key={address} />
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="register-overview-legend">
        <span><i className="access-rw" /> R/W</span>
        <span><i className="access-ro" /> R</span>
        <span><i className="access-wo" /> W</span>
      </div>
    </GlassPanel>
  )
}
