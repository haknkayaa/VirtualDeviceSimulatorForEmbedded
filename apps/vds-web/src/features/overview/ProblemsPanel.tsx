import { CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Panel } from '../../components/Panel'
import { useWorkspaceProblems } from '../../hooks/useWorkspaceProblems'
import { countProblems } from '../../utils/problems'

const icons = { error: CircleX, warning: CircleAlert, info: Info }

export function ProblemsPanel() {
  const navigate = useNavigate()
  const problems = useWorkspaceProblems()
  const { errors, warnings } = countProblems(problems)
  return (
    <Panel
      className="overview-problems"
      flush
      icon={TriangleAlert}
      meta={`${errors} errors · ${warnings} warnings`}
      title="Problems"
    >
      {problems.length === 0
        ? <div className="problems-clear"><CircleCheck aria-hidden="true" size={14} /> No problems detected</div>
        : (
          <ul aria-label="Problems" className="problem-list">
            {problems.map((problem) => {
              const Icon = icons[problem.severity]
              return (
                <li key={problem.id}>
                  <button
                    className={`list-row problem-row problem-${problem.severity}`}
                    disabled={!problem.to}
                    onClick={() => problem.to && navigate(problem.to)}
                    type="button"
                  >
                    <Icon aria-label={problem.severity} size={13} />
                    <span className="problem-text">
                      <span className="problem-message"><code>{problem.source}</code> {problem.message}</span>
                      {problem.detail && <small className="truncate">{problem.detail}</small>}
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
