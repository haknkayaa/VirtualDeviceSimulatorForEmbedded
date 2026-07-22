import { Grid3X3, Lock, MousePointer2, ShieldCheck } from 'lucide-react'

import { useFlowStore } from '../store/flowStore'
import type { ValidationIssue } from '../types/flow'

export function FlowStatusBar({ issues }: { issues: ValidationIssue[] }) {
  const state = useFlowStore()
  return (
    <footer className="flow-status-bar flow-frosted">
      <span><Grid3X3 size={13} /> Grid 20px</span>
      <span><MousePointer2 size={13} /> {state.selectedNodeIds.length} nodes · {state.selectedEdgeIds.length} edges selected</span>
      <span><ShieldCheck size={13} /> {issues.filter((issue) => issue.severity === 'error').length} errors · {issues.filter((issue) => issue.severity === 'warning').length} warnings</span>
      <button onClick={() => state.setDensity(state.density === 'compact' ? 'comfortable' : 'compact')} type="button">{state.density} density</button>
      {state.readOnly && <span><Lock size={13} /> Read only</span>}
      <span className="flow-status-spacer" />
      <span>{state.document.nodes.length} nodes · {state.document.edges.length} edges</span>
    </footer>
  )
}
