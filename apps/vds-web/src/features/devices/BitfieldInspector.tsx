import { Binary, RotateCcw, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Panel } from '../../components/Panel'
import type { DeviceRegister } from '../../types/api'
import { formatHex } from '../../utils/format'
import { accessLabel, canWrite } from './deviceModel'

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

const MAX_BITS = 32

function inspectableFields(register: DeviceRegister): InspectorField[] {
  const width = Math.min(register.width_bits, MAX_BITS)
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

/** Bit arithmetic without 32-bit bitwise operators so wide registers keep their upper bits. */
function bitAt(value: number, bit: number) {
  return Math.floor(value / 2 ** bit) % 2
}

function fieldValue(value: number, lsb: number, width: number) {
  return Math.floor(value / 2 ** lsb) % 2 ** width
}

function withField(value: number, lsb: number, width: number, next: number) {
  return value - fieldValue(value, lsb, width) * 2 ** lsb + next * 2 ** lsb
}

function parseHex(text: string, widthBits: number) {
  const trimmed = text.trim()
  if (!/^(0x)?[0-9a-f]+$/i.test(trimmed)) return null
  const value = Number.parseInt(trimmed.replace(/^0x/i, ''), 16)
  return Number.isSafeInteger(value) && value < 2 ** Math.min(widthBits, 53) ? value : null
}

function binaryGroups(value: number, width: number) {
  const bits = Array.from({ length: width }, (_, index) => bitAt(value, width - index - 1)).join('')
  return bits.replace(/(.{4})(?=.)/g, '$1 ')
}

function fieldRange(field: Pick<InspectorField, 'lsb' | 'width'>) {
  return field.width === 1 ? `${field.lsb}` : `${field.lsb + field.width - 1}:${field.lsb}`
}

export function BitfieldInspector({ errorMessage, isApplying = false, onApply, register }: BitfieldInspectorProps) {
  const [draftValue, setDraftValue] = useState(register?.value ?? 0)
  const [draftText, setDraftText] = useState(() => register ? formatHex(register.value, register.width_bits) : '')
  const [baseValue, setBaseValue] = useState(register?.value)
  // Follow live snapshot updates unless the user is holding an edited draft.
  if (register && register.value !== baseValue) {
    setBaseValue(register.value)
    if (draftValue === baseValue) {
      setDraftValue(register.value)
      setDraftText(formatHex(register.value, register.width_bits))
    }
  }

  const fields = useMemo(() => register ? inspectableFields(register) : [], [register])

  if (!register) {
    return (
      <Panel className="dv-bits" icon={Binary} title="Bitfield Inspector">
        <p className="dv-inspector-note">Select a register to inspect its bits.</p>
      </Panel>
    )
  }

  const width = Math.min(register.width_bits, MAX_BITS)
  const writable = Boolean(onApply) && canWrite(register.access)
  const dirty = draftValue !== register.value
  const fieldForBit = new Map<number, InspectorField>()
  fields.forEach((field) => {
    for (let bit = field.lsb; bit < field.lsb + field.width; bit += 1) fieldForBit.set(bit, field)
  })
  const rowWidth = width > 16 ? 16 : width
  const rows = Array.from({ length: Math.ceil(width / rowWidth) }, (_, index) => width - index * rowWidth - 1)

  const setDraft = (value: number) => {
    setDraftValue(value)
    setDraftText(formatHex(value, register.width_bits))
  }

  return (
    <Panel
      className="dv-bits"
      icon={Binary}
      meta={`${formatHex(register.address, 16)} · ${register.width_bits}b · ${accessLabel(register.access)}`}
      title="Bitfield Inspector"
      footer={(
        <>
          <span className={`dv-draft-label${dirty ? ' dirty' : ''}`}>Draft {formatHex(draftValue, register.width_bits)}</span>
          <span className="toolbar-spacer" />
          <button aria-label="Revert draft" className="icon-button sm" disabled={!dirty} onClick={() => setDraft(register.value)} title="Revert to current value" type="button">
            <Undo2 aria-hidden="true" size={13} />
          </button>
          {register.reset_value != null && (
            <button aria-label="Load reset value into draft" className="icon-button sm" disabled={!writable || draftValue === register.reset_value} onClick={() => setDraft(register.reset_value ?? 0)} title={`Load reset value ${formatHex(register.reset_value, register.width_bits)}`} type="button">
              <RotateCcw aria-hidden="true" size={13} />
            </button>
          )}
          <button
            className="button button-primary button-sm"
            disabled={!writable || !dirty || isApplying}
            onClick={() => onApply?.(draftValue)}
            title={canWrite(register.access) ? undefined : 'Register is not writable'}
            type="button"
          >
            {isApplying ? 'Applying' : 'Apply value'}
          </button>
        </>
      )}
    >
      <div className="dv-bits-summary">
        <strong className="truncate" title={register.name}>{register.name}</strong>
        <dl className="dv-bits-values">
          <div><dt>Current</dt><dd className="mono">{formatHex(register.value, register.width_bits)}</dd></div>
          <div><dt>Reset</dt><dd className="mono">{register.reset_value == null ? '—' : formatHex(register.reset_value, register.width_bits)}</dd></div>
          <div>
            <dt><label htmlFor="dv-draft-input">Draft</label></dt>
            <dd>
              <input
                aria-invalid={parseHex(draftText, register.width_bits) === null}
                aria-label="Register value draft"
                className="dv-draft-input"
                disabled={!writable}
                id="dv-draft-input"
                onChange={(event) => {
                  setDraftText(event.target.value)
                  const parsed = parseHex(event.target.value, register.width_bits)
                  if (parsed !== null) setDraftValue(parsed)
                }}
                spellCheck={false}
                value={draftText}
              />
            </dd>
          </div>
          <div><dt>Dec</dt><dd className="mono">{draftValue}</dd></div>
        </dl>
        {width <= MAX_BITS && <code className="dv-bits-binary">{binaryGroups(draftValue, width)}</code>}
      </div>
      {register.width_bits > MAX_BITS && <p className="dv-bits-note">Bit editing is limited to the lowest {MAX_BITS} bits.</p>}

      <div className="dv-bitgrid" role="group" aria-label="Bit editor">
        {rows.map((msb) => {
          const lsb = Math.max(0, msb - rowWidth + 1)
          const bits = Array.from({ length: msb - lsb + 1 }, (_, index) => msb - index)
          const segments: { field: InspectorField; span: number; start: number }[] = []
          bits.forEach((bit, index) => {
            const field = fieldForBit.get(bit)
            const last = segments[segments.length - 1]
            if (field && last?.field === field) last.span += 1
            else if (field) segments.push({ field, span: 1, start: index })
          })
          return (
            <div className="dv-bitgrid-row" key={msb} style={{ gridTemplateColumns: `repeat(${bits.length}, minmax(0, 1fr))` }}>
              {segments.map(({ field, span, start }) => (
                <span
                  aria-hidden="true"
                  className={`dv-bitgrid-field${field.undefined ? ' undefined' : ''}`}
                  data-label={field.undefined ? '' : field.name}
                  key={`${field.name}-${field.lsb}-${start}`}
                  style={{ gridColumn: `${start + 1} / span ${span}` }}
                  title={`${field.name} [${fieldRange(field)}]`}
                />
              ))}
              {bits.map((bit) => {
                const field = fieldForBit.get(bit)
                const value = bitAt(draftValue, bit)
                const changed = value !== bitAt(register.value, bit)
                const editable = writable && !field?.undefined && canWrite(field?.access ?? register.access)
                return (
                  <button
                    aria-label={`Bit ${bit}${field && !field.undefined ? ` (${field.name})` : ''}`}
                    aria-pressed={value === 1}
                    className={`dv-bit${value ? ' high' : ''}${changed ? ' changed' : ''}${field?.undefined ? ' undefined' : ''}${field && bit === field.lsb ? ' field-end' : ''}`}
                    disabled={!editable}
                    key={bit}
                    onClick={() => setDraft(withField(draftValue, bit, 1, value ? 0 : 1))}
                    type="button"
                  >
                    <small>{bit}</small>
                    <span>{value}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <table className="data-table dv-bits-table">
        <colgroup><col className="dv-bits-col-range" /><col className="dv-bits-col-field" /><col className="dv-bits-col-acc" /><col className="dv-bits-col-value" /><col /></colgroup>
        <thead><tr><th>Bits</th><th>Field</th><th>Acc</th><th>Value</th><th>Description</th></tr></thead>
        <tbody>{fields.map((field) => {
          const current = fieldValue(draftValue, field.lsb, field.width)
          const editable = writable && !field.undefined && canWrite(field.access)
          return (
            <tr className={field.undefined ? 'dv-bits-undefined' : undefined} key={`${field.name}-${field.lsb}`}>
              <td className="mono dim">{fieldRange(field)}</td>
              <td className="dv-bits-name" title={field.name}><strong>{field.name}</strong></td>
              <td className="mono dim">{field.undefined ? '—' : accessLabel(field.access)}</td>
              <td>
                {field.undefined
                  ? <span className="mono dim">{formatHex(current, field.width)}</span>
                  : field.width === 1
                    ? (
                      <select
                        aria-label={`Set ${field.name}`}
                        className="dv-bits-select"
                        disabled={!editable}
                        onChange={(event) => setDraft(withField(draftValue, field.lsb, 1, Number(event.target.value)))}
                        value={current.toString()}
                      >
                        <option value="0">0</option>
                        <option value="1">1</option>
                      </select>
                    )
                    : (
                      <input
                        aria-label={`Set ${field.name}`}
                        className="dv-bits-number"
                        disabled={!editable}
                        max={2 ** field.width - 1}
                        min={0}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          if (Number.isInteger(next) && next >= 0 && next < 2 ** field.width) setDraft(withField(draftValue, field.lsb, field.width, next))
                        }}
                        title={formatHex(current, field.width)}
                        type="number"
                        value={current}
                      />
                    )}
              </td>
              <td className="dv-bits-desc" title={field.description}>{field.description || <span className="faint">—</span>}</td>
            </tr>
          )
        })}</tbody>
      </table>
      {errorMessage && <p className="inline-alert error" role="alert">{errorMessage}</p>}
    </Panel>
  )
}
