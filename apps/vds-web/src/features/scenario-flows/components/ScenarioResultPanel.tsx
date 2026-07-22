import { Download } from 'lucide-react'
import type { ScenarioResult } from '../../../types/api'

export function ScenarioResultPanel({ result }: { result: ScenarioResult }) {
  const json = `${JSON.stringify(result, null, 2)}\n`
  const download = () => { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${result.scenario_id}.result.json`; link.click(); URL.revokeObjectURL(url) }
  return <section className="scenario-result-panel"><div><strong>Result: {result.status}</strong><span>{result.steps_passed} passed · {result.steps_failed} failed · {result.steps_skipped} skipped</span></div><button onClick={download} type="button"><Download size={14} /> Export result</button><pre>{json}</pre></section>
}
