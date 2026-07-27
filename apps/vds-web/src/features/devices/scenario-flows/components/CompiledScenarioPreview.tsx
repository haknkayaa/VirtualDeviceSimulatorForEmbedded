import { Clipboard, Download, X } from 'lucide-react'

import type { ScenarioCompileResult } from '../types/scenarioFlow'
import { serializeCompiledScenario } from '../compiler/compileScenarioFlow'

export function CompiledScenarioPreview({ result, onClose }: { result: ScenarioCompileResult; onClose: () => void }) {
  const json = result.document ? serializeCompiledScenario(result.document) : ''
  const download = () => {
    if (!result.document) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${result.document.scenario.id}.compiled.json`; link.click(); URL.revokeObjectURL(url)
  }
  return <aside className="scenario-preview flow-frosted" aria-label="Compiled scenario preview">
    <header><div><span className="eyebrow">Existing runtime schema</span><strong>Compiled scenario</strong></div><button aria-label="Close preview" onClick={onClose} type="button"><X size={15} /></button></header>
    {!!result.errors.length && <div className="scenario-compiler-errors">{result.errors.map((item) => <p key={`${item.code}-${item.node_id}`}>{item.code}: {item.message}</p>)}</div>}
    {!!result.warnings.length && <div className="scenario-compiler-warnings">{result.warnings.map((item) => <p key={`${item.code}-${item.node_id}`}>{item.message}</p>)}</div>}
    {result.document && <><div className="scenario-preview-actions"><button onClick={() => void navigator.clipboard.writeText(json)} type="button"><Clipboard size={14} /> Copy</button><button onClick={download} type="button"><Download size={14} /> JSON</button></div><pre>{json}</pre></>}
  </aside>
}
