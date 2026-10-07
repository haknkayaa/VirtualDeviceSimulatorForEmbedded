import { useRegisters } from '../../../../api/queries'
import { useFlowStore } from '../../../flows/store/flowStore'
import type { EdgeInspectorProps } from '../../../flows/types/flow'
import { behaviorSettings, TIME_UNITS } from '../types/deviceBehaviorFlow'

function value(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function BlurField({ label, value: current, disabled, type = 'text', mono = false, placeholder, onCommit }: { label: string; value: string; disabled: boolean; type?: string; mono?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  return <label className="flow-field"><span>{label}</span><input className={mono ? 'mono' : undefined} defaultValue={current} disabled={disabled} key={`${label}-${current}`} onBlur={(event) => { if (event.target.value !== current) onCommit(event.target.value) }} placeholder={placeholder} spellCheck={mono ? false : undefined} type={type} /></label>
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
      <BlurField disabled={readOnly} label="Event identifier" mono onCommit={(trigger) => updateData({ trigger })} value={value(edge.data.trigger)} />
      <BlurField disabled={readOnly} label="Priority" mono onCommit={(priority) => updateData({ priority: Number(priority) })} type="number" value={value(edge.data.priority)} />
      <label className="flow-field"><span>Register guard</span><select disabled={readOnly} onChange={(event) => updateData({ guard_enabled: event.target.value === 'true' })} value={guardEnabled ? 'true' : 'false'}>
        <option value="false">Disabled</option>
        <option value="true">Enabled</option>
      </select></label>
      {guardEnabled && <>
        <label className="flow-field"><span>Guard register</span><select disabled={readOnly} onChange={(event) => updateData({ guard_register: event.target.value })} value={selectedRegister}>
          <option value="">Select…</option>
          {selectedRegister && !knownRegister && <option value={selectedRegister}>Missing: {selectedRegister}</option>}
          {(registers.data ?? []).map((register) => <option key={register.name} value={register.name}>{register.name} · {register.width_bits} bit</option>)}
        </select></label>
        <BlurField disabled={readOnly} label="Equals" mono onCommit={(guard_equals) => updateData({ guard_equals })} value={value(edge.data.guard_equals)} />
        <BlurField disabled={readOnly} label="Mask" mono onCommit={(guard_mask) => updateData({ guard_mask })} placeholder="optional" value={value(edge.data.guard_mask)} />
      </>}
      <label className="flow-field"><span>Scheduled event</span><select disabled={readOnly || edge.data.trigger_type === 'command'} onChange={(event) => updateData({ delay_value: event.target.value === 'true' ? 1 : null, delay_unit: 'ms' })} value={delayEnabled ? 'true' : 'false'}>
        <option value="false">Disabled</option>
        <option value="true">Enabled</option>
      </select></label>
      {delayEnabled && <div className="flow-field-pair">
        <BlurField disabled={readOnly} label="Delay" mono onCommit={(delay_value) => updateData({ delay_value: Number(delay_value) })} type="number" value={value(edge.data.delay_value)} />
        <label className="flow-field"><span>Unit</span><select disabled={readOnly} onChange={(event) => updateData({ delay_unit: event.target.value })} value={value(edge.data.delay_unit)}>
          {TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select></label>
      </div>}
      {registers.isError && <p className="flow-note">Register snapshot unavailable; authored values are preserved.</p>}
    </div>
  )
}
