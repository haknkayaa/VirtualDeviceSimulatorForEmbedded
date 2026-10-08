import { CircleCheck, CircleDashed, CircleDot, CircleX, FolderOpen, Play } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useRunResult, useScenario, useScenarios, useStartScenario } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import type { CoverageMetricName, RunStatus, ScenarioCoverage } from '../../types/api'
import { formatVirtualTime, humanize } from '../../utils/format'
import { latestScenarioRun, mergeScenarioSteps, type ScenarioStepState } from './overviewModel'

const stepIcons: Record<ScenarioStepState, typeof CircleCheck> = {
  passed: CircleCheck,
  failed: CircleX,
  running: CircleDot,
  queued: CircleDashed,
  skipped: CircleDashed,
}

const stepLabels: Record<ScenarioStepState, string> = {
  passed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  queued: 'Queued',
  skipped: 'Skipped',
}

const coverageMetrics: CoverageMetricName[] = ['commands', 'registers', 'states', 'transitions', 'faults']

/** One line per device: `commands 3/21 · states 3/7 · …`, skipping undeclared metrics. */
function CoverageSummary({ coverage }: { coverage: ScenarioCoverage }) {
  return (
    <dl aria-label="Coverage" className="scn-coverage">
      {coverage.devices.map((device) => (
        <div key={device.device_id}>
          <dt title={device.device_id}>Coverage{coverage.devices.length > 1 ? ` · ${device.device_id}` : ''}</dt>
          <dd>
            {coverageMetrics
              .filter((name) => device[name].total > 0)
              .map((name) => (
                <span key={name} title={device[name].missed.length ? `Not exercised: ${device[name].missed.join(', ')}` : 'All exercised'}>
                  {name} <b className="mono">{device[name].covered}/{device[name].total}</b>
                </span>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The latest scenario run with its step-by-step progress. */
export function ScenarioRunPanel() {
  const events = useEventStore((state) => state.events)
  const run = useMemo(() => latestScenarioRun(events), [events])
  const definition = useScenario(run?.scenarioId)
  const scenarios = useScenarios()
  const startScenario = useStartScenario()
  const result = useRunResult(run?.runId ?? null, run && run.status !== 'running' ? run.status as RunStatus : undefined)
  const steps = useMemo(
    () => (run ? mergeScenarioSteps(run, definition.data?.steps) : []),
    [definition.data?.steps, run],
  )

  if (!run) {
    return (
      <Panel className="overview-scenario" title="Scenario run">
        <AsyncState detail="Start a packaged test scenario with Run scenario above, or from a device's Test Scenarios tab." kind="empty" title="No scenario has run in this session" />
      </Panel>
    )
  }

  const done = steps.filter((step) => step.state === 'passed' || step.state === 'failed' || step.state === 'skipped').length
  const total = steps.length
  const percent = total ? Math.round((done / total) * 100) : 0
  const running = run.status === 'running'
  const current = steps.findIndex((step) => step.state === 'running')
  const deviceId = scenarios.data?.find((scenario) => scenario.id === run.scenarioId)?.device_ids[0]
  const failedRun = /fail|error|timeout|cancel/i.test(run.status)

  return (
    <Panel className="overview-scenario" meta={run.runId} title="Scenario run">
      <div className="scn">
        <div className="scn-head">
          <strong className="scn-name" title={run.scenarioId}>{run.scenarioId}</strong>
          <StatusBadge status={run.status} />
        </div>
        <div className="scn-progress-line">
          <span>{running ? `Step ${current >= 0 ? current + 1 : done} of ${total}` : `${done} of ${total} steps`}</span>
          <span className="scn-percent">{percent}%</span>
        </div>
        <div aria-label={`${percent}% complete`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className={`scn-progress${failedRun ? ' failed' : ''}`} role="progressbar">
          <i style={{ width: `${percent}%` }} />
        </div>
        {result.data?.coverage && result.data.coverage.devices.length > 0 && <CoverageSummary coverage={result.data.coverage} />}
        <ol className="scn-steps">
          {steps.map((step, index) => {
            const Icon = stepIcons[step.state]
            return (
              <li className={`scn-step step-${step.state}`} key={step.id} title={step.error}>
                <Icon aria-hidden="true" className="scn-step-icon" size={18} />
                <span className="scn-step-name">{index + 1}. {humanize(step.action)} <code>{step.id}</code></span>
                <span className="scn-step-state">{stepLabels[step.state]}</span>
                <span className="scn-step-time">{step.durationNs === undefined ? '—' : formatVirtualTime(step.durationNs)}</span>
              </li>
            )
          })}
        </ol>
        <div className="scn-actions">
          <button className="button" disabled={running || startScenario.isPending} onClick={() => startScenario.mutate(run.scenarioId)} type="button">
            <Play aria-hidden="true" size={14} /> {startScenario.isPending ? 'Starting…' : 'Run again'}
          </button>
          {deviceId && (
            <Link className="button" to={`/devices/${encodeURIComponent(deviceId)}/scenarios/${encodeURIComponent(run.scenarioId)}`}>
              <FolderOpen aria-hidden="true" size={14} /> Open scenario…
            </Link>
          )}
        </div>
        {startScenario.isError && <p className="scn-error" role="alert">{startScenario.error.message}</p>}
      </div>
    </Panel>
  )
}
