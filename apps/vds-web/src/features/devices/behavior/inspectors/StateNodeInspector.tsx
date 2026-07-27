import type { ReactNode } from 'react'
import { X } from 'lucide-react'

import { useRegisters } from '../../../../api/queries'
import { useFlowStore } from '../../../flows/store/flowStore'
import type { JsonObject, NodeInspectorProps } from '../../../flows/types/flow'
import { behaviorSettings, stateActions, type BehaviorStateAction } from '../types/deviceBehaviorFlow'

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function authoredActions(actions: BehaviorStateAction[]): JsonObject[] {
  return actions.map((action) => ({
    kind: action.kind,
    register: action.register,
    ...(action.value !== undefined ? { value: action.value } : {}),
    ...(action.mask !== undefined ? { mask: action.mask } : {}),
    ...(action.reset_value !== undefined ? { reset_value: action.reset_value } : {}),
    ...(action.allow_read_only_internal !== undefined ? { allow_read_only_internal: action.allow_read_only_internal } : {}),
  }))
}

function BlurField({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
  return <label className="flow-field"><span>{label}</span><input defaultValue={value} disabled={disabled} key={`${label}-${value}`} onBlur={(event) => { if (event.target.value !== value) onCommit(event.target.value) }} /></label>
}

function ActionSection({
  title,
  actions,
  disabled,
  registerOptions,
  onChange,
}: {
  title: string
  actions: BehaviorStateAction[]
  disabled: boolean
  registerOptions: { name: string; access: string; width_bits: number }[]
  onChange: (actions: BehaviorStateAction[]) => void
}) {
  const patch = (index: number, value: Partial<BehaviorStateAction>) => onChange(actions.map((action, current) => current === index ? { ...action, ...value } : action))
  return (
    <section className="behavior-action-section">
      <header><strong>{title}</strong><button disabled={disabled} onClick={() => onChange([...actions, { kind: 'set_register', register: '', value: '' }])} type="button">+ Register action</button></header>
      {actions.length === 0 && <small>No actions.</small>}
      {actions.map((action, index) => {
        const known = registerOptions.some((register) => register.name === action.register)
        const actionValue = action.kind === 'reset_register' ? text(action.reset_value) : text(action.value)
        return (
          <div className="behavior-action-row" key={`${title}-${index}-${action.register}-${action.kind}`}>
            <label className="flow-field"><span>Action</span><select disabled={disabled} onChange={(event) => patch(index, { kind: event.target.value })} value={action.kind}>
              <option value="set_register">Set register</option>
              <option value="reset_register">Reset register</option>
            </select></label>
            <label className="flow-field"><span>Register</span><select disabled={disabled} onChange={(event) => patch(index, { register: event.target.value })} value={action.register}>
              <option value="">Select…</option>
              {action.register && !known && <option value={action.register}>Missing: {action.register}</option>}
              {registerOptions.map((register) => <option key={register.name} value={register.name}>{register.name} · {register.width_bits} bit · {register.access.toUpperCase()}</option>)}
            </select></label>
            <BlurField disabled={disabled} label={action.kind === 'reset_register' ? 'Configured reset value' : 'Value'} onCommit={(value) => patch(index, action.kind === 'reset_register' ? { reset_value: value } : { value })} value={actionValue} />
            <BlurField disabled={disabled} label="Mask (optional)" onCommit={(mask) => patch(index, { mask })} value={text(action.mask)} />
            <label className="flow-field"><span>Internal hardware write</span><select disabled={disabled} onChange={(event) => patch(index, { allow_read_only_internal: event.target.value === 'true' })} value={action.allow_read_only_internal === true ? 'true' : 'false'}>
              <option value="false">False</option>
              <option value="true">True</option>
            </select></label>
            <button
              aria-label={`Remove ${title.toLowerCase()} action ${index + 1}`}
              className="behavior-remove-action"
              disabled={disabled}
              onClick={() => onChange(actions.filter((_, current) => current !== index))}
              title="Remove action"
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
        )
      })}
    </section>
  )
}

export function StateNodeInspector({ node, readOnly, updateData }: NodeInspectorProps) {
  const document = useFlowStore((state) => state.document)
  const settings = behaviorSettings(document)
  const registers = useRegisters(settings.device_id || undefined)
  const entry = stateActions(node, 'entry_actions')
  const exit = stateActions(node, 'exit_actions')
  const resourceState = registers.isPending ? 'Loading register snapshot…' : registers.isError ? 'Register snapshot unavailable; authored values are preserved.' : null
  const fields: ReactNode = (
    <>
      <BlurField disabled={readOnly} label="Label" onCommit={(label) => updateData({ label })} value={text(node.data.label)} />
      <BlurField disabled={readOnly} label="State name" onCommit={(state_name) => updateData({ state_name })} value={text(node.data.state_name)} />
      <BlurField disabled={readOnly} label="Description" onCommit={(description) => updateData({ description })} value={text(node.data.description)} />
      <label className="flow-field"><span>Terminal state</span><select disabled={readOnly} onChange={(event) => updateData({ terminal: event.target.value === 'true' })} value={node.data.terminal === true ? 'true' : 'false'}>
        <option value="false">False</option>
        <option value="true">True</option>
      </select></label>
      {resourceState && <small className="scenario-resource-status">{resourceState}</small>}
      <ActionSection actions={entry} disabled={readOnly} onChange={(actions) => updateData({ entry_actions: authoredActions(actions) })} registerOptions={registers.data ?? []} title="Entry actions" />
      <ActionSection actions={exit} disabled={readOnly} onChange={(actions) => updateData({ exit_actions: authoredActions(actions) })} registerOptions={registers.data ?? []} title="Exit actions" />
    </>
  )
  return <div className="flow-inspector-section behavior-state-inspector">{fields}</div>
}
