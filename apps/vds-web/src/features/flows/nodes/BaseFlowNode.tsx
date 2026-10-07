import { AlertCircle, AlertTriangle, Link2 } from 'lucide-react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

import type { FlowCanvasNode, PortDefinition } from '../types/flow'
import { FlowNodeIcon } from './nodeIcons'

function portOffset(index: number, count: number) {
  return `${((index + 1) / (count + 1)) * 100}%`
}

function PortLabels({ ports, side }: { ports: PortDefinition[]; side: 'in' | 'out' }) {
  if (ports.length < 2) return null
  return ports.map((port, index) => (
    <span aria-hidden="true" className={`flow-port-label ${side}`} key={port.id} style={{ top: portOffset(index, ports.length) }}>{port.id}</span>
  ))
}

export function BaseFlowNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const definition = data.definition
  const isTerminal = data.document.data.terminal === true
  const typeName = definition?.displayName ?? data.document.kind
  const label = typeof data.document.data.label === 'string' ? data.document.data.label.trim() : ''
  const summary = definition?.summary?.(data.document.data)
  const errors = data.issues.filter((issue) => issue.severity === 'error').length
  const warnings = data.issues.length - errors
  const issueTone = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'valid'
  const reusable = typeof data.document.ui.reusable_id === 'string'
  const outputs = isTerminal ? [] : definition?.outputPorts ?? []
  const inputs = definition?.inputPorts ?? []
  const showLabel = label !== '' && label !== typeName

  return (
    <article
      className={`flow-node flow-node-${issueTone} runtime-${data.runtimeStatus}${selected ? ' selected' : ''}${isTerminal ? ' terminal' : ''}`}
      data-accent={definition?.accentToken ?? 'muted'}
      data-node-kind={data.document.kind}
      data-reusable={reusable || undefined}
      data-runtime-status={data.runtimeStatus}
    >
      {inputs.map((port, index) => (
        <Handle
          aria-label={`${port.label} input`}
          className="flow-handle flow-handle-input"
          id={port.id}
          isConnectable={!data.readOnly}
          key={port.id}
          position={Position.Left}
          style={{ top: portOffset(index, inputs.length) }}
          title={port.label}
          type="target"
        />
      ))}
      <PortLabels ports={inputs} side="in" />
      <header className="flow-node-head">
        <FlowNodeIcon className="flow-node-icon" identifier={definition?.iconIdentifier} size={12} />
        <span className="flow-node-type">{typeName}</span>
        {reusable && <Link2 aria-label="Linked reusable node" className="flow-node-linked" size={11} />}
        {errors > 0 && <span className="flow-node-issues err" title={`${errors} error(s)`}><AlertCircle aria-hidden="true" size={11} />{errors}</span>}
        {errors === 0 && warnings > 0 && <span className="flow-node-issues warn" title={`${warnings} warning(s)`}><AlertTriangle aria-hidden="true" size={11} />{warnings}</span>}
        {data.runtimeStatus !== 'idle' && <span className="flow-node-status" title={`Runtime: ${data.runtimeStatus}`}>{data.runtimeStatus}</span>}
      </header>
      {(showLabel || summary) && (
        <div className="flow-node-body">
          {showLabel && <strong className="flow-node-label">{label}</strong>}
          {summary && <code className="flow-node-summary">{summary}</code>}
        </div>
      )}
      {outputs.map((port, index) => (
        <Handle
          aria-label={`${port.label} output`}
          className="flow-handle flow-handle-output"
          id={port.id}
          isConnectable={!data.readOnly}
          key={port.id}
          position={Position.Right}
          style={{ top: portOffset(index, outputs.length) }}
          title={port.label}
          type="source"
        />
      ))}
      <PortLabels ports={outputs} side="out" />
    </article>
  )
}
