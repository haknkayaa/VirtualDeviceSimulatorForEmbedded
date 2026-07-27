import { useState } from 'react'
import { Check, Clock3, Play, X } from 'lucide-react'

import {
  useRun,
  useRunResult,
  useScenario,
  useScenarios,
  useStartScenario,
} from '../../../api/queries'
import { AsyncState } from '../../../components/AsyncState'
import { GlassPanel } from '../../../components/GlassPanel'
import { PageHeader } from '../../../components/PageHeader'
import { StatusBadge } from '../../../components/StatusBadge'
import { useRunStore } from '../../../stores/runStore'
import { formatVirtualTime, humanize } from '../../../utils/format'

export function ScenariosPage({ deviceId, embedded = false }: { deviceId: string; embedded?: boolean }) {
  const scenarios = useScenarios()
  const [selection, setSelection] = useState<string | null>(null)
  const deviceScenarios = scenarios.data?.filter((item) => item.device_ids.includes(deviceId))
  const scenarioId = deviceScenarios?.some((item) => item.id === selection)
    ? selection ?? undefined
    : deviceScenarios?.[0]?.id
  const scenario = useScenario(scenarioId)
  const start = useStartScenario()
  const activeRunId = useRunStore((state) => state.activeRunId)
  const setActiveRunId = useRunStore((state) => state.setActiveRunId)
  const run = useRun(activeRunId)
  const result = useRunResult(activeRunId, run.data?.status)

  const handleRun = () => {
    if (!scenarioId) return
    start.mutate(scenarioId, {
      onSuccess: (record) => setActiveRunId(record.run_id),
    })
  }

  const runButton = <button className="button button-primary" disabled={!scenarioId || start.isPending} onClick={handleRun} type="button"><Play size={16} />{start.isPending ? 'Starting' : 'Run scenario'}</button>

  return (
    <div className={embedded ? 'device-scenario-runtime' : 'page-stack'}>
      {!embedded && <PageHeader
        eyebrow="Deterministic orchestration"
        title="Scenarios"
        description="Launch configured scenarios asynchronously and follow authoritative run status and step results."
        action={runButton}
      />}
      <div className="scenarios-layout">
        <GlassPanel action={embedded ? runButton : undefined} className="scenario-list-panel" eyebrow={`Configured for ${deviceId}`} title="Scenario catalog">
          {scenarios.isPending && <AsyncState kind="loading" title="Loading scenarios" />}
          {scenarios.isError && <AsyncState detail={scenarios.error.message} kind="error" title="Scenarios unavailable" />}
          {deviceScenarios?.length === 0 && <AsyncState kind="empty" title="No scenarios configured for this device" />}
          <div className="scenario-list">{deviceScenarios?.map((item) => (
            <button className={`scenario-card ${item.id === scenarioId ? 'active' : ''}`} key={item.id} onClick={() => setSelection(item.id)} type="button">
              <span>{item.steps} steps</span><strong>{item.name}</strong><small>{item.id}</small><div><Clock3 size={14} /> {item.timeout_ms} ms timeout</div>
            </button>
          ))}</div>
        </GlassPanel>
        <div className="scenario-detail-stack">
          <GlassPanel eyebrow="Definition" title={scenario.data?.scenario.name ?? 'Scenario detail'}>
            {scenario.isPending && scenarioId && <AsyncState kind="loading" title="Loading definition" />}
            {scenario.isError && <AsyncState detail={scenario.error.message} kind="error" title="Definition unavailable" />}
            {scenario.data && (
              <div className="scenario-definition">
                <div className="scenario-meta"><span>ID <strong>{scenario.data.scenario.id}</strong></span><span>Schema <strong>v{scenario.data.schema_version}</strong></span><span>Timeout <strong>{scenario.data.scenario.timeout_ms} ms</strong></span></div>
                <ol>{scenario.data.steps.map((step) => <li key={step.id}><span>{step.id}</span><strong>{humanize(step.action)}</strong></li>)}</ol>
              </div>
            )}
            {start.isError && <AsyncState detail={start.error.message} kind="error" title="Scenario start failed" />}
          </GlassPanel>
          <GlassPanel eyebrow="Execution" title="Current run" action={run.data && <StatusBadge status={run.data.status} />}>
            {!activeRunId && <AsyncState detail="Select a scenario and start a run." kind="empty" title="No active run" />}
            {run.isPending && activeRunId && <AsyncState kind="loading" title={`Tracking ${activeRunId}`} />}
            {run.isError && <AsyncState detail={run.error.message} kind="error" title="Run status unavailable" />}
            {run.data && (
              <div className="run-detail">
                <div className="run-meta"><span>{run.data.run_id}</span><strong>{run.data.scenario_id}</strong></div>
                {run.data.result && <div className="result-metrics"><span><Check size={15} />{run.data.result.steps_passed} passed</span><span><X size={15} />{run.data.result.steps_failed} failed</span><span><Clock3 size={15} />{formatVirtualTime(run.data.result.duration_virtual_ns)}</span></div>}
                {run.data.error && <AsyncState detail={run.data.error} kind="error" title="Run execution failed" />}
                {run.data.result && <div className="step-results">{run.data.result.steps.map((step) => (
                  <article key={step.step_id}><StatusBadge status={step.status} /><div><strong>{step.step_id}</strong><span>{humanize(step.action)}</span>{step.error && <small>{step.error}</small>}</div><time>{formatVirtualTime(step.completed_virtual_ns - step.started_virtual_ns)}</time></article>
                ))}</div>}
              </div>
            )}
          </GlassPanel>
          {result.data && <GlassPanel eyebrow="Machine-readable output" title="Result JSON"><div className="json-block"><pre>{JSON.stringify(result.data, null, 2)}</pre></div></GlassPanel>}
        </div>
      </div>
    </div>
  )
}
