import { CircleAlert, CircleCheck, CircleX, Info, Play } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useStartScenario } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { useWorkspaceProblems } from '../../hooks/useWorkspaceProblems'
import { useEventStore } from '../../stores/eventStore'
import { formatVirtualTime } from '../../utils/format'
import type { Problem } from '../../utils/problems'
import { latestScenarioRun } from './overviewModel'

const icons = { error: CircleX, warning: CircleAlert, info: Info }

/** Problem ids the bring-up pipeline and node table already explain. */
const explainedElsewhere = /^(adapter-unavailable|adapter-auth|adapter-unloaded|adapter-empty|device-unbound)-/

/** Problems the bring-up pipeline does not already explain; empty when healthy. */
export function AttentionPanel() {
  const navigate = useNavigate()
  const problems = useWorkspaceProblems()
  const items = useMemo(() => problems.filter((problem) => !explainedElsewhere.test(problem.id)), [problems])
  const errors = items.filter((problem) => problem.severity === 'error').length
  return (
    <Panel
      className="overview-attention"
      flush
      meta={items.length ? `${items.length} item${items.length === 1 ? '' : 's'}${errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''}` : undefined}
      title="Needs attention"
    >
      {items.length === 0
        ? <div className="attention-clear"><CircleCheck aria-hidden="true" size={16} /><span>Nothing needs attention. Failed transactions, armed faults and degraded buses appear here.</span></div>
        : (
          <ul aria-label="Problems" className="problem-list">
            {items.map((problem: Problem) => {
              const Icon = icons[problem.severity]
              return (
                <li key={problem.id}>
                  <button
                    className={`list-row problem-row problem-${problem.severity}`}
                    disabled={!problem.to}
                    onClick={() => problem.to && navigate(problem.to)}
                    type="button"
                  >
                    <Icon aria-label={problem.severity} size={15} />
                    <span className="problem-text">
                      <span className="problem-message">{problem.message}</span>
                      <small className="truncate"><code>{problem.source}</code>{problem.detail ? ` · ${problem.detail}` : ''}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
    </Panel>
  )
}

export function ScenarioRunPanel() {
  const events = useEventStore((state) => state.events)
  const run = useMemo(() => latestScenarioRun(events), [events])
  const startScenario = useStartScenario()
  return (
    <Panel className="overview-scenario" meta={run?.runId} title="Last scenario run">
      {!run
        ? <AsyncState detail="Run a test scenario from a device's Test Scenarios tab." kind="empty" title="No scenario run in this session" />
        : (
          <div className="scenario-summary">
            <div className="scenario-summary-head">
              <code className="scenario-id" title={run.scenarioId}>{run.scenarioId}</code>
              <StatusBadge status={run.status} />
            </div>
            <p className="scenario-steps">
              {run.passed === undefined
                ? `Running${run.lastStep ? ` · ${run.lastStep}` : ''}`
                : <><span className="text-ok">{run.passed} passed</span> · <span className={run.failed ? 'text-err' : ''}>{run.failed} failed</span> · {run.skipped} skipped</>}
              {run.startedVirtualNs !== undefined && run.completedVirtualNs !== undefined && (
                <span className="faint"> · {formatVirtualTime(run.completedVirtualNs - run.startedVirtualNs)} virtual</span>
              )}
            </p>
            {run.lastError && <p className="scenario-error" title={run.lastError}>{run.lastError}</p>}
            <div className="scenario-actions">
              <button
                className="button button-sm"
                disabled={startScenario.isPending || run.passed === undefined}
                onClick={() => startScenario.mutate(run.scenarioId)}
                type="button"
              >
                <Play aria-hidden="true" size={13} /> {startScenario.isPending ? 'Starting…' : 'Run again'}
              </button>
              <Link className="button button-ghost button-sm" to="/logs">Event log</Link>
            </div>
            {startScenario.isError && <p className="scenario-error" role="alert">{startScenario.error.message}</p>}
          </div>
        )}
    </Panel>
  )
}
