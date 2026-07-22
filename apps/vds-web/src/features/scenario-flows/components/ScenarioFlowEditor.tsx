import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'

import { api } from '../../../api/client'
import { queryKeys, useDevices, useFaults, useStartScenarioDefinition } from '../../../api/queries'
import { useRunStore } from '../../../stores/runStore'
import { FlowWorkspace } from '../../flows/components/FlowWorkspace'
import { useFlowStore } from '../../flows/store/flowStore'
import { compileScenarioFlow } from '../compiler/compileScenarioFlow'
import { useScenarioRunStore } from '../runtime/scenarioRunStore'
import { scenarioSettings, type ScenarioCompileResult, type ScenarioFlowSettings } from '../types/scenarioFlow'
import { CompiledScenarioPreview } from './CompiledScenarioPreview'
import { ScenarioRunPanel } from './ScenarioRunPanel'
import { ScenarioToolbar } from './ScenarioToolbar'

export function ScenarioFlowEditor({ onSave, onExport, onImport, onNotice }: { onSave: () => void; onExport: () => void; onImport: (file: File) => void; onNotice: (message: string, error?: boolean) => void }) {
  const document = useFlowStore((state) => state.document)
  const readOnly = useFlowStore((state) => state.readOnly)
  const updateMetadata = useFlowStore((state) => state.updateMetadata)
  const devices = useDevices()
  const faults = useFaults()
  const registerQueries = useQueries({ queries: (devices.data ?? []).map((device) => ({ queryKey: queryKeys.registers(device.id), queryFn: () => api.registers(device.id), staleTime: 10_000 })) })
  const resources = { devices: devices.data, faults: faults.data, registersByDevice: Object.fromEntries((devices.data ?? []).map((device, index) => [device.id, registerQueries[index]?.data ?? []])) }
  const [preview, setPreview] = useState<ScenarioCompileResult | null>(null)
  const start = useStartScenarioDefinition()
  const settings = scenarioSettings(document)
  const compile = () => compileScenarioFlow(useFlowStore.getState().document, resources)
  const validate = () => { const result = compile(); setPreview(result); onNotice(result.errors.length ? `${result.errors.length} blocking validation error(s).` : `Valid scenario flow${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}.`, result.errors.length > 0); return result }
  const run = () => {
    const result = compile()
    if (!result.document || result.errors.length) { setPreview(result); onNotice('Run blocked by scenario validation.', true); return }
    setPreview(null)
    start.mutate({ document: result.document, revision: document.flow.revision }, { onSuccess: (record) => { useScenarioRunStore.getState().begin(record.run_id, result.document!, result.stepNodeMap); useRunStore.getState().setActiveRunId(record.run_id); onNotice(`Run ${record.run_id} queued.`) }, onError: (error) => onNotice(error instanceof Error ? error.message : 'Run request failed.', true) })
  }
  const updateSettings = (next: ScenarioFlowSettings) => updateMetadata({ scenario: { description: next.description, timeout_ms: next.timeout_ms, continue_on_failure: next.continue_on_failure, tags: next.tags, revision: next.revision } })
  return <div className="scenario-flow-editor"><ScenarioToolbar blocked={readOnly} onPreview={() => setPreview(compile())} onRun={run} onSave={onSave} onSettings={updateSettings} onValidate={validate} running={start.isPending} settings={settings} /><FlowWorkspace onExport={onExport} onImport={onImport} onSave={onSave} />{preview && <CompiledScenarioPreview onClose={() => setPreview(null)} result={preview} />}<ScenarioRunPanel /></div>
}
