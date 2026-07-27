import { Clipboard, Download } from 'lucide-react'

import { serializeCompiledDeviceBehavior } from '../compiler/compileDeviceBehaviorFlow'
import type { BehaviorCompileResult } from '../types/deviceBehaviorFlow'

function download(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'device-behavior.json'; link.click(); URL.revokeObjectURL(url)
}

export function CompiledDevicePreview({ result }: { result: BehaviorCompileResult | null }) {
  if (!result) return <div className="flow-panel-empty"><strong>No compile output yet</strong><span>Press Compile to generate the device-model fragment.</span></div>
  const output = result.document ? serializeCompiledDeviceBehavior(result.document) : ''
  return <div className="behavior-compile-output" aria-label="Compiled device behavior">
    <div className="behavior-compile-summary"><strong>Compiled device-model fragment</strong><span>{result.errors.length} errors · {result.warnings.length} warnings</span></div>
    {(result.errors.length > 0 || result.warnings.length > 0) && <div className="behavior-issues">
      {result.errors.map((issue, index) => <p className="error" key={`e-${index}`}><b>{issue.code}</b> {issue.message}</p>)}
      {result.warnings.map((issue, index) => <p key={`w-${index}`}><b>{issue.code}</b> {issue.message}</p>)}
    </div>}
    {output && <><div className="behavior-preview-actions"><button onClick={() => void navigator.clipboard.writeText(output)} type="button"><Clipboard size={14} /> Copy JSON</button><button onClick={() => download(output)} type="button"><Download size={14} /> Download</button></div><pre>{output}</pre></>}
  </div>
}
