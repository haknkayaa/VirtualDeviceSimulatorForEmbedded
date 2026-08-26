import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clock3, FilePenLine, GitBranch, PackageCheck, Play, Plus, Trash2, Workflow, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  useRun,
  useScenario,
  useScenarios,
  useStartScenario,
  useStartScenarioDefinition,
} from '../../../api/queries'
import { AsyncState } from '../../../components/AsyncState'
import { GlassPanel } from '../../../components/GlassPanel'
import { PageHeader } from '../../../components/PageHeader'
import { StatusBadge } from '../../../components/StatusBadge'
import { useRunStore } from '../../../stores/runStore'
import { formatVirtualTime, humanize } from '../../../utils/format'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import type { FlowListItem } from '../../flows/types/flow'
import { compileScenarioFlow } from '../scenario-flows/compiler/compileScenarioFlow'
import { scenarioSettings } from '../scenario-flows/types/scenarioFlow'

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

  const selectScenario = (next: ScenarioSelection) => {
    setSelection(next)
  }
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
    ? <Link className="button button-secondary" to={`${editorBase}/${encodeURIComponent(selectedDraft.id)}`}><Workflow size={15} /> Edit flow</Link>
    : undefined
  const inspectorTitle = selectedDraft?.name ?? scenario.data?.scenario.name ?? selectedPackage?.name ?? 'Test Scenario Inspector'

  return (
    <div className={embedded ? 'device-scenario-runtime' : 'page-stack'}>
      {!embedded && <PageHeader
        eyebrow="Deterministic verification"
        title="Test Scenarios"
        description="Author scenario flows, run packaged tests, and inspect their authoritative results."
      />}
      <div className={`scenario-workspace-layout${inspectorTarget ? ' inspector-external' : ''}`}>
        <GlassPanel className="scenario-flow-list-panel" eyebrow="Test authoring" title="Scenario Flows">
          <div className="scenario-flow-list">
            <Link className="flow-list-new" to={`${editorBase}/new`}>
              <Plus size={21} />
              <div><strong>Create test scenario</strong><span>Build a deterministic test for {deviceId}.</span></div>
            </Link>

            {localScenarios.length > 0 && <section className="scenario-flow-group">
              <header><FilePenLine size={14} /><strong>Drafts</strong><span>{localScenarios.length}</span></header>
              {localScenarios.map((item) => (
                <article className={`scenario-flow-runtime-card ${effectiveSelection?.source === 'draft' && effectiveSelection.id === item.id ? 'active' : ''}`} key={item.id}>
                  <button className="scenario-flow-select" onClick={() => selectScenario({ id: item.id, source: 'draft' })} type="button">
                    <span>draft · r{item.revision}</span><strong>{item.name}</strong><small>{item.id}</small><div><GitBranch size={13} /> Local flow</div>
                  </button>
                  <div className={`scenario-flow-runtime-actions draft-actions${onDeleteDraft ? '' : ' without-delete'}`}>
                    <Link aria-label={`Edit ${item.name} visual flow`} to={`${editorBase}/${encodeURIComponent(item.id)}`}><Workflow size={14} /> Edit flow</Link>
                    <button aria-label={`Run ${item.name}`} disabled={startDefinition.isPending || start.isPending} onClick={() => handleRunDraft(item.id)} type="button"><Play size={14} /> {startDefinition.isPending && selectedDraft?.id === item.id ? 'Starting' : 'Run scenario'}</button>
                    {onDeleteDraft && <button aria-label={`Delete ${item.name}`} className="danger" onClick={() => onDeleteDraft(item.id, item.name)} type="button"><Trash2 size={14} /> Delete</button>}
                  </div>
                </article>
              ))}
            </section>}

            <section className="scenario-flow-group">
              <header><PackageCheck size={14} /><strong>Packaged &amp; runnable</strong><span>{deviceScenarios?.length ?? 0}</span></header>
              {scenarios.isPending && <AsyncState kind="loading" title="Loading packaged scenarios" />}
              {scenarios.isError && <AsyncState detail={scenarios.error.message} kind="error" title="Scenarios unavailable" />}
              {deviceScenarios?.length === 0 && <AsyncState kind="empty" title="No packaged scenarios for this device" />}
              {deviceScenarios?.map((item) => (
                <article className={`scenario-flow-runtime-card ${effectiveSelection?.source === 'package' && item.id === scenarioId ? 'active' : ''}`} key={item.id}>
                  <button className="scenario-flow-select" onClick={() => selectScenario({ id: item.id, source: 'package' })} type="button">
                    <span>{item.steps} steps</span><strong>{item.name}</strong><small>{item.id}</small><div><Clock3 size={13} /> {item.timeout_ms} ms</div>
                  </button>
                  <div className="scenario-flow-runtime-actions">
                    <Link aria-label={`Open ${item.name} in visual editor`} to={`${editorBase}/${encodeURIComponent(item.id)}`}><Workflow size={14} /> Open flow</Link>
                    <button aria-label={`Run ${item.name}`} disabled={start.isPending || startDefinition.isPending} onClick={() => handleRun(item.id)} type="button"><Play size={14} /> {start.isPending && item.id === scenarioId ? 'Starting' : 'Run scenario'}</button>
                  </div>
                </article>
              ))}
            </section>
          </div>
        </GlassPanel>

        {(() => { const panel = <GlassPanel action={inspectorAction} className="scenario-inspector-panel" eyebrow="Selected test scenario" title={inspectorTitle}>
          <div className="scenario-inspector-content">
            <section aria-label="Scenario definition" className="scenario-inspector-section">
              <header><span>01</span><div><strong>Definition</strong><small>Authored steps and runtime settings</small></div></header>
              <div className="scenario-inspector-section-body">
              {!effectiveSelection && <AsyncState detail="Create a scenario flow on the left to define repeatable device interactions." kind="empty" title="No scenario flows yet" />}
              {selectedDraft && !selectedDraftDocument && <AsyncState kind="error" title="Draft definition unavailable" />}
              {selectedDraftDocument && <div className="scenario-definition">
                <div className="scenario-meta"><span>Source <strong>Draft</strong></span><span>Revision <strong>r{selectedDraftDocument.flow.revision}</strong></span><span>Timeout <strong>{scenarioSettings(selectedDraftDocument).timeout_ms} ms</strong></span></div>
                <ol>{selectedDraftDocument.nodes.filter((node) => !node.kind.endsWith('.start') && !node.kind.endsWith('.end')).map((node) => <li key={node.id}><span>{String(node.data.step_id ?? node.id)}</span><strong>{String(node.data.label ?? humanize(node.kind.split('.').slice(-1)[0] ?? node.kind))}</strong></li>)}</ol>
              </div>}
              {scenario.isPending && scenarioId && <AsyncState kind="loading" title="Loading definition" />}
              {scenario.isError && scenarioId && <AsyncState detail={scenario.error.message} kind="error" title="Definition unavailable" />}
              {scenario.data && <div className="scenario-definition">
                <div className="scenario-meta"><span>ID <strong>{scenario.data.scenario.id}</strong></span><span>Schema <strong>v{scenario.data.schema_version}</strong></span><span>Timeout <strong>{scenario.data.scenario.timeout_ms} ms</strong></span></div>
                <ol>{scenario.data.steps.map((step) => <li key={step.id}><span>{step.id}</span><strong>{humanize(step.action)}</strong></li>)}</ol>
              </div>}
              {start.isError && <AsyncState detail={start.error.message} kind="error" title="Scenario start failed" />}
              {draftRunError && <AsyncState detail={draftRunError} kind="error" title="Draft run failed" />}
              </div>
            </section>

            <section aria-label="Scenario execution" className="scenario-inspector-section">
              <header><span>02</span><div><strong>Execution</strong><small>Current run status and step progress</small></div></header>
              <div className="scenario-inspector-section-body">
              {!activeRunId && <AsyncState detail="Select a packaged scenario and start a run." kind="empty" title="No active run" />}
              {run.isPending && activeRunId && <AsyncState kind="loading" title={`Tracking ${activeRunId}`} />}
              {run.isError && <AsyncState detail={run.error.message} kind="error" title="Run status unavailable" />}
              {run.data && <div className="run-detail">
                <div className="run-meta"><span>{run.data.run_id}</span><strong>{run.data.scenario_id}</strong><StatusBadge status={run.data.status} /></div>
                {run.data.result && <div className="result-metrics"><span><Check size={15} />{run.data.result.steps_passed} passed</span><span><X size={15} />{run.data.result.steps_failed} failed</span><span><Clock3 size={15} />{formatVirtualTime(run.data.result.duration_virtual_ns)}</span></div>}
                {run.data.error && <AsyncState detail={run.data.error} kind="error" title="Run execution failed" />}
                {run.data.result && <div className="step-results">{run.data.result.steps.map((step) => <article key={step.step_id}><StatusBadge status={step.status} /><div><strong>{step.step_id}</strong><span>{humanize(step.action)}</span>{step.error && <small>{step.error}</small>}</div><time>{formatVirtualTime(step.completed_virtual_ns - step.started_virtual_ns)}</time></article>)}</div>}
              </div>}
              </div>
            </section>

          </div>
        </GlassPanel>; return inspectorTarget ? createPortal(panel, inspectorTarget) : panel })()}
      </div>
    </div>
  )
}
