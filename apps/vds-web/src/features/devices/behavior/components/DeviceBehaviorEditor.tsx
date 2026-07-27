import { useState } from 'react'

import { useDevices, useRegisters } from '../../../../api/queries'
import { FlowWorkspace } from '../../../flows/components/FlowWorkspace'
import { useFlowStore } from '../../../flows/store/flowStore'
import { compileDeviceBehaviorFlow } from '../compiler/compileDeviceBehaviorFlow'
import { behaviorSettings, type BehaviorCompileResult } from '../types/deviceBehaviorFlow'
import { BehaviorTestPanel } from './BehaviorTestPanel'
import { BehaviorToolbar } from './BehaviorToolbar'
import { CompiledDevicePreview } from './CompiledDevicePreview'

export function DeviceBehaviorEditor({ onSave, onExport, onImport, onNotice }: { onSave: () => void; onExport: () => void; onImport: (file: File) => void; onNotice: (message: string, error?: boolean) => void }) {
  const document = useFlowStore((state) => state.document)
  const devices = useDevices()
  const settings = behaviorSettings(document)
  const registers = useRegisters(settings.device_id || undefined)
  const [compileResult, setCompileResult] = useState<BehaviorCompileResult | null>(null)
  const [outputTab, setOutputTab] = useState('validate')
  const [testOpen, setTestOpen] = useState(false)
  const compile = () => compileDeviceBehaviorFlow(useFlowStore.getState().document, { devices: devices.data, registers: registers.data })
  const validate = () => {
    const result = compile()
    setOutputTab('validate')
    useFlowStore.getState().setValidationVisible(true)
    onNotice(result.errors.length ? `${result.errors.length} blocking behavior error(s).` : `Valid behavior${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}.`, result.errors.length > 0)
    return result
  }
  const showCompile = () => {
    setCompileResult(compile())
    setOutputTab('compile')
    useFlowStore.getState().setValidationVisible(true)
  }
  const testResult = compile()
  return <div className="device-behavior-editor">
    <FlowWorkspace
      onExport={onExport}
      onImport={onImport}
      onSave={onSave}
      toolbarActions={<BehaviorToolbar onPreview={showCompile} onTest={() => setTestOpen((value) => !value)} onValidate={validate} />}
      validationTabs={{ activeTab: outputTab, onTabChange: setOutputTab, tabs: [{ id: 'compile', label: 'Compile', content: <CompiledDevicePreview result={compileResult} /> }] }}
    />
    {testOpen && <BehaviorTestPanel compiled={testResult} deviceId={settings.device_id} onClose={() => { setTestOpen(false); useFlowStore.getState().setRuntimeStatuses({}) }} />}
  </div>
}
