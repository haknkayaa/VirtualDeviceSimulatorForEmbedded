import { useEffect } from 'react'
import { Activity, Eraser } from 'lucide-react'

import { useDownloadRunJunit, useRun, useRunResult } from '../../../api/queries'
import { useEventStore } from '../../../stores/eventStore'
import { useFlowStore } from '../../flows/store/flowStore'
import { useScenarioRunStore } from '../runtime/scenarioRunStore'
import { ScenarioResultPanel } from './ScenarioResultPanel'

export function ScenarioRunPanel() {
  const runtime = useScenarioRunStore()
  const events = useEventStore((state) => state.events)
  const run = useRun(runtime.activeRunId)
  const result = useRunResult(runtime.activeRunId, run.data?.status)
  const junit = useDownloadRunJunit()
  useEffect(() => useScenarioRunStore.getState().applyEvents(events), [events])
  useEffect(() => useScenarioRunStore.getState().hydrate(run.data, result.data ?? run.data?.result), [result.data, run.data])
  useEffect(() => useFlowStore.getState().setRuntimeStatuses(runtime.statuses), [runtime.statuses])
  if (!runtime.activeRunId) return null
  const exportJunit = () => junit.mutate(runtime.activeRunId!, { onSuccess: (artifact) => { const url = URL.createObjectURL(artifact.blob); const link = document.createElement('a'); link.href = url; link.download = artifact.filename; link.click(); URL.revokeObjectURL(url) } })
  return <aside className="scenario-run-panel flow-frosted"><header><div><span className="eyebrow">Existing vds-scenario runtime</span><strong><Activity size={14} /> {runtime.activeRunId}</strong></div><button onClick={() => { useScenarioRunStore.getState().clear(); useFlowStore.getState().setRuntimeStatuses({}) }} type="button"><Eraser size={14} /> Clear</button></header><div className="scenario-run-status"><span>Status</span><strong>{run.data?.status ?? 'queued'}</strong></div>{run.isError && <p className="scenario-run-error">Run snapshot unavailable.</p>}{junit.isError && <p className="scenario-run-error">JUnit export failed.</p>}{runtime.result && <ScenarioResultPanel junitPending={junit.isPending} onExportJunit={exportJunit} result={runtime.result} />}</aside>
}
