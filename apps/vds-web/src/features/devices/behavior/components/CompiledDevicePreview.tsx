import { AlertCircle, AlertTriangle, Braces, Clipboard, Download } from 'lucide-react'

import { serializeCompiledDeviceBehavior } from '../compiler/compileDeviceBehaviorFlow'
import type { BehaviorCompileResult } from '../types/deviceBehaviorFlow'

function download(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'device-behavior.json'; link.click(); URL.revokeObjectURL(url)
}

export function CompiledDevicePreview({ result }: { result: BehaviorCompileResult | null }) {
  if (!result) return <div className="flow-empty inline"><Braces aria-hidden="true" size={14} /><strong>No compile output yet</strong><span>Press Compile to generate the device-model fragment.</span></div>
  const output = result.document ? serializeCompiledDeviceBehavior(result.document) : ''
  return <div className="flow-compile-output" aria-label="Compiled device behavior">
    <div className="flow-compile-summary">
      <strong>Compiled device-model fragment</strong>
      <span className={result.errors.length ? 'text-err' : 'muted'}>{result.errors.length} errors</span>
      <span className={result.warnings.length ? 'text-warn' : 'muted'}>{result.warnings.length} warnings</span>
      {output && <span className="flow-compile-actions">
        <button className="button button-sm" onClick={() => void navigator.clipboard.writeText(output)} type="button"><Clipboard size={12} /> Copy JSON</button>
        <button className="button button-sm" onClick={() => download(output)} type="button"><Download size={12} /> Download</button>
      </span>}
    </div>
    {(result.errors.length > 0 || result.warnings.length > 0) && <div className="flow-compile-issues">
      {result.errors.map((issue, index) => <p className="issue-error" key={`e-${index}`}><AlertCircle aria-hidden="true" size={12} /><code>{issue.code}</code><span>{issue.message}</span></p>)}
      {result.warnings.map((issue, index) => <p className="issue-warning" key={`w-${index}`}><AlertTriangle aria-hidden="true" size={12} /><code>{issue.code}</code><span>{issue.message}</span></p>)}
    </div>}
    {output && <pre className="code-block flow-compile-json">{output}</pre>}
  </div>
}
