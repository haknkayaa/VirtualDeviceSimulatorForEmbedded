import type { EdgeInspectorProps, NodeInspectorProps } from '../types/flow'

function LabelEditor({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="flow-field">
      <span>Label</span>
      <input disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  )
}

export function GenericNodeInspector({ node, readOnly, updateData }: NodeInspectorProps) {
  return (
    <div className="flow-inspector-section">
      <LabelEditor
        disabled={readOnly}
        onChange={(label) => updateData({ label })}
        value={typeof node.data.label === 'string' ? node.data.label : ''}
      />
    </div>
  )
}

export function GenericEdgeInspector({ edge, readOnly, updateData }: EdgeInspectorProps) {
  return (
    <div className="flow-inspector-section">
      <LabelEditor
        disabled={readOnly}
        onChange={(label) => updateData({ label })}
        value={typeof edge.data.label === 'string' ? edge.data.label : ''}
      />
    </div>
  )
}
