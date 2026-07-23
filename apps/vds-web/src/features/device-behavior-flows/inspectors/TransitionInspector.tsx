import { useRegisters } from '../../../api/queries'
import { useFlowStore } from '../../flows/store/flowStore'
import type { EdgeInspectorProps } from '../../flows/types/flow'
import { behaviorSettings, TIME_UNITS } from '../types/deviceBehaviorFlow'

function value(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function BlurField({ label, value: current, disabled, type = 'text', onCommit }: { label: string; value: string; disabled: boolean; type?: string; onCommit: (value: string) => void }) {
  return <label className="flow-field"><span>{label}</span><input defaultValue={current} disabled={disabled} key={`${label}-${current}`} onBlur={(event) => { if (event.target.value !== current) onCommit(event.target.value) }} type={type} /></label>
}

export function TransitionInspector({ edge, readOnly, updateData }: EdgeInspectorProps) {
  const document = useFlowStore((state) => state.document)
  const settings = behaviorSettings(document)
  const registers = useRegisters(settings.device_id || undefined)
  const guardEnabled = edge.data.guard_enabled === true
  const delayEnabled = typeof edge.data.delay_value === 'number' && edge.data.delay_value > 0
  const selectedRegister = value(edge.data.guard_register)
  const knownRegister = registers.data?.some((register) => register.name === selectedRegister) ?? false
  return (
    <div className="flow-inspector-section behavior-transition-inspector">
      <label className="flow-field"><span>Trigger type</span><select disabled={readOnly} onChange={(event) => updateData({ trigger_type: event.target.value })} value={value(edge.data.trigger_type)}>
        <option value="event">Runtime event</option>
        <option value="command">Command-dispatched event</option>
      </select></label>
      <BlurField disabled={readOnly} label="Event identifier" onCommit={(trigger) => updateData({ trigger })} value={value(edge.data.trigger)} />
      <BlurField disabled={readOnly} label="Priority" onCommit={(priority) => updateData({ priority: Number(priority) })} type="number" value={value(edge.data.priority)} />
      <label className="behavior-internal-check"><input checked={guardEnabled} disabled={readOnly} onChange={(event) => updateData({ guard_enabled: event.target.checked })} type="checkbox" /> Register guard</label>
      {guardEnabled && <>
        <label className="flow-field"><span>Guard register</span><select disabled={readOnly} onChange={(event) => updateData({ guard_register: event.target.value })} value={selectedRegister}>
          <option value="">Select…</option>
          {selectedRegister && !knownRegister && <option value={selectedRegister}>Missing: {selectedRegister}</option>}
          {(registers.data ?? []).map((register) => <option key={register.name} value={register.name}>{register.name} · {register.width_bits} bit</option>)}
        </select></label>
        <BlurField disabled={readOnly} label="Equals" onCommit={(guard_equals) => updateData({ guard_equals })} value={value(edge.data.guard_equals)} />
        <BlurField disabled={readOnly} label="Mask (optional)" onCommit={(guard_mask) => updateData({ guard_mask })} value={value(edge.data.guard_mask)} />
      </>}
      <label className="behavior-internal-check"><input checked={delayEnabled} disabled={readOnly || edge.data.trigger_type === 'command'} onChange={(event) => updateData({ delay_value: event.target.checked ? 1 : null, delay_unit: 'ms' })} type="checkbox" /> State-entry scheduled event</label>
      {delayEnabled && <div className="behavior-duration-fields">
        <BlurField disabled={readOnly} label="Delay" onCommit={(delay_value) => updateData({ delay_value: Number(delay_value) })} type="number" value={value(edge.data.delay_value)} />
        <label className="flow-field"><span>Unit</span><select disabled={readOnly} onChange={(event) => updateData({ delay_unit: event.target.value })} value={value(edge.data.delay_unit)}>
          {TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select></label>
      </div>}
      {registers.isError && <small className="scenario-resource-status">Register snapshot unavailable; authored values are preserved.</small>}
    </div>
  )
}
