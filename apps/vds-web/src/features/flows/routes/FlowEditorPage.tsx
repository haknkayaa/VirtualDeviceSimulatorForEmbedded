import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { FlowWorkspace } from '../components/FlowWorkspace'
import { FlowEditorBoundary } from '../components/FlowEditorBoundary'
import { createFlowDocument, serializeFlowDocument } from '../serialization/flowDocument'
import { loadExampleFlow } from '../serialization/examples'
import { localFlowRepository } from '../serialization/localFlowRepository'
import { useFlowStore } from '../store/flowStore'

function downloadJson(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'flow'}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function FlowEditorPage() {
  const { flowId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const loadedKey = useRef<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const requestedReadOnly = new URLSearchParams(location.search).get('readonly') === '1'

  useEffect(() => {
    const key = `${flowId ?? 'new'}:${requestedReadOnly}`
    if (loadedKey.current === key) return
    loadedKey.current = key
    if (!flowId) {
      useFlowStore.getState().newDocument(createFlowDocument())
      useFlowStore.getState().setReadOnly(requestedReadOnly)
      return
    }
    const local = localFlowRepository.load(flowId)
    const example = loadExampleFlow(flowId)
    const document = local ?? example
    if (document) useFlowStore.getState().loadDocument(document, { readOnly: requestedReadOnly || Boolean(example && !local) })
    else {
      useFlowStore.getState().loadDocument(createFlowDocument({ id: flowId, name: 'Recovered Flow' }), { readOnly: requestedReadOnly })
    }
  }, [flowId, requestedReadOnly])

  const save = useCallback(() => {
    const state = useFlowStore.getState()
    if (state.readOnly) { setNotice({ tone: 'error', message: 'Read-only documents cannot be saved.' }); return }
    const document = state.prepareLocalSave()
    localFlowRepository.save(document)
    setNotice({ tone: 'success', message: `Saved revision ${document.flow.revision} locally.` })
    if (!flowId) navigate(`/flows/${encodeURIComponent(document.flow.id)}`, { replace: true })
  }, [flowId, navigate])
  const exportDocument = useCallback(() => {
    const document = useFlowStore.getState().document
    downloadJson(document.flow.name, serializeFlowDocument(document))
    setNotice({ tone: 'success', message: 'Deterministic flow JSON exported.' })
  }, [])
  const importDocument = useCallback(async (file: File) => {
    const result = useFlowStore.getState().importJson(await file.text())
    setNotice(result.ok
      ? { tone: 'success', message: `Imported with ${result.issues.length} validation issue${result.issues.length === 1 ? '' : 's'}.` }
      : { tone: 'error', message: result.error })
  }, [])

  return (
    <div className="flow-editor-page">
      <div className="flow-editor-nav"><Link to="/flows"><ArrowLeft size={15} /> All flows</Link><span>Generic editor foundation · offline</span></div>
      {notice && <div className={`flow-notice flow-notice-${notice.tone}`} role="status">{notice.tone === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{notice.message}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button">×</button></div>}
      <FlowEditorBoundary><FlowWorkspace onExport={exportDocument} onImport={importDocument} onSave={save} /></FlowEditorBoundary>
    </div>
  )
}
