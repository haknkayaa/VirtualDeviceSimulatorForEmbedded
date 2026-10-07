import { type ReactNode, useState } from 'react'
import { useQueries } from '@tanstack/react-query'

import { api } from '../../../../api/client'
import { queryKeys, useDevices, useFaults, useStartScenarioDefinition } from '../../../../api/queries'
import { useRunStore } from '../../../../stores/runStore'
import { FlowWorkspace } from '../../../flows/components/FlowWorkspace'
import { useFlowStore } from '../../../flows/store/flowStore'
import { compileScenarioFlow } from '../compiler/compileScenarioFlow'
import { useScenarioRunStore } from '../runtime/scenarioRunStore'
import { useScenarioRunSync } from '../runtime/useScenarioRunSync'
import { scenarioSettings, type ScenarioCompileResult, type ScenarioFlowSettings } from '../types/scenarioFlow'
import { CompiledScenarioPreview } from './CompiledScenarioPreview'
import { ScenarioRunPanel } from './ScenarioRunPanel'
import { ScenarioSettingsInspector } from './ScenarioSettingsInspector'
import { ScenarioToolbar } from './ScenarioToolbar'

interface ScenarioFlowEditorProps {
  context?: ReactNode
  notice?: ReactNode
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void
  onNotice: (message: string, error?: boolean) => void
}

const runTone: Record<string, string> = { passed: 'ok', failed: 'err', timed_out: 'err', cancelled: 'warn', running: 'live', queued: 'info' }

export function ScenarioFlowEditor({ context, notice, onSave, onExport, onImport, onNotice }: ScenarioFlowEditorProps) {
  const document = useFlowStore((state) => state.document)
  const readOnly = useFlowStore((state) => state.readOnly)
  const updateMetadata = useFlowStore((state) => state.updateMetadata)
  const devices = useDevices()
  const faults = useFaults()
  const registerQueries = useQueries({ queries: (devices.data ?? []).map((device) => ({ queryKey: queryKeys.registers(device.id), queryFn: () => api.registers(device.id), staleTime: 10_000 })) })
  const resources = { devices: devices.data, faults: faults.data, registersByDevice: Object.fromEntries((devices.data ?? []).map((device, index) => [device.id, registerQueries[index]?.data ?? []])) }
  const [preview, setPreview] = useState<ScenarioCompileResult | null>(null)
  const [outputTab, setOutputTab] = useState('validate')
  const start = useStartScenarioDefinition()
  const { activeRunId, run } = useScenarioRunSync()
  const settings = scenarioSettings(document)
  const compile = () => compileScenarioFlow(useFlowStore.getState().document, resources)
  const showPanel = (tab: string) => {
    setOutputTab(tab)
    useFlowStore.getState().setValidationVisible(true)
  }
  const validate = () => {
    const result = compile()
    setPreview(result)
    showPanel(result.errors.length ? 'compile' : 'validate')
    onNotice(result.errors.length ? `${result.errors.length} blocking validation error(s).` : `Valid test scenario${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ''}.`, result.errors.length > 0)
    return result
  }
  const showCompile = () => {
    setPreview(compile())
    showPanel('compile')
  }
  const runScenario = () => {
    const result = compile()
    if (!result.document || result.errors.length) { setPreview(result); showPanel('compile'); onNotice('Run blocked by scenario validation.', true); return }
    start.mutate({ document: result.document, revision: document.flow.revision }, {
      onSuccess: (record) => {
        useScenarioRunStore.getState().begin(record.run_id, result.document!, result.stepNodeMap)
        useRunStore.getState().setActiveRunId(record.run_id)
        showPanel('run')
        onNotice(`Run ${record.run_id} queued.`)
      },
      onError: (error) => onNotice(error instanceof Error ? error.message : 'Run request failed.', true),
    })
  }
  const updateSettings = (next: ScenarioFlowSettings) => updateMetadata({ scenario: { description: next.description, timeout_ms: next.timeout_ms, continue_on_failure: next.continue_on_failure, tags: next.tags, revision: next.revision } })
  const runStatus = activeRunId ? run.data?.status ?? 'queued' : null
  const compileMeta = preview && <span className="flow-tab-counts"><span className={preview.errors.length ? 'text-err' : 'text-ok'}>{preview.errors.length ? `${preview.errors.length} err` : 'ok'}</span></span>
  const runMeta = runStatus && <span aria-hidden="true" className={`status-dot ${runTone[runStatus] ?? ''}`} title={runStatus} />
  return (
    <FlowWorkspace
      context={context}
      documentInspector={<ScenarioSettingsInspector blocked={readOnly} edgeCount={document.edges.length} flowId={document.flow.id} nodeCount={document.nodes.length} onSettings={updateSettings} settings={settings} />}
      notice={notice}
      onExport={onExport}
      onImport={onImport}
      onSave={onSave}
      toolbarActions={<ScenarioToolbar onPreview={showCompile} onRun={runScenario} onValidate={validate} running={start.isPending} />}
      validationTabs={{
        activeTab: outputTab,
        onTabChange: setOutputTab,
        tabs: [
          { id: 'compile', label: 'Compile', meta: compileMeta, content: <CompiledScenarioPreview result={preview} /> },
          { id: 'run', label: 'Run', meta: runMeta, content: <ScenarioRunPanel activeRunId={activeRunId} run={run} /> },
        ],
      }}
    />
  )
}
