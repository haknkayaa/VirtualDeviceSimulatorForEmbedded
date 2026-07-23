import { Clipboard, Download, X } from 'lucide-react'

import { serializeCompiledDeviceBehavior } from '../compiler/compileDeviceBehaviorFlow'
import type { BehaviorCompileResult } from '../types/deviceBehaviorFlow'

function download(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'device-behavior.json'; link.click(); URL.revokeObjectURL(url)
}

export function CompiledDevicePreview({ result, onClose }: { result: BehaviorCompileResult; onClose: () => void }) {
  const output = result.document ? serializeCompiledDeviceBehavior(result.document) : ''
  return <aside className="behavior-preview glass-panel" aria-label="Compiled device behavior">
    <header><div><strong>Compiled device-model fragment</strong><span>{result.errors.length} errors · {result.warnings.length} warnings</span></div><button aria-label="Close preview" onClick={onClose} type="button"><X size={16} /></button></header>
    {(result.errors.length > 0 || result.warnings.length > 0) && <div className="behavior-issues">
      {result.errors.map((issue, index) => <p className="error" key={`e-${index}`}><b>{issue.code}</b> {issue.message}</p>)}
      {result.warnings.map((issue, index) => <p key={`w-${index}`}><b>{issue.code}</b> {issue.message}</p>)}
    </div>}
    {output && <><div className="behavior-preview-actions"><button onClick={() => void navigator.clipboard.writeText(output)} type="button"><Clipboard size={14} /> Copy JSON</button><button onClick={() => download(output)} type="button"><Download size={14} /> Download</button></div><pre>{output}</pre></>}
  </aside>
}
