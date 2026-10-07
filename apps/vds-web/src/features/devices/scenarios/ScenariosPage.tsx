import { useState } from 'react'
import { createPortal } from 'react-dom'
import { FlaskConical, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  useRun,
  useScenario,
  useScenarios,
  useStartScenario,
  useStartScenarioDefinition,
} from '../../../api/queries'
import { AsyncState } from '../../../components/AsyncState'
import { PageHeader } from '../../../components/PageHeader'
import { Panel } from '../../../components/Panel'
import { StatusBadge } from '../../../components/StatusBadge'
import { useRunStore } from '../../../stores/runStore'
import { formatVirtualTime, humanize } from '../../../utils/format'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import type { FlowListItem } from '../../flows/types/flow'
import { compileScenarioFlow } from '../scenario-flows/compiler/compileScenarioFlow'
import { scenarioSettings } from '../scenario-flows/types/scenarioFlow'
import '../devices.css'

type ScenarioSelection = { id: string; source: 'draft' | 'package' }

export function ScenariosPage({ deviceId, embedded = false, localScenarios = [], inspectorTarget = null, onDeleteDraft }: { deviceId: string; embedded?: boolean; localScenarios?: FlowListItem[]; inspectorTarget?: Element | null; onDeleteDraft?: (id: string, name: string) => void }) {
  const scenarios = useScenarios()
  const [selection, setSelection] = useState<ScenarioSelection | null>(null)
  const [draftRunError, setDraftRunError] = useState<string | null>(null)
  const deviceScenarios = scenarios.data?.filter((item) => item.device_ids.includes(deviceId))
  const selectionExists = selection?.source === 'draft'
    ? localScenarios.some((item) => item.id === selection.id)
    : selection?.source === 'package'
      ? deviceScenarios?.some((item) => item.id === selection.id)
      : false
  const effectiveSelection: ScenarioSelection | null = selectionExists
    ? selection
    : localScenarios[0]
      ? { id: localScenarios[0].id, source: 'draft' }
      : deviceScenarios?.[0]
        ? { id: deviceScenarios[0].id, source: 'package' }
        : null
  const selectedDraft = effectiveSelection?.source === 'draft' ? localScenarios.find((item) => item.id === effectiveSelection.id) : undefined
  const selectedDraftDocument = selectedDraft ? localFlowRepository.load(selectedDraft.id) : null
  const selectedPackage = effectiveSelection?.source === 'package' ? deviceScenarios?.find((item) => item.id === effectiveSelection.id) : undefined
  const scenarioId = selectedPackage?.id
  const scenario = useScenario(scenarioId)
  const start = useStartScenario()
  const startDefinition = useStartScenarioDefinition()
  const activeRunId = useRunStore((state) => state.activeRunId)
  const setActiveRunId = useRunStore((state) => state.setActiveRunId)
  const run = useRun(activeRunId)
  const editorBase = `/devices/${encodeURIComponent(deviceId)}/scenarios`
  const starting = start.isPending || startDefinition.isPending

  const handleRun = (id = scenarioId) => {
    if (!id) return
    setSelection({ id, source: 'package' })
    start.mutate(id, {
      onSuccess: (record) => {
        setActiveRunId(record.run_id)
      },
    })
  }
  const handleRunDraft = (id: string) => {
    const document = localFlowRepository.load(id)
    if (!document) { setDraftRunError('Draft definition is no longer available.'); return }
    const compiled = compileScenarioFlow(document)
    if (!compiled.document || compiled.errors.length) {
      setDraftRunError(compiled.errors[0]?.message ?? 'Draft validation failed.')
      return
    }
    setDraftRunError(null)
    setSelection({ id, source: 'draft' })
    startDefinition.mutate({ document: compiled.document, revision: document.flow.revision }, {
      onSuccess: (record) => setActiveRunId(record.run_id),
      onError: (error) => setDraftRunError(error.message),
    })
  }

  const inspectorAction = selectedDraft
    ? (
      <>
        <Link className="button button-sm" to={`${editorBase}/${encodeURIComponent(selectedDraft.id)}`}><Workflow aria-hidden="true" size={12} /> Edit flow</Link>
        <button className="button button-primary button-sm" disabled={starting} onClick={() => handleRunDraft(selectedDraft.id)} type="button"><Play aria-hidden="true" size={12} /> Run</button>
      </>
    )
    : selectedPackage
      ? <button className="button button-primary button-sm" disabled={starting} onClick={() => handleRun(selectedPackage.id)} type="button"><Play aria-hidden="true" size={12} /> Run</button>
      : undefined
  const inspectorTitle = selectedDraft?.name ?? scenario.data?.scenario.name ?? selectedPackage?.name ?? 'Test Scenario Inspector'
  const runMatchesSelection = run.data && (
    (selectedPackage && run.data.scenario_id === selectedPackage.id)
    || (selectedDraftDocument && run.data.scenario_id === selectedDraftDocument.flow.id)
  )

  const list = (
    <Panel
      actions={<Link className="button button-sm" to={`${editorBase}/new`}><Plus aria-hidden="true" size={12} /> New scenario</Link>}
      className="dv-tab-panel dv-scn-list"
      flush
      icon={FlaskConical}
      meta={`${localScenarios.length + (deviceScenarios?.length ?? 0)} for ${deviceId}`}
      title="Scenario Flows"
    >
      <div className="dv-table-scroll">
        <table className="data-table dv-scn-table">
          <colgroup><col /><col className="dv-scn-col-id" /><col className="dv-scn-col-steps" /><col className="dv-scn-col-timeout" /><col className="dv-scn-col-actions" /></colgroup>
          <thead>
            <tr><th>Scenario</th><th>ID</th><th className="num">Steps</th><th className="num">Timeout</th><th className="dv-cell-actions" /></tr>
          </thead>
          <tbody>
            {localScenarios.length > 0 && <tr className="group-row"><td colSpan={5}>Drafts <span className="count">{localScenarios.length}</span></td></tr>}
            {localScenarios.map((item) => {
              const active = effectiveSelection?.source === 'draft' && effectiveSelection.id === item.id
              const document = localFlowRepository.load(item.id)
              return (
                <tr aria-selected={active} className={`clickable${active ? ' selected' : ''}`} key={item.id} onClick={() => setSelection({ id: item.id, source: 'draft' })}>
                  <td className="dv-trunc" title={item.name}><span className="chip dv-chip-draft">draft r{item.revision}</span> <strong>{item.name}</strong></td>
                  <td className="mono dim dv-trunc" title={item.id}>{item.id}</td>
                  <td className="num dim">{document ? document.nodes.filter((node) => !node.kind.endsWith('.start') && !node.kind.endsWith('.end')).length : '—'}</td>
                  <td className="num dim">{document ? `${scenarioSettings(document).timeout_ms} ms` : '—'}</td>
                  <td className="dv-cell-actions" onClick={(event) => event.stopPropagation()}>
                    <Link aria-label={`Edit ${item.name} visual flow`} className="icon-button sm" title="Edit flow" to={`${editorBase}/${encodeURIComponent(item.id)}`}><Workflow aria-hidden="true" size={13} /></Link>
                    <button aria-label={`Run ${item.name}`} className="icon-button sm" disabled={starting} onClick={() => handleRunDraft(item.id)} title="Run draft" type="button"><Play aria-hidden="true" size={13} /></button>
                    {onDeleteDraft && <button aria-label={`Delete ${item.name}`} className="icon-button sm dv-danger" onClick={() => onDeleteDraft(item.id, item.name)} title="Delete draft" type="button"><Trash2 aria-hidden="true" size={13} /></button>}
                  </td>
                </tr>
              )
            })}
            <tr className="group-row"><td colSpan={5}>Packaged <span className="count">{deviceScenarios?.length ?? 0}</span></td></tr>
            {deviceScenarios?.map((item) => {
              const active = effectiveSelection?.source === 'package' && item.id === scenarioId
              return (
                <tr aria-selected={active} className={`clickable${active ? ' selected' : ''}`} key={item.id} onClick={() => setSelection({ id: item.id, source: 'package' })}>
                  <td className="dv-trunc" title={item.name}><strong>{item.name}</strong></td>
                  <td className="mono dim dv-trunc" title={item.id}>{item.id}</td>
                  <td className="num">{item.steps}</td>
                  <td className="num dim">{item.timeout_ms} ms</td>
                  <td className="dv-cell-actions" onClick={(event) => event.stopPropagation()}>
                    <Link aria-label={`Open ${item.name} in visual editor`} className="icon-button sm" title="Open flow" to={`${editorBase}/${encodeURIComponent(item.id)}`}><Workflow aria-hidden="true" size={13} /></Link>
                    <button aria-label={`Run ${item.name}`} className="icon-button sm" disabled={starting} onClick={() => handleRun(item.id)} title="Run scenario" type="button"><Play aria-hidden="true" size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {scenarios.isPending && <AsyncState kind="loading" title="Loading packaged scenarios" />}
        {scenarios.isError && <AsyncState detail={scenarios.error.message} kind="error" title="Scenarios unavailable" />}
        {deviceScenarios?.length === 0 && localScenarios.length === 0 && (
          <AsyncState
            detail={<>Create a scenario flow to define repeatable device interactions. <Link className="inline-link" to={`${editorBase}/new`}>Create test scenario</Link></>}
            kind="empty"
            title="No scenarios for this device"
          />
        )}
      </div>
    </Panel>
  )

  const inspector = (
    <Panel actions={inspectorAction} className="dv-scn-inspector" icon={FlaskConical} title={<span className="truncate" title={inspectorTitle}>{inspectorTitle}</span>}>
      <section aria-label="Scenario definition" className="dv-scn-section">
        <h3 className="panel-section-title dv-flush-title">Definition</h3>
        {!effectiveSelection && <AsyncState detail="Select or create a scenario flow." kind="empty" title="No scenario selected" />}
        {selectedDraft && !selectedDraftDocument && <AsyncState kind="error" title="Draft definition unavailable" />}
        {selectedDraftDocument && (
          <>
            <dl className="kv-grid">
              <div><dt>Source</dt><dd>Local draft</dd></div>
              <div><dt>Revision</dt><dd className="mono">r{selectedDraftDocument.flow.revision}</dd></div>
              <div><dt>Timeout</dt><dd className="mono">{scenarioSettings(selectedDraftDocument).timeout_ms} ms</dd></div>
            </dl>
            <ol className="dv-scn-steps">
              {selectedDraftDocument.nodes.filter((node) => !node.kind.endsWith('.start') && !node.kind.endsWith('.end')).map((node, index) => (
                <li key={node.id}><span className="count">{index + 1}</span><code>{String(node.data.step_id ?? node.id)}</code><span>{String(node.data.label ?? humanize(node.kind.split('.').slice(-1)[0] ?? node.kind))}</span></li>
              ))}
            </ol>
          </>
        )}
        {scenario.isPending && scenarioId && <AsyncState kind="loading" title="Loading definition" />}
        {scenario.isError && scenarioId && <AsyncState detail={scenario.error.message} kind="error" title="Definition unavailable" />}
        {scenario.data && (
          <>
            <dl className="kv-grid">
              <div><dt>ID</dt><dd className="mono">{scenario.data.scenario.id}</dd></div>
              <div><dt>Schema</dt><dd className="mono">v{scenario.data.schema_version}</dd></div>
              <div><dt>Timeout</dt><dd className="mono">{scenario.data.scenario.timeout_ms} ms</dd></div>
            </dl>
            <ol className="dv-scn-steps">
              {scenario.data.steps.map((step, index) => (
                <li key={step.id}><span className="count">{index + 1}</span><code>{step.id}</code><span>{humanize(step.action)}</span></li>
              ))}
            </ol>
          </>
        )}
        {start.isError && <AsyncState detail={start.error.message} kind="error" title="Scenario start failed" />}
        {draftRunError && <AsyncState detail={draftRunError} kind="error" title="Draft run failed" />}
      </section>

      <section aria-label="Scenario execution" className="dv-scn-section">
        <h3 className="panel-section-title dv-flush-title">Execution</h3>
        {!activeRunId && <AsyncState detail="Run a scenario to see its result here." kind="empty" title="No active run" />}
        {run.isPending && activeRunId && <AsyncState kind="loading" title={`Tracking ${activeRunId}`} />}
        {run.isError && <AsyncState detail={run.error.message} kind="error" title="Run status unavailable" />}
        {run.data && (
          <>
            <div className={`dv-scn-run${runMatchesSelection ? '' : ' other'}`}>
              <code>{run.data.run_id}</code>
              <span className="truncate">{run.data.scenario_id}</span>
              <StatusBadge status={run.data.status} />
            </div>
            {run.data.result && (
              <dl className="dv-scn-metrics">
                <div><dt>Passed</dt><dd className="text-ok">{run.data.result.steps_passed}</dd></div>
                <div><dt>Failed</dt><dd className={run.data.result.steps_failed ? 'text-err' : ''}>{run.data.result.steps_failed}</dd></div>
                <div><dt>Skipped</dt><dd>{run.data.result.steps_skipped}</dd></div>
                <div><dt>Duration</dt><dd>{formatVirtualTime(run.data.result.duration_virtual_ns)}</dd></div>
              </dl>
            )}
            {run.data.error && <AsyncState detail={run.data.error} kind="error" title="Run execution failed" />}
            {run.data.result && (
              <table className="data-table dv-scn-results">
                <colgroup><col className="dv-scn-col-result" /><col /><col className="dv-scn-col-time" /></colgroup>
                <thead><tr><th>Result</th><th>Step</th><th className="num">Δt</th></tr></thead>
                <tbody>
                  {run.data.result.steps.map((step) => (
                    <tr key={step.step_id} title={step.error ?? undefined}>
                      <td><StatusBadge status={step.status} /></td>
                      <td className="mono dv-scn-step" title={`${step.step_id} · ${humanize(step.action)}`}>{step.step_id}{step.error && <small className="dv-scn-error">{step.error}</small>}</td>
                      <td className="num dim">{formatVirtualTime(step.completed_virtual_ns - step.started_virtual_ns)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </Panel>
  )

  if (embedded) {
    return (
      <div className={`dv-scn${inspectorTarget ? ' inspector-external' : ''}`}>
        {list}
        {inspectorTarget ? createPortal(inspector, inspectorTarget) : inspector}
      </div>
    )
  }

  return (
    <div className="page dv-scn-page">
      <PageHeader context={<code>{deviceId}</code>} title="Test Scenarios" />
      <div className="page-body fill flush">
        <div className="dv-scn">
          {list}
          {inspectorTarget ? createPortal(inspector, inspectorTarget) : inspector}
        </div>
      </div>
    </div>
  )
}
