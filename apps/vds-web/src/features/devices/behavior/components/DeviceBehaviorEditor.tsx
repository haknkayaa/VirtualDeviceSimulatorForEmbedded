import { type ReactNode, useMemo, useState } from 'react'

import { useDevices, useRegisters } from '../../../../api/queries'
import { FlowWorkspace } from '../../../flows/components/FlowWorkspace'
import { useFlowStore } from '../../../flows/store/flowStore'
import { compileDeviceBehaviorFlow } from '../compiler/compileDeviceBehaviorFlow'
import { useBehaviorRuntimeSync } from '../runtime/useBehaviorRuntimeSync'
import { behaviorSettings, type BehaviorCompileResult } from '../types/deviceBehaviorFlow'
import { BehaviorDocumentInspector } from './BehaviorDocumentInspector'
import { BehaviorTestPanel } from './BehaviorTestPanel'
import { BehaviorToolbar } from './BehaviorToolbar'
import { CompiledDevicePreview } from './CompiledDevicePreview'

interface DeviceBehaviorEditorProps {
  context?: ReactNode
  notice?: ReactNode
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  onNotice: (message: string, error?: boolean) => void
}

export function DeviceBehaviorEditor({ context, notice, onSave, onExport, onImport, onNotice }: DeviceBehaviorEditorProps) {
  const document = useFlowStore((state) => state.document)
  const devices = useDevices()
  const settings = behaviorSettings(document)
  const registers = useRegisters(settings.device_id || undefined)
  const [compileResult, setCompileResult] = useState<BehaviorCompileResult | null>(null)
  const [outputTab, setOutputTab] = useState('validate')
  const [testOpen, setTestOpen] = useState(false)
  const compile = () => compileDeviceBehaviorFlow(useFlowStore.getState().document, { devices: devices.data, registers: registers.data })
  const testResult = useMemo(
    () => testOpen ? compileDeviceBehaviorFlow(document, { devices: devices.data, registers: registers.data }) : null,
    [devices.data, document, registers.data, testOpen],
  )
  useBehaviorRuntimeSync(settings.device_id, testResult, testOpen)
  const showPanel = (tab: string) => {
    setOutputTab(tab)
    useFlowStore.getState().setValidationVisible(true)
  }
  const validate = () => {
    const result = compile()
    showPanel('validate')
    onNotice(result.errors.length ? `${result.errors.length} blocking behavior error(s).` : `Valid behavior${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}.`, result.errors.length > 0)
    return result
  }
  const showCompile = () => {
    setCompileResult(compile())
    showPanel('compile')
  }
  const startTest = () => {
    setTestOpen(true)
    showPanel('runtime')
  }
  const stopTest = () => {
    setTestOpen(false)
    useFlowStore.getState().setRuntimeStatuses({})
  }
  const compileMeta = compileResult && <span className="flow-tab-counts">
    <span className={compileResult.errors.length ? 'text-err' : 'text-ok'}>{compileResult.errors.length ? `${compileResult.errors.length} err` : 'ok'}</span>
  </span>
  return (
    <FlowWorkspace
      context={context}
      documentInspector={<BehaviorDocumentInspector />}
      notice={notice}
      onExport={onExport}
      onImport={onImport}
      onSave={onSave}
      toolbarActions={<BehaviorToolbar onPreview={showCompile} onTest={() => (testOpen ? stopTest() : startTest())} onValidate={validate} testing={testOpen} />}
      validationTabs={{
        activeTab: outputTab,
        onTabChange: setOutputTab,
        tabs: [
          { id: 'compile', label: 'Compile', meta: compileMeta, content: <CompiledDevicePreview result={compileResult} /> },
          { id: 'runtime', label: 'Runtime', meta: testOpen ? <span aria-hidden="true" className="status-dot live" /> : undefined, content: <BehaviorTestPanel deviceId={settings.device_id} observing={testOpen} onClose={stopTest} onStart={startTest} /> },
        ],
      }}
    />
  )
}
