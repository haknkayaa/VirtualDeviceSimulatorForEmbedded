import { useMemo, useState } from 'react'

import { GlassPanel } from '../../components/GlassPanel'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'

interface BitfieldInspectorProps {
  errorMessage?: string
  isApplying?: boolean
  onApply?: (value: number) => void
  register: DeviceRegister | undefined
}

interface InspectorField {
  name: string
  lsb: number
  width: number
  access: string
  description?: string
  undefined?: boolean
}

function canWrite(access: string) {
  return access.toLowerCase().includes('w')
}

function inspectableFields(register: DeviceRegister): InspectorField[] {
  const width = Math.min(register.width_bits, 32)
  const defined = (register.bitfields ?? [])
    .filter((field) => field.width > 0 && field.lsb < width && field.lsb + field.width > 0)
    .map((field) => ({
      ...field,
      lsb: Math.max(0, field.lsb),
      width: Math.min(width, field.lsb + field.width) - Math.max(0, field.lsb),
    }))

  if (!defined.length) {
    return Array.from({ length: width }, (_, index) => ({
      name: `BIT${width - index - 1}`,
      lsb: width - index - 1,
      width: 1,
      access: register.access,
      description: 'Bit metadata not exposed',
    }))
  }

  const occupied = new Set<number>()
  defined.forEach((field) => {
    for (let bit = field.lsb; bit < field.lsb + field.width; bit += 1) occupied.add(bit)
  })

  const undefinedFields: InspectorField[] = []
  let bit = 0
  while (bit < width) {
    if (occupied.has(bit)) {
      bit += 1
      continue
    }
    const lsb = bit
    while (bit < width && !occupied.has(bit)) bit += 1
    undefinedFields.push({
      name: 'UNDEFINED',
      lsb,
      width: bit - lsb,
      access: '—',
      description: 'No bitfield metadata is defined for this bit range.',
      undefined: true,
    })
  }

  return [...defined, ...undefinedFields].sort((left, right) => right.lsb - left.lsb)
}

export function BitfieldInspector({ errorMessage, isApplying = false, onApply, register }: BitfieldInspectorProps) {
  const [draftValue, setDraftValue] = useState(register?.value ?? 0)

  const fields = useMemo(() => register ? inspectableFields(register) : [], [register])

  if (!register) {
    return <GlassPanel className="bitfield-inspector" title="Bitfield Inspector"><p className="inspector-empty">Select a register to inspect its bits.</p></GlassPanel>
  }

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
      action={(
        <div className="inspector-header-actions">
          <span className="inspector-draft-badge">Draft {formatHex(draftValue, register.width_bits)}</span>
          <button
            className="button button-primary"
            disabled={!onApply || !canWrite(register.access) || draftValue === register.value || isApplying}
            onClick={() => onApply?.(draftValue)}
            type="button"
          >
            {isApplying ? 'Applying' : 'Apply value'}
          </button>
        </div>
      )}
    >
      <div className="inspector-register-summary">
        <div><span>Selected register</span><strong><b>{formatHex(register.address, 16)}</b> {register.name}</strong></div>
        <div><span>Current value</span><strong className="mono">{formatHex(register.value, register.width_bits)}</strong></div>
      </div>
      {register.width_bits > 32 && <p className="inspector-note">Inspector preview is limited to the lowest 32 bits.</p>}
      <div className="bitfield-table-scroll">
        <table className="bitfield-table">
          <thead><tr><th>Bit</th><th>Field</th><th>Access</th><th>Value</th><th>Description</th></tr></thead>
          <tbody>{fields.map((field) => {
            const fieldValue = Math.floor(draftValue / 2 ** field.lsb) % 2 ** field.width
            const singleBit = field.width === 1
            return (
            <tr className={field.undefined ? 'undefined-bitfield-row' : undefined} key={`${field.name}-${field.lsb}`}>
              <td className="mono">{field.width === 1 ? field.lsb : `${field.lsb + field.width - 1}:${field.lsb}`}</td>
              <td><strong>{field.name}</strong></td>
              <td><span className={field.undefined ? 'register-access' : `register-access access-${field.access.toLowerCase()}`}>{field.access.toUpperCase()}</span></td>
              <td>
                {singleBit && !field.undefined ? (
                  <select
                    aria-label={`Set ${field.name}`}
                    disabled={!canWrite(field.access)}
                    onChange={(event) => setBit(field.lsb, Number(event.target.value))}
                    value={fieldValue.toString()}
                  >
                    <option value="0">0</option>
                    <option value="1">1</option>
                  </select>
                ) : <span className="mono">{formatHex(fieldValue, field.width)}</span>}
              </td>
              <td>{field.description || 'No field description exposed'}</td>
            </tr>
          )})}</tbody>
        </table>
      </div>
      {errorMessage && <p className="inspector-write-error" role="alert">{errorMessage}</p>}
    </GlassPanel>
  )
}
