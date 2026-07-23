import { useMemo, useState } from 'react'

import { GlassPanel } from '../../components/GlassPanel'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'

interface BitfieldInspectorProps {
  register: DeviceRegister | undefined
}

function canWrite(access: string) {
  return access.toLowerCase().includes('w')
}

export function BitfieldInspector({ register }: BitfieldInspectorProps) {
  const [draftValue, setDraftValue] = useState(register?.value ?? 0)

  const bits = useMemo(() => {
    if (!register) return []
    const width = Math.min(register.width_bits, 32)
    return Array.from({ length: width }, (_, index) => width - index - 1)
  }, [register])

  if (!register) {
    return <GlassPanel className="bitfield-inspector" title="Bitfield Inspector"><p className="inspector-empty">Select a register to inspect its bits.</p></GlassPanel>
  }

  const writable = canWrite(register.access)
  const setBit = (bit: number, value: number) => {
    const mask = 2 ** bit
    setDraftValue((current) => {
      const currentBit = Math.floor(current / mask) % 2
      if (value === currentBit) return current
      return value ? current + mask : current - mask
    })
  }

  return (
    <GlassPanel
      className="bitfield-inspector"
      title="Bitfield Inspector"
      action={<span className="inspector-draft-badge">Draft {formatHex(draftValue, register.width_bits)}</span>}
    >
      <div className="inspector-register-summary">
        <div><span>Selected register</span><strong><b>{formatHex(register.address, 16)}</b> {register.name}</strong></div>
        <div><span>Current value</span><strong className="mono">{formatHex(register.value, register.width_bits)}</strong></div>
      </div>
      {register.width_bits > 32 && <p className="inspector-note">Inspector preview is limited to the lowest 32 bits.</p>}
      <div className="bitfield-table-scroll">
        <table className="bitfield-table">
          <thead><tr><th>Bit</th><th>Field</th><th>Access</th><th>Value</th><th>Description</th></tr></thead>
          <tbody>{bits.map((bit) => (
            <tr key={bit}>
              <td className="mono">{bit}</td>
              <td><strong>BIT{bit}</strong></td>
              <td><span className={`register-access access-${register.access.toLowerCase()}`}>{register.access.toUpperCase()}</span></td>
              <td>
                <select
                  aria-label={`Set BIT${bit}`}
                  disabled={!writable}
                  onChange={(event) => setBit(bit, Number(event.target.value))}
                  value={(Math.floor(draftValue / 2 ** bit) & 1).toString()}
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                </select>
              </td>
              <td>{register.description ? `${register.name} bit ${bit}` : 'Bit metadata not exposed'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="inspector-write-footer">
        <span>Draft editing only. Register writes are not exposed by the Control API.</span>
        <button className="button button-primary" disabled title="No approved register write API is available." type="button">Apply value</button>
      </div>
    </GlassPanel>
  )
}
