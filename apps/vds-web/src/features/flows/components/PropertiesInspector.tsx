import { Settings2 } from 'lucide-react'

import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowStore } from '../store/flowStore'
import type { ValidationIssue } from '../types/flow'

export function PropertiesInspector({ issues }: { issues: ValidationIssue[] }) {
  const state = useFlowStore()
  if (!state.inspectorVisible) return null
  const node = state.document.nodes.find((candidate) => state.selectedNodeIds.includes(candidate.id))
  const edge = state.document.edges.find((candidate) => state.selectedEdgeIds.includes(candidate.id))
  const definition = node ? nodeRegistry.get(node.kind) : edge ? edgeRegistry.get(edge.kind) : undefined
  const NodeInspector = node ? nodeRegistry.get(node.kind)?.inspectorComponent : undefined
  const EdgeInspector = edge ? edgeRegistry.get(edge.kind)?.inspectorComponent : undefined
  const scopedIssues = issues.filter((issue) => issue.nodeId === node?.id || issue.edgeId === edge?.id)
  return (
    <aside className="flow-inspector flow-frosted" aria-label="Properties inspector">
      <header><div><span className="eyebrow">Selection</span><strong>Properties</strong></div><Settings2 size={16} /></header>
      {!node && !edge && <div className="flow-panel-empty"><Settings2 size={21} /><strong>Nothing selected</strong><span>Select a node or edge to inspect generic properties.</span></div>}
      {(node || edge) && <>
        <dl className="flow-identity">
          <div><dt>ID</dt><dd>{node?.id ?? edge?.id}</dd></div>
          <div><dt>Kind</dt><dd>{node?.kind ?? edge?.kind}</dd></div>
          <div><dt>Registry</dt><dd>{definition?.displayName ?? 'Unknown'}</dd></div>
        </dl>
        {node && NodeInspector && <NodeInspector issues={scopedIssues} node={node} readOnly={state.readOnly} updateData={(patch) => state.updateNodeData(node.id, patch)} />}
        {edge && EdgeInspector && <EdgeInspector edge={edge} issues={scopedIssues} readOnly={state.readOnly} updateData={(patch) => state.updateEdgeData(edge.id, patch)} />}
        <div className="flow-inspector-issues">
          <span>Validation</span>
          {scopedIssues.length === 0 ? <small>No issues for this element.</small> : scopedIssues.map((issue) => <p className={`issue-${issue.severity}`} key={`${issue.ruleId}-${issue.message}`}>{issue.message}</p>)}
        </div>
      </>}
    </aside>
  )
}
