import { useState } from 'react'

import { useDevices, useRegisters } from '../../../api/queries'
import { FlowWorkspace } from '../../flows/components/FlowWorkspace'
import { useFlowStore } from '../../flows/store/flowStore'
import { compileDeviceBehaviorFlow } from '../compiler/compileDeviceBehaviorFlow'
import { behaviorSettings, type BehaviorCompileResult, type BehaviorSettings } from '../types/deviceBehaviorFlow'
import { BehaviorTestPanel } from './BehaviorTestPanel'
import { BehaviorToolbar } from './BehaviorToolbar'
import { CompiledDevicePreview } from './CompiledDevicePreview'

export function DeviceBehaviorEditor({ onSave, onExport, onImport, onNotice }: { onSave: () => void; onExport: () => void; onImport: (file: File) => void; onNotice: (message: string, error?: boolean) => void }) {
  const document = useFlowStore((state) => state.document)
  const readOnly = useFlowStore((state) => state.readOnly)
  const updateMetadata = useFlowStore((state) => state.updateMetadata)
  const devices = useDevices()
  const settings = behaviorSettings(document)
  const registers = useRegisters(settings.device_id || undefined)
  const [preview, setPreview] = useState<BehaviorCompileResult | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  const compile = () => compileDeviceBehaviorFlow(useFlowStore.getState().document, { devices: devices.data, registers: registers.data })
  const validate = () => {
    const result = compile()
    onNotice(result.errors.length ? `${result.errors.length} blocking behavior error(s).` : `Valid behavior${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}.`, result.errors.length > 0)
    return result
  }
  const updateSettings = (next: BehaviorSettings) => updateMetadata({ behavior: { device_id: next.device_id, description: next.description, revision: next.revision } })
  const testResult = compile()
  return <div className="device-behavior-editor">
    <BehaviorToolbar devices={devices.data ?? []} onPreview={() => setPreview(compile())} onSave={onSave} onSettings={updateSettings} onTest={() => setTestOpen((value) => !value)} onValidate={validate} readOnly={readOnly} settings={settings} />
    <FlowWorkspace onExport={onExport} onImport={onImport} onSave={onSave} />
    {preview && <CompiledDevicePreview onClose={() => setPreview(null)} result={preview} />}
    {testOpen && <BehaviorTestPanel compiled={testResult} deviceId={settings.device_id} onClose={() => { setTestOpen(false); useFlowStore.getState().setRuntimeStatuses({}) }} />}
  </div>
}
