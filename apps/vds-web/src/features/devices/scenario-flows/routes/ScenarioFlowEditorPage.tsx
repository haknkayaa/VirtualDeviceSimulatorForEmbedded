import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { FlowEditorBoundary } from '../../../flows/components/FlowEditorBoundary'
import { serializeFlowDocument } from '../../../flows/serialization/flowDocument'
import { localFlowRepository } from '../../../flows/serialization/localFlowRepository'
import { useFlowStore } from '../../../flows/store/flowStore'
import { ScenarioFlowEditor } from '../components/ScenarioFlowEditor'
import { createScenarioFlowDocument } from '../serialization/scenarioFlowDocument'
import '../registry/scenarioNodeRegistry'

function download(name: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.json`; link.click(); URL.revokeObjectURL(url) }

export function ScenarioFlowEditorPage() {
  const { deviceId, flowId } = useParams(); const navigate = useNavigate(); const loaded = useRef<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)
  useEffect(() => {
    const key = flowId ?? 'new'; if (loaded.current === key) return; loaded.current = key
    if (!flowId) { useFlowStore.getState().newDocument(createScenarioFlowDocument({ deviceId })); useFlowStore.getState().setReadOnly(false); return }
    const document = localFlowRepository.load(flowId)
    if (document?.flow.kind === 'scenario') useFlowStore.getState().loadDocument(document, { readOnly: false })
    else useFlowStore.getState().loadDocument(createScenarioFlowDocument({ id: flowId, name: 'Recovered Scenario Flow' }), { readOnly: false })
  }, [deviceId, flowId])
  const save = useCallback(() => { const state = useFlowStore.getState(); if (state.readOnly) { setNotice({ message: 'Read-only documents cannot be saved.', error: true }); return }; const document = state.prepareLocalSave(); localFlowRepository.save(document); setNotice({ message: `Saved scenario revision ${document.flow.revision} locally.`, error: false }); if (!flowId && deviceId) navigate(`/devices/${encodeURIComponent(deviceId)}/scenarios/${encodeURIComponent(document.flow.id)}`, { replace: true }) }, [deviceId, flowId, navigate])
  const exportFlow = useCallback(() => { const document = useFlowStore.getState().document; download(document.flow.name, serializeFlowDocument(document)) }, [])
  const importFlow = useCallback(async (file: File) => { const before = structuredClone(useFlowStore.getState().document); const result = useFlowStore.getState().importJson(await file.text()); if (result.ok && useFlowStore.getState().document.flow.kind !== 'scenario') { useFlowStore.getState().loadDocument(before); setNotice({ message: 'Import rejected: document kind must be scenario.', error: true }); return }; setNotice({ message: result.ok ? 'Scenario flow imported.' : result.error, error: !result.ok }) }, [])
  return <div className="flow-editor-page scenario-flow-page"><div className="flow-editor-nav"><Link to={`/devices/${encodeURIComponent(deviceId ?? '')}/scenarios`}><ArrowLeft size={15} /> Device scenarios</Link><span>{deviceId} · authoring surface</span></div>{notice && <div className={`flow-notice flow-notice-${notice.error ? 'error' : 'success'}`} role="status">{notice.error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}<span>{notice.message}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button">×</button></div>}<FlowEditorBoundary><ScenarioFlowEditor onExport={exportFlow} onImport={importFlow} onNotice={(message, error = false) => setNotice({ message, error })} onSave={save} /></FlowEditorBoundary></div>
}
