import type { ReactNode } from 'react'

import { useDevices, useFaults, useRegisters } from '../../../../api/queries'
import type { NodeInspectorProps } from '../../../flows/types/flow'
import { SCENARIO_NODE_KINDS, TIME_UNITS } from '../types/scenarioFlow'

const EVENT_TYPES = ['device_operation_started', 'device_operation_completed', 'state_transition', 'fault_triggered', 'fault_delay_completed']

const MONO_KEYS = new Set(['step_id', 'tx_hex', 'save_as', 'expected', 'expected_state', 'source', 'expected_hex', 'expected_code'])

function TextField({ label, value, disabled, onCommit, type = 'text', mono = false, placeholder, children }: { label: string; value: string | number; disabled: boolean; onCommit: (value: string) => void; type?: string; mono?: boolean; placeholder?: string; children?: ReactNode }) {
  return <label className="flow-field"><span>{label}</span><input className={mono ? 'mono' : undefined} defaultValue={String(value)} disabled={disabled} key={String(value)} onBlur={(event) => { if (event.target.value !== String(value)) onCommit(event.target.value) }} placeholder={placeholder} spellCheck={mono ? false : undefined} type={type} />{children}</label>
}

function SelectField({ label, value, disabled, options, onCommit, status }: { label: string; value: string; disabled: boolean; options: { value: string; label: string }[]; onCommit: (value: string) => void; status?: string }) {
  const known = options.some((item) => item.value === value)
  return <label className="flow-field"><span>{label}</span><select disabled={disabled} onChange={(event) => onCommit(event.target.value)} value={value}>
    <option value="">Select…</option>{value && !known && <option value={value}>Missing: {value}</option>}{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
  </select>{status && <small className="flow-note flow-field-full">{status}</small>}</label>
}

function value(node: NodeInspectorProps['node'], key: string) {
  const found = node.data[key]
  return typeof found === 'string' || typeof found === 'number' ? found : ''
}

export function ScenarioNodeInspector({ node, readOnly, updateData }: NodeInspectorProps) {
  const devices = useDevices()
  const faults = useFaults()
  const deviceId = String(value(node, 'device_id'))
  const registers = useRegisters(deviceId || undefined)
  const field = (label: string, key: string, type = 'text', placeholder?: string) => <TextField disabled={readOnly} label={label} mono={type === 'number' || MONO_KEYS.has(key)} onCommit={(next) => updateData({ [key]: type === 'number' ? (next === '' ? null : Number(next)) : next })} placeholder={placeholder} type={type} value={value(node, key)} />
  const label = field('Label', 'label')
  const stepId = ![SCENARIO_NODE_KINDS.start, SCENARIO_NODE_KINDS.end].includes(node.kind as never) ? field('Step ID', 'step_id', 'text', 'auto') : null
  const resourceStatus = (query: { isLoading: boolean; isError: boolean }) => query.isLoading ? 'Loading snapshot…' : query.isError ? 'Snapshot unavailable; authored value preserved.' : undefined
  const device = <SelectField disabled={readOnly} label="Device" onCommit={(device_id) => updateData({ device_id })} options={(devices.data ?? []).map((item) => ({ value: item.id, label: `${item.id}${item.state ? ` · ${item.state}` : ''}` }))} status={resourceStatus(devices)} value={deviceId} />
  let fields: ReactNode = null
  switch (node.kind) {
    case SCENARIO_NODE_KINDS.resetDevice: fields = device; break
    case SCENARIO_NODE_KINDS.sendSpi: fields = <>{device}{field('TX bytes (hex)', 'tx_hex', 'text', '9F 00 00 00')}<div className="flow-field"><span>Decoded</span><code className="flow-field-value scenario-byte-preview">{String(value(node, 'tx_hex')).trim().split(/\s+/).filter(Boolean).join(' · ') || '—'}</code></div>{field('Result name', 'save_as', 'text', 'optional')}{field('Response capacity', 'response_capacity', 'number', 'optional')}{field('Transport timeout ms', 'transport_timeout_ms', 'number', 'optional')}</>; break
    case SCENARIO_NODE_KINDS.advanceTime: fields = <>{field('Duration', 'duration', 'number')}<SelectField disabled={readOnly} label="Unit" onCommit={(unit) => updateData({ unit })} options={TIME_UNITS.map((unit) => ({ value: unit, label: unit }))} value={String(value(node, 'unit'))} /></>; break
    case SCENARIO_NODE_KINDS.enableFault:
    case SCENARIO_NODE_KINDS.disableFault: fields = <>{device}<SelectField disabled={readOnly} label="Fault" onCommit={(fault_id) => updateData({ fault_id })} options={(faults.data ?? []).filter((fault) => !deviceId || fault.device_id === deviceId).map((fault) => ({ value: fault.id, label: `${fault.id} · ${fault.action}` }))} status={resourceStatus(faults)} value={String(value(node, 'fault_id'))} /></>; break
    case SCENARIO_NODE_KINDS.assertRegister: fields = <>{device}<SelectField disabled={readOnly} label="Register" onCommit={(register) => updateData({ register })} options={(registers.data ?? []).map((item) => ({ value: item.name, label: `${item.name} · 0x${item.address.toString(16).toUpperCase()} · ${item.width_bits} bit` }))} status={resourceStatus(registers)} value={String(value(node, 'register'))} />{field('Expected value', 'expected')}</>; break
    case SCENARIO_NODE_KINDS.assertState: fields = <>{device}{field('Expected state', 'expected_state')}</>; break
    case SCENARIO_NODE_KINDS.assertResponse: fields = <>{field('Source result', 'source')}{field('Expected bytes (hex)', 'expected_hex')}</>; break
    case SCENARIO_NODE_KINDS.assertError: fields = <>{field('Source result', 'source')}{field('Structured error code', 'expected_code')}</>; break
    case SCENARIO_NODE_KINDS.waitForEvent: fields = <>{device}<SelectField disabled={readOnly} label="Event type" onCommit={(event_type) => updateData({ event_type })} options={EVENT_TYPES.map((item) => ({ value: item, label: item }))} value={String(value(node, 'event_type'))} />{field('Timeout', 'timeout', 'number')}<SelectField disabled={readOnly} label="Timeout unit" onCommit={(timeout_unit) => updateData({ timeout_unit })} options={TIME_UNITS.map((unit) => ({ value: unit, label: unit }))} value={String(value(node, 'timeout_unit'))} /></>; break
  }
  return <div className="flow-inspector-section scenario-inspector-fields">{label}{stepId}{fields}</div>
}
