import { useEffect } from 'react'
import { Activity, Eraser } from 'lucide-react'

import { useRun, useRunResult } from '../../../api/queries'
import { useEventStore } from '../../../stores/eventStore'
import { useFlowStore } from '../../flows/store/flowStore'
import { useScenarioRunStore } from '../runtime/scenarioRunStore'
import { ScenarioResultPanel } from './ScenarioResultPanel'

export function ScenarioRunPanel() {
  const runtime = useScenarioRunStore()
  const events = useEventStore((state) => state.events)
  const run = useRun(runtime.activeRunId)
  const result = useRunResult(runtime.activeRunId, run.data?.status)
  useEffect(() => useScenarioRunStore.getState().applyEvents(events), [events])
  useEffect(() => useScenarioRunStore.getState().hydrate(run.data, result.data ?? run.data?.result), [result.data, run.data])
  useEffect(() => useFlowStore.getState().setRuntimeStatuses(runtime.statuses), [runtime.statuses])
  if (!runtime.activeRunId) return null
  return <aside className="scenario-run-panel flow-frosted"><header><div><span className="eyebrow">Existing vds-scenario runtime</span><strong><Activity size={14} /> {runtime.activeRunId}</strong></div><button onClick={() => { useScenarioRunStore.getState().clear(); useFlowStore.getState().setRuntimeStatuses({}) }} type="button"><Eraser size={14} /> Clear</button></header><div className="scenario-run-status"><span>Status</span><strong>{run.data?.status ?? 'queued'}</strong></div>{run.isError && <p className="scenario-run-error">Run snapshot unavailable.</p>}{runtime.result && <ScenarioResultPanel result={runtime.result} />}</aside>
}
