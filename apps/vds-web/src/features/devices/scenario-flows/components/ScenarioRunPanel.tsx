import { Activity, Eraser } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'

import { useDownloadRunJunit } from '../../../../api/queries'
import { StatusBadge } from '../../../../components/StatusBadge'
import type { RunRecord } from '../../../../types/api'
import { useFlowStore } from '../../../flows/store/flowStore'
import { useScenarioRunStore } from '../runtime/scenarioRunStore'
import { ScenarioResultPanel } from './ScenarioResultPanel'

/** Run tab of the scenario editor's bottom panel: live step progress, then the final result. */
export function ScenarioRunPanel({ activeRunId, run }: { activeRunId: string | null; run: UseQueryResult<RunRecord> }) {
  const compiled = useScenarioRunStore((state) => state.compiled)
  const stepNodeMap = useScenarioRunStore((state) => state.stepNodeMap)
  const statuses = useScenarioRunStore((state) => state.statuses)
  const result = useScenarioRunStore((state) => state.result)
  const junit = useDownloadRunJunit()
  if (!activeRunId) {
    return <div className="flow-empty inline"><Activity aria-hidden="true" size={14} /><strong>No active run</strong><span>Run compiles the flow and executes it on the existing vds-scenario runtime.</span></div>
  }
  const exportJunit = () => junit.mutate(activeRunId, { onSuccess: (artifact) => { const url = URL.createObjectURL(artifact.blob); const link = document.createElement('a'); link.href = url; link.download = artifact.filename; link.click(); URL.revokeObjectURL(url) } })
  const runStatus = run.data?.status ?? 'queued'
  return (
    <div className="scenario-run-panel">
      <div className="flow-run-strip">
        <Activity aria-hidden="true" size={13} />
        <span className="muted">Run</span>
        <code title={activeRunId}>{activeRunId}</code>
        <StatusBadge status={runStatus} />
        {run.data?.error && <span className="text-err truncate" title={run.data.error}>{run.data.error}</span>}
        {run.isError && <span className="text-err">Run snapshot unavailable.</span>}
        {junit.isError && <span className="text-err">JUnit export failed.</span>}
        <button className="button button-sm button-ghost flow-run-clear" onClick={() => { useScenarioRunStore.getState().clear(); useFlowStore.getState().setRuntimeStatuses({}) }} type="button"><Eraser size={12} /> Clear</button>
      </div>
      {result
        ? <ScenarioResultPanel junitPending={junit.isPending} onExportJunit={exportJunit} result={result} />
        : compiled && (
          <div className="scenario-run-steps">
            <table className="data-table">
              <thead><tr><th className="num">#</th><th>Step</th><th>Action</th><th>Status</th></tr></thead>
              <tbody>
                {compiled.steps.map((step, index) => {
                  const status = statuses[stepNodeMap[step.id] ?? ''] ?? 'queued'
                  return (
                    <tr className={`scenario-step-${status}`} key={step.id}>
                      <td className="num dim">{index + 1}</td>
                      <td className="mono">{step.id}</td>
                      <td className="mono dim">{step.action}</td>
                      <td><StatusBadge status={status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
