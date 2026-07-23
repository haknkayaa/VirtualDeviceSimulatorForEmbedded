import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { FlowEditorBoundary } from '../../flows/components/FlowEditorBoundary'
import { serializeFlowDocument } from '../../flows/serialization/flowDocument'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import { useFlowStore } from '../../flows/store/flowStore'
import { DeviceBehaviorEditor } from '../components/DeviceBehaviorEditor'
import { createDeviceBehaviorFlowDocument, exampleDeviceBehaviorFlow } from '../serialization/deviceBehaviorFlowDocument'
import '../registry/deviceBehaviorRegistry'

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.json`; link.click(); URL.revokeObjectURL(url)
}

export function DeviceBehaviorEditorPage() {
  const { flowId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const loaded = useRef<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)
  const readOnly = new URLSearchParams(location.search).get('readonly') === '1'
  useEffect(() => {
    const key = `${flowId ?? 'new'}:${readOnly}`; if (loaded.current === key) return; loaded.current = key
    if (!flowId) { useFlowStore.getState().newDocument(createDeviceBehaviorFlowDocument()); useFlowStore.getState().setReadOnly(readOnly); return }
    const local = localFlowRepository.load(flowId)
    const example = flowId === exampleDeviceBehaviorFlow.flow.id ? structuredClone(exampleDeviceBehaviorFlow) : null
    const document = local ?? example
    if (document?.flow.kind === 'device_behavior') useFlowStore.getState().loadDocument(document, { readOnly: readOnly || Boolean(example && !local) })
    else useFlowStore.getState().loadDocument(createDeviceBehaviorFlowDocument({ id: flowId, name: 'Recovered Device Behavior' }), { readOnly })
  }, [flowId, readOnly])
  const save = useCallback(() => {
    const state = useFlowStore.getState()
    if (state.readOnly) { setNotice({ message: 'Read-only documents cannot be saved.', error: true }); return }
    const document = state.prepareLocalSave(); localFlowRepository.save(document)
    setNotice({ message: `Saved behavior revision ${document.flow.revision} locally.`, error: false })
    if (!flowId) navigate(`/flows/devices/${encodeURIComponent(document.flow.id)}`, { replace: true })
  }, [flowId, navigate])
  const exportFlow = useCallback(() => { const document = useFlowStore.getState().document; download(document.flow.name, serializeFlowDocument(document)) }, [])
  const importFlow = useCallback(async (file: File) => {
    const before = structuredClone(useFlowStore.getState().document)
    const result = useFlowStore.getState().importJson(await file.text())
    if (result.ok && useFlowStore.getState().document.flow.kind !== 'device_behavior') {
      useFlowStore.getState().loadDocument(before); setNotice({ message: 'Import rejected: document kind must be device_behavior.', error: true }); return
    }
    setNotice({ message: result.ok ? 'Device behavior imported.' : result.error, error: !result.ok })
  }, [])
  return <div className="flow-editor-page device-behavior-page"><div className="flow-editor-nav"><Link to="/flows/devices"><ArrowLeft size={15} /> Device behaviors</Link><span>Authoring surface · existing state-machine runtime</span></div>{notice && <div className={`flow-notice flow-notice-${notice.error ? 'error' : 'success'}`} role="status">{notice.error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}<span>{notice.message}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button">×</button></div>}<FlowEditorBoundary><DeviceBehaviorEditor onExport={exportFlow} onImport={importFlow} onNotice={(message, error = false) => setNotice({ message, error })} onSave={save} /></FlowEditorBoundary></div>
}
