import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

import type { ValidationIssue } from '../types/flow'
import { useFlowStore } from '../store/flowStore'

export function ValidationPanel({ issues }: { issues: ValidationIssue[] }) {
  const visible = useFlowStore((state) => state.validationVisible)
  const select = useFlowStore((state) => state.select)
  if (!visible) return null
  return (
    <aside className="flow-validation flow-frosted" aria-label="Validation panel">
      <header><div><span className="eyebrow">Pluggable rules</span><strong>Validation</strong></div><span>{issues.length}</span></header>
      {issues.length === 0 && <div className="flow-panel-empty flow-valid"><CheckCircle2 size={21} /><strong>Flow is valid</strong><span>No generic validation issues.</span></div>}
      <div className="flow-issue-list">
        {issues.map((issue, index) => (
          <button key={`${issue.ruleId}-${issue.nodeId ?? ''}-${issue.edgeId ?? ''}-${index}`} onClick={() => select(issue.nodeId ? [issue.nodeId] : [], issue.edgeId ? [issue.edgeId] : [])} type="button">
            {issue.severity === 'error' ? <AlertCircle size={15} /> : <AlertTriangle size={15} />}
            <div><strong>{issue.message}</strong><small>{issue.ruleId}</small></div>
          </button>
        ))}
      </div>
    </aside>
  )
}
