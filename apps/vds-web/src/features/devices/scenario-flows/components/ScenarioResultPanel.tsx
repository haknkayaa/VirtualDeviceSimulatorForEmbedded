import { Download } from 'lucide-react'
import type { ScenarioResult } from '../../../../types/api'

export function ScenarioResultPanel({ result, onExportJunit, junitPending }: { result: ScenarioResult; onExportJunit: () => void; junitPending: boolean }) {
  const json = `${JSON.stringify(result, null, 2)}\n`
  const download = () => { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${result.scenario_id}.result.json`; link.click(); URL.revokeObjectURL(url) }
  return <section className="scenario-result-panel"><div><strong>Result: {result.status}</strong><span>{result.steps_passed} passed · {result.steps_failed} failed · {result.steps_skipped} skipped</span></div><div className="scenario-result-actions"><button onClick={download} type="button"><Download size={14} /> Export Result JSON</button><button disabled={junitPending} onClick={onExportJunit} type="button"><Download size={14} /> {junitPending ? 'Preparing JUnit…' : 'Export JUnit XML'}</button></div><pre>{json}</pre></section>
}
