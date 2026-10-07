import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, MousePointer2, Settings2, Waypoints } from 'lucide-react'

import { FlowNodeIcon } from '../nodes/nodeIcons'
import { flowDocumentName } from './flowLabels'
import { FlowNameField } from './FlowToolbar'
import { edgeRegistry } from '../registry/edgeRegistry'
import { nodeRegistry } from '../registry/nodeRegistry'
import { useFlowStore } from '../store/flowStore'
import type { ValidationIssue } from '../types/flow'

export function PropertiesInspector({ issues, documentInspector }: { issues: ValidationIssue[]; documentInspector?: ReactNode }) {
  const state = useFlowStore()
  if (!state.inspectorVisible) return null
  const node = state.document.nodes.find((candidate) => state.selectedNodeIds.includes(candidate.id))
  const edge = state.document.edges.find((candidate) => state.selectedEdgeIds.includes(candidate.id))
  const nodeDefinition = node ? nodeRegistry.get(node.kind) : undefined
  const definition = node ? nodeDefinition : edge ? edgeRegistry.get(edge.kind) : undefined
  const NodeInspector = nodeDefinition?.inspectorComponent
  const EdgeInspector = edge ? edgeRegistry.get(edge.kind)?.inspectorComponent : undefined
  const scopedIssues = issues.filter((issue) => (node !== undefined && issue.nodeId === node.id) || (edge !== undefined && issue.edgeId === edge.id))
  const selectionCount = state.selectedNodeIds.length + state.selectedEdgeIds.length
  return (
    <aside className="flow-inspector" aria-label="Properties inspector">
      <header className="flow-pane-header">
        <h2 className="panel-title"><Settings2 aria-hidden="true" size={13} />Properties</h2>
        {selectionCount > 1 && <span className="count" title="Only the first selected element is shown">{selectionCount} selected</span>}
      </header>
      <div className="flow-inspector-body">
        {!node && !edge && <>
          <div className="flow-inspector-section flow-name-section">
            <h3 className="flow-section-title">{flowDocumentName(state.document.flow.kind)}</h3>
            <FlowNameField />
          </div>
          {documentInspector ?? (
            <div className="flow-empty">
              <MousePointer2 aria-hidden="true" size={16} />
              <strong>Nothing selected</strong>
              <span>Select a node or edge to inspect its properties.</span>
            </div>
          )}
        </>}
        {(node || edge) && <>
          <div className="flow-inspector-identity" data-accent={nodeDefinition?.accentToken ?? 'edge'}>
            <span className="flow-inspector-identity-icon">{node ? <FlowNodeIcon identifier={nodeDefinition?.iconIdentifier} size={13} /> : <Waypoints aria-hidden="true" size={13} />}</span>
            <div>
              <strong>{definition?.displayName ?? 'Unknown'}</strong>
              <small>{node ? 'Node' : 'Edge'}{nodeDefinition ? ` · ${nodeDefinition.category}` : ''}</small>
            </div>
          </div>
          <dl className="kv-grid flow-identity">
            <div><dt>ID</dt><dd className="mono" title={node?.id ?? edge?.id}>{node?.id ?? edge?.id}</dd></div>
            <div><dt>Kind</dt><dd className="mono" title={node?.kind ?? edge?.kind}>{node?.kind ?? edge?.kind}</dd></div>
            {edge && <div><dt>Route</dt><dd className="mono" title={`${edge.source} → ${edge.target}`}>{edge.source} → {edge.target}</dd></div>}
            {node && <div><dt>Position</dt><dd className="mono">{Math.round(node.position.x)}, {Math.round(node.position.y)}</dd></div>}
          </dl>
          {node && state.document.flow.kind === 'device_behavior' && <label className="flow-field flow-property-row">
            <span>Reusable</span>
            <select
              disabled={state.readOnly}
              onChange={(event) => state.setNodeReusable(node.id, event.target.value === 'true')}
              title="Linked instances share the same settings."
              value={typeof node.ui.reusable_id === 'string' ? 'true' : 'false'}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </label>}
          {node && NodeInspector && <NodeInspector issues={scopedIssues} node={node} readOnly={state.readOnly} updateData={(patch) => state.updateNodeData(node.id, patch)} />}
          {edge && EdgeInspector && <EdgeInspector edge={edge} issues={scopedIssues} readOnly={state.readOnly} updateData={(patch) => state.updateEdgeData(edge.id, patch)} />}
          <section className="flow-inspector-issues">
            <h3 className="flow-section-title">Validation</h3>
            {scopedIssues.length === 0
              ? <p className="flow-issue-ok"><CheckCircle2 aria-hidden="true" size={13} />No issues for this element.</p>
              : scopedIssues.map((issue) => (
                <p className={`flow-issue-line issue-${issue.severity}`} key={`${issue.ruleId}-${issue.message}`}>
                  {issue.severity === 'error' ? <AlertCircle aria-hidden="true" size={13} /> : <AlertTriangle aria-hidden="true" size={13} />}
                  <span>{issue.message}<code>{issue.ruleId}</code></span>
                </p>
              ))}
          </section>
        </>}
      </div>
    </aside>
  )
}
