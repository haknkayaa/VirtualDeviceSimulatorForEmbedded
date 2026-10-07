import { AlertCircle, AlertTriangle, Braces, Clipboard, Download } from 'lucide-react'

import type { ScenarioCompileResult } from '../types/scenarioFlow'
import { serializeCompiledScenario } from '../compiler/compileScenarioFlow'

export function CompiledScenarioPreview({ result }: { result: ScenarioCompileResult | null }) {
  if (!result) return <div className="flow-empty inline"><Braces aria-hidden="true" size={14} /><strong>No compile output yet</strong><span>Press Compile to generate the runtime scenario document.</span></div>
  const json = result.document ? serializeCompiledScenario(result.document) : ''
  const download = () => {
    if (!result.document) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${result.document.scenario.id}.compiled.json`; link.click(); URL.revokeObjectURL(url)
  }
  return <div className="flow-compile-output" aria-label="Compiled scenario preview">
    <div className="flow-compile-summary">
      <strong>Compiled scenario</strong>
      <span className="muted">existing runtime schema</span>
      <span className={result.errors.length ? 'text-err' : 'muted'}>{result.errors.length} errors</span>
      <span className={result.warnings.length ? 'text-warn' : 'muted'}>{result.warnings.length} warnings</span>
      {result.document && <span className="flow-compile-actions">
        <button className="button button-sm" onClick={() => void navigator.clipboard.writeText(json)} type="button"><Clipboard size={12} /> Copy</button>
        <button className="button button-sm" onClick={download} type="button"><Download size={12} /> JSON</button>
      </span>}
    </div>
    {(result.errors.length > 0 || result.warnings.length > 0) && <div className="flow-compile-issues">
      {result.errors.map((item, index) => <p className="issue-error" key={`e-${item.code}-${item.node_id ?? ''}-${index}`}><AlertCircle aria-hidden="true" size={12} /><code>{item.code}</code><span>{item.message}</span>{item.node_id && <code className="dim">node:{item.node_id}</code>}</p>)}
      {result.warnings.map((item, index) => <p className="issue-warning" key={`w-${item.code}-${item.node_id ?? ''}-${index}`}><AlertTriangle aria-hidden="true" size={12} /><code>{item.code}</code><span>{item.message}</span>{item.node_id && <code className="dim">node:{item.node_id}</code>}</p>)}
    </div>}
    {result.document && <pre className="code-block flow-compile-json">{json}</pre>}
  </div>
}
