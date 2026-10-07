import { AlertCircle, AlertTriangle, Grid3X3, Lock, MousePointer2, PanelBottom, PanelRight } from 'lucide-react'

import { useFlowStore } from '../store/flowStore'
import type { ValidationIssue } from '../types/flow'

/** Canvas footer strip: grid, selection, problem counts, density and document size. */
export function FlowStatusBar({ issues }: { issues: ValidationIssue[] }) {
  const selectedNodes = useFlowStore((state) => state.selectedNodeIds.length)
  const selectedEdges = useFlowStore((state) => state.selectedEdgeIds.length)
  const density = useFlowStore((state) => state.density)
  const setDensity = useFlowStore((state) => state.setDensity)
  const readOnly = useFlowStore((state) => state.readOnly)
  const nodeCount = useFlowStore((state) => state.document.nodes.length)
  const edgeCount = useFlowStore((state) => state.document.edges.length)
  const validationVisible = useFlowStore((state) => state.validationVisible)
  const setValidationVisible = useFlowStore((state) => state.setValidationVisible)
  const inspectorVisible = useFlowStore((state) => state.inspectorVisible)
  const setInspectorVisible = useFlowStore((state) => state.setInspectorVisible)
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  return (
    <footer className="flow-status-bar">
      <span title="Snap grid"><Grid3X3 aria-hidden="true" size={12} /> 20px</span>
      <span><MousePointer2 aria-hidden="true" size={12} /> {selectedNodes} nodes · {selectedEdges} edges selected</span>
      <button className="flow-status-problems" onClick={() => setValidationVisible(!validationVisible)} title="Toggle problems panel" type="button">
        <span className={errors ? 'has-errors' : undefined}><AlertCircle aria-hidden="true" size={12} /> {errors} errors</span>
        <span className={warnings ? 'has-warnings' : undefined}><AlertTriangle aria-hidden="true" size={12} /> {warnings} warnings</span>
      </button>
      <button className="flow-status-density" onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} title="Toggle node density" type="button">{density} density</button>
      {readOnly && <span className="text-warn"><Lock aria-hidden="true" size={12} /> Read only</span>}
      <span className="flow-status-spacer" />
      <span className="mono">{nodeCount} nodes · {edgeCount} edges</span>
      <button aria-label="Toggle validation panel" aria-pressed={validationVisible} className="flow-status-toggle" onClick={() => setValidationVisible(!validationVisible)} title="Toggle bottom panel" type="button"><PanelBottom size={13} /></button>
      <button aria-label="Toggle inspector" aria-pressed={inspectorVisible} className="flow-status-toggle" onClick={() => setInspectorVisible(!inspectorVisible)} title="Toggle inspector" type="button"><PanelRight size={13} /></button>
    </footer>
  )
}
