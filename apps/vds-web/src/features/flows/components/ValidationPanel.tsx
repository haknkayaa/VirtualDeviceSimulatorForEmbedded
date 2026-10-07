import { type ReactNode, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Copy, Trash2 } from 'lucide-react'

import type { ValidationIssue } from '../types/flow'
import { useFlowStore } from '../store/flowStore'
import { flowDocumentName } from './flowLabels'

function propertyLabel(ruleId: string) {
  const properties: [RegExp, string][] = [
    [/state-name/, 'state_name'],
    [/trigger-type/, 'trigger_type'],
    [/trigger/, 'trigger'],
    [/guard-register|missing-guard/, 'guard_register'],
    [/guard-value|unsupported-guard/, 'guard_equals / guard_mask'],
    [/priority/, 'priority'],
    [/delay/, 'delay_value / delay_unit'],
    [/action-register|missing-register-resource|read-only-register/, 'actions.register'],
    [/action-value|value-overflow/, 'actions.value'],
    [/unsupported-action/, 'actions.kind'],
    [/label/, 'label'],
    [/device/, 'device_id'],
    [/fault/, 'fault_id'],
    [/spi-hex/, 'tx_hex'],
    [/result-name/, 'save_as'],
    [/response-capacity/, 'response_capacity'],
    [/duration/, 'duration / unit'],
    [/timeout/, 'timeout / timeout_unit'],
    [/expected-state|missing-state/, 'expected_state'],
    [/expected|response-hex/, 'expected'],
    [/result-reference/, 'source'],
    [/error-code/, 'expected_code'],
    [/event/, 'event_type'],
    [/source-handle|edge-source/, 'source'],
    [/target-handle|edge-target/, 'target'],
    [/node-kind|edge-kind/, 'kind'],
    [/node-id|edge-id/, 'id'],
    [/orphan|incoming|unreachable|endpoint|connection|cycle|self-loop|outgoing|disconnected/, 'connections'],
  ]
  return properties.find(([pattern]) => pattern.test(ruleId))?.[1] ?? ruleId
}

interface ValidationPanelProps {
  issues: ValidationIssue[]
  tabConfig?: {
    activeTab: string
    onTabChange: (tab: string) => void
    tabs: { id: string; label: string; meta?: ReactNode; content: ReactNode }[]
  }
}

export function ValidationPanel({ issues, tabConfig }: ValidationPanelProps) {
  const visible = useFlowStore((state) => state.validationVisible)
  const setVisible = useFlowStore((state) => state.setValidationVisible)
  const select = useFlowStore((state) => state.select)
  const document = useFlowStore((state) => state.document)
  const documentName = flowDocumentName(document.flow.kind)
  const [clearedSignature, setClearedSignature] = useState<string | null>(null)
  const [focusedIssue, setFocusedIssue] = useState<string | null>(null)
  const signature = useMemo(
    () => issues.map((issue) => `${issue.severity}:${issue.ruleId}:${issue.nodeId ?? ''}:${issue.edgeId ?? ''}:${issue.message}`).join('|'),
    [issues],
  )
  const cleared = clearedSignature === signature
  const validationActive = !tabConfig || tabConfig.activeTab === 'validate'
  const activeCustomTab = tabConfig?.tabs.find((tab) => tab.id === tabConfig.activeTab)
  if (!visible) return null
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  const copyIssues = () => {
    const output = issues.length === 0
      ? `${documentName} is valid. No validation issues.`
      : issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.ruleId}: ${issue.message}`).join('\n')
    void navigator.clipboard.writeText(output)
  }
  const problemsMeta = <span className="flow-tab-counts">
    {errors > 0 && <span className="text-err"><AlertCircle aria-hidden="true" size={11} />{errors}</span>}
    {warnings > 0 && <span className="text-warn"><AlertTriangle aria-hidden="true" size={11} />{warnings}</span>}
    {issues.length === 0 && <span className="tab-count">0</span>}
  </span>
  return (
    <section className="flow-validation" aria-label="Validation terminal">
      <header className="flow-validation-header">
        <div aria-label={`${documentName} output`} className="tabs flow-output-tabs" role="tablist">
          <button aria-selected={validationActive} className={validationActive ? 'active' : ''} onClick={() => tabConfig?.onTabChange('validate')} role="tab" type="button">Problems {problemsMeta}</button>
          {tabConfig?.tabs.map((tab) => <button aria-selected={tab.id === tabConfig.activeTab} className={tab.id === tabConfig.activeTab ? 'active' : ''} key={tab.id} onClick={() => tabConfig.onTabChange(tab.id)} role="tab" type="button">{tab.label}{tab.meta}</button>)}
        </div>
        <div className="flow-terminal-actions">
          {validationActive && <>
            <button aria-label="Copy validation output" className="icon-button sm" onClick={copyIssues} title="Copy output" type="button"><Copy size={13} /></button>
            <button aria-label="Clear validation output" className="icon-button sm" disabled={cleared} onClick={() => setClearedSignature(signature)} title="Clear output" type="button"><Trash2 size={13} /></button>
          </>}
          <button aria-label="Hide bottom panel" className="icon-button sm" onClick={() => setVisible(false)} title="Hide panel" type="button"><ChevronDown size={14} /></button>
        </div>
      </header>
      {validationActive && <div aria-label="Validate output" className="flow-output-tab-panel" role="tabpanel">
        {cleared && <div className="flow-empty inline"><strong>Output cleared</strong><span>New problems appear when the document changes.</span></div>}
        {!cleared && issues.length === 0 && <div className="flow-empty inline"><CheckCircle2 aria-hidden="true" className="text-ok" size={14} /><strong>{documentName} is valid</strong><span>No validation issues found.</span></div>}
        {!cleared && issues.length > 0 && <div className="flow-issue-list">
          {issues.map((issue, index) => {
            const key = `${issue.ruleId}-${issue.nodeId ?? ''}-${issue.edgeId ?? ''}-${index}`
            const targetId = issue.nodeId ?? issue.edgeId
            const targetKind = issue.nodeId
              ? document.nodes.find((node) => node.id === issue.nodeId)?.kind ?? 'node'
              : issue.edgeId
                ? document.edges.find((edge) => edge.id === issue.edgeId)?.kind ?? 'edge'
                : 'document'
            return (
              <button
                className={`flow-issue issue-${issue.severity}${focusedIssue === key ? ' focused' : ''}`}
                key={key}
                onClick={() => {
                  setFocusedIssue(key)
                  select(issue.nodeId ? [issue.nodeId] : [], issue.edgeId ? [issue.edgeId] : [])
                }}
                type="button"
              >
                {issue.severity === 'error' ? <AlertCircle aria-hidden="true" className="text-err" size={13} /> : <AlertTriangle aria-hidden="true" className="text-warn" size={13} />}
                <span className="flow-issue-message" title={issue.message}>{issue.message}</span>
                <code className="flow-issue-rule" title={issue.ruleId}>{issue.ruleId}</code>
                <code className="flow-issue-target" title={targetKind}>{targetId ? `${issue.nodeId ? 'node' : 'edge'}:${targetId}` : 'document'}</code>
                <code className="flow-issue-property">{propertyLabel(issue.ruleId)}</code>
              </button>
            )
          })}
        </div>}
      </div>}
      {!validationActive && activeCustomTab && <div aria-label={`${activeCustomTab.label} output`} className="flow-output-tab-panel" role="tabpanel">{activeCustomTab.content}</div>}
    </section>
  )
}
