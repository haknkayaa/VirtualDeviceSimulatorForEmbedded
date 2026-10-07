import { Download } from 'lucide-react'

import { StatusBadge } from '../../../../components/StatusBadge'
import type { ScenarioResult } from '../../../../types/api'
import { formatVirtualTime } from '../../../../utils/format'

export function ScenarioResultPanel({ result, onExportJunit, junitPending }: { result: ScenarioResult; onExportJunit: () => void; junitPending: boolean }) {
  const json = `${JSON.stringify(result, null, 2)}\n`
  const download = () => { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${result.scenario_id}.result.json`; link.click(); URL.revokeObjectURL(url) }
  return (
    <section className="scenario-result-panel" aria-label="Scenario result">
      <div className="scenario-result-summary">
        <span className="muted">Result</span>
        <StatusBadge status={result.status} />
        <span className="mono"><span className="text-ok">{result.steps_passed} passed</span> · <span className={result.steps_failed ? 'text-err' : ''}>{result.steps_failed} failed</span> · <span className="dim">{result.steps_skipped} skipped</span></span>
        <span className="mono dim">{formatVirtualTime(result.duration_virtual_ns)} virtual</span>
        <span className="scenario-result-actions">
          <button className="button button-sm" onClick={download} type="button"><Download size={12} /> Export Result JSON</button>
          <button className="button button-sm" disabled={junitPending} onClick={onExportJunit} type="button"><Download size={12} /> {junitPending ? 'Preparing JUnit…' : 'Export JUnit XML'}</button>
        </span>
      </div>
      <div className="scenario-run-steps">
        <table className="data-table">
          <thead><tr><th className="num">#</th><th>Step</th><th>Action</th><th>Status</th><th className="num">Start</th><th className="num">Duration</th><th>Detail</th></tr></thead>
          <tbody>
            {result.steps.map((step, index) => (
              <tr className={`scenario-step-${step.status}`} key={`${step.step_id}-${index}`}>
                <td className="num dim">{index + 1}</td>
                <td className="mono">{step.step_id}</td>
                <td className="mono dim">{step.action}</td>
                <td><StatusBadge status={step.status} /></td>
                <td className="num dim">{formatVirtualTime(step.started_virtual_ns)}</td>
                <td className="num">{formatVirtualTime(Math.max(0, step.completed_virtual_ns - step.started_virtual_ns))}</td>
                <td className={step.error ? 'text-err scenario-step-error' : 'dim'} title={step.error}>{step.error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
