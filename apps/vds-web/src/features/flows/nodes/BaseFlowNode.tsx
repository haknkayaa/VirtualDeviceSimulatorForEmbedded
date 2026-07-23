import { Circle, Flag, Play, Workflow } from 'lucide-react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

import type { FlowCanvasNode } from '../types/flow'

const icons = { play: Play, flag: Flag, workflow: Workflow }

export function BaseFlowNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const definition = data.definition
  const Icon = icons[(definition?.iconIdentifier ?? 'workflow') as keyof typeof icons] ?? Circle
  const label = typeof data.document.data.label === 'string' ? data.document.data.label : definition?.displayName ?? data.document.kind
  const issueTone = data.issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : data.issues.length > 0 ? 'warning' : 'valid'

  return (
    <article
      className={`flow-node flow-node-${issueTone} runtime-${data.runtimeStatus}${selected ? ' selected' : ''}`}
      data-accent={definition?.accentToken ?? 'muted'}
      data-node-kind={data.document.kind}
      data-runtime-status={data.runtimeStatus}
    >
      {definition?.inputPorts.map((port, index) => (
        <Handle
          aria-label={`${port.label} input`}
          className="flow-handle flow-handle-input"
          id={port.id}
          isConnectable={!data.readOnly}
          key={port.id}
          position={Position.Left}
          style={{ top: `${((index + 1) / (definition.inputPorts.length + 1)) * 100}%` }}
          type="target"
        />
      ))}
      <div className="flow-node-icon"><Icon aria-hidden="true" size={17} /></div>
      <div className="flow-node-copy">
        <small>{definition?.category ?? 'Unknown kind'}</small>
        <strong>{label || 'Untitled node'}</strong>
        <span>{definition?.displayName ?? data.document.kind}</span>
      </div>
      <span className="flow-runtime-dot" title={`Runtime: ${data.runtimeStatus}`} />
      {definition?.outputPorts.map((port, index) => (
        <Handle
          aria-label={`${port.label} output`}
          className="flow-handle flow-handle-output"
          id={port.id}
          isConnectable={!data.readOnly}
          key={port.id}
          position={Position.Right}
          style={{ top: `${((index + 1) / (definition.outputPorts.length + 1)) * 100}%` }}
          type="source"
        />
      ))}
    </article>
  )
}
