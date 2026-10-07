import { useFlowStore } from '../../../flows/store/flowStore'
import { ACTIVE_BEHAVIOR_NODE_KINDS, BEHAVIOR_NODE_KINDS, BEHAVIOR_TRANSITION_EDGE, behaviorSettings } from '../types/deviceBehaviorFlow'

/** Document-level properties shown in the inspector when nothing is selected. */
export function BehaviorDocumentInspector() {
  const document = useFlowStore((state) => state.document)
  const readOnly = useFlowStore((state) => state.readOnly)
  const updateMetadata = useFlowStore((state) => state.updateMetadata)
  const settings = behaviorSettings(document)
  const states = document.nodes.filter((node) => ACTIVE_BEHAVIOR_NODE_KINDS.has(node.kind))
  const initial = document.nodes.find((node) => node.kind === BEHAVIOR_NODE_KINDS.initialState)
  const transitions = document.edges.filter((edge) => edge.kind === BEHAVIOR_TRANSITION_EDGE).length
  return (
    <div className="flow-inspector-section flow-document-inspector">
      <dl className="kv-grid flow-identity">
        <div><dt>Flow ID</dt><dd className="mono" title={document.flow.id}>{document.flow.id}</dd></div>
        <div><dt>Device</dt><dd className="mono" title={settings.device_id}>{settings.device_id || '—'}</dd></div>
        <div><dt>Revision</dt><dd className="mono">r{document.flow.revision}</dd></div>
        <div><dt>Initial state</dt><dd className="mono">{typeof initial?.data.state_name === 'string' ? initial.data.state_name : '—'}</dd></div>
        <div><dt>States</dt><dd className="mono">{states.length}</dd></div>
        <div><dt>Transitions</dt><dd className="mono">{transitions}</dd></div>
      </dl>
      <label className="flow-field flow-field-stacked">
        <span>Description</span>
        <textarea
          defaultValue={settings.description}
          disabled={readOnly}
          key={`description-${settings.description}`}
          onBlur={(event) => { if (event.target.value !== settings.description) updateMetadata({ behavior: { ...settings, description: event.target.value } }) }}
          rows={3}
        />
      </label>
      <p className="flow-note">Select a state or transition to edit it. States and transitions compile into the device model&apos;s state machine.</p>
    </div>
  )
}
