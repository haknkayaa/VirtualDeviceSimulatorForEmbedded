import type { JsonValue, NodeInspectorProps } from '../../../flows/types/flow'
import { BEHAVIOR_NODE_KINDS, TIME_UNITS } from '../types/deviceBehaviorFlow'

const logicalKinds = new Set<string>([
  BEHAVIOR_NODE_KINDS.logicalNot,
  BEHAVIOR_NODE_KINDS.logicalAnd,
  BEHAVIOR_NODE_KINDS.logicalOr,
  BEHAVIOR_NODE_KINDS.logicalNand,
  BEHAVIOR_NODE_KINDS.logicalNor,
  BEHAVIOR_NODE_KINDS.logicalXor,
  BEHAVIOR_NODE_KINDS.logicalXnor,
])

const timeKinds = new Set<string>([
  BEHAVIOR_NODE_KINDS.timer,
  BEHAVIOR_NODE_KINDS.delay,
  BEHAVIOR_NODE_KINDS.timeout,
  BEHAVIOR_NODE_KINDS.interval,
])

function text(value: JsonValue | undefined) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: JsonValue | undefined) {
  return typeof value === 'number' ? String(value) : ''
}

export function DesignNodeInspector({ node, readOnly, updateData }: NodeInspectorProps) {
  const updateNumber = (field: string, value: string, emptyValue: JsonValue = 0) => {
    const parsed = Number(value)
    updateData({ [field]: value === '' ? emptyValue : Number.isFinite(parsed) ? parsed : emptyValue })
  }

  return (
    <div className="flow-inspector-section">
      <label className="flow-field">
        <span>Label</span>
        <input disabled={readOnly} onChange={(event) => updateData({ label: event.target.value })} value={text(node.data.label)} />
      </label>

      {logicalKinds.has(node.kind) && <div className="design-node-summary">
        <span>Operation</span>
        <strong>{node.kind.split('logical_')[1]?.toUpperCase()}</strong>
        <small>Input count is defined by the node handles.</small>
      </div>}

      {timeKinds.has(node.kind) && <>
        <label className="flow-field">
          <span>Duration</span>
          <input disabled={readOnly} min={1} onChange={(event) => updateNumber('duration', event.target.value)} type="number" value={numberValue(node.data.duration)} />
        </label>
        <label className="flow-field">
          <span>Time unit</span>
          <select disabled={readOnly} onChange={(event) => updateData({ unit: event.target.value })} value={text(node.data.unit) || 'ms'}>
            {TIME_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
      </>}

      {(node.kind === BEHAVIOR_NODE_KINDS.fileRead || node.kind === BEHAVIOR_NODE_KINDS.fileWrite) && <>
        <label className="flow-field">
          <span>File path</span>
          <input disabled={readOnly} onChange={(event) => updateData({ path: event.target.value })} placeholder="/tmp/device-data.bin" value={text(node.data.path)} />
        </label>
        <label className="flow-field">
          <span>Format</span>
          <select disabled={readOnly} onChange={(event) => updateData({ format: event.target.value })} value={text(node.data.format) || 'bytes'}>
            <option value="bytes">Bytes</option>
            <option value="text">Text</option>
            <option value="json">JSON</option>
          </select>
        </label>
      </>}

      {node.kind === BEHAVIOR_NODE_KINDS.fileRead && <>
        <label className="flow-field">
          <span>Offset</span>
          <input disabled={readOnly} min={0} onChange={(event) => updateNumber('offset', event.target.value)} type="number" value={numberValue(node.data.offset)} />
        </label>
        <label className="flow-field">
          <span>Length (empty = all)</span>
          <input disabled={readOnly} min={1} onChange={(event) => updateNumber('length', event.target.value, null)} type="number" value={numberValue(node.data.length)} />
        </label>
      </>}

      {node.kind === BEHAVIOR_NODE_KINDS.fileWrite && <>
        <label className="flow-field">
          <span>Write mode</span>
          <select disabled={readOnly} onChange={(event) => updateData({ mode: event.target.value })} value={text(node.data.mode) || 'overwrite'}>
            <option value="overwrite">Overwrite</option>
            <option value="append">Append</option>
          </select>
        </label>
        <label className="flow-field">
          <span>Create file when missing</span>
          <select disabled={readOnly} onChange={(event) => updateData({ create: event.target.value === 'true' })} value={node.data.create !== false ? 'true' : 'false'}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
        </label>
      </>}
    </div>
  )
}
