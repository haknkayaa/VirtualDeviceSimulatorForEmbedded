import { type ReactNode, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Trash2 } from 'lucide-react'

import type { ValidationIssue } from '../types/flow'
import { useFlowStore } from '../store/flowStore'

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
    tabs: { id: string; label: string; content: ReactNode }[]
  }
}

export function ValidationPanel({ issues, tabConfig }: ValidationPanelProps) {
  const visible = useFlowStore((state) => state.validationVisible)
  const select = useFlowStore((state) => state.select)
  const document = useFlowStore((state) => state.document)
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
  const copyIssues = () => {
    const output = issues.length === 0
      ? 'Flow is valid. No validation issues.'
      : issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.ruleId}: ${issue.message}`).join('\n')
    void navigator.clipboard.writeText(output)
  }
  return (
    <aside className="flow-validation flow-frosted" aria-label="Validation terminal">
      <header>
        {tabConfig
          ? <div aria-label="Flow output" className="flow-output-tabs" role="tablist">
              <button aria-selected={validationActive} className={validationActive ? 'active' : ''} onClick={() => tabConfig.onTabChange('validate')} role="tab" type="button">Validate</button>
              {tabConfig.tabs.map((tab) => <button aria-selected={tab.id === tabConfig.activeTab} className={tab.id === tabConfig.activeTab ? 'active' : ''} key={tab.id} onClick={() => tabConfig.onTabChange(tab.id)} role="tab" type="button">{tab.label}</button>)}
            </div>
          : <strong>Pluggable rules</strong>}
        {validationActive && <div className="flow-terminal-actions">
          <span>{issues.length} issues</span>
          <button aria-label="Copy validation output" onClick={copyIssues} title="Copy output" type="button"><Copy size={14} /></button>
          <button aria-label="Clear validation output" disabled={cleared} onClick={() => setClearedSignature(signature)} title="Clear output" type="button"><Trash2 size={14} /></button>
        </div>}
      </header>
      {validationActive && <div aria-label="Validate output" className="flow-output-tab-panel" role="tabpanel">
        {cleared && <div className="flow-panel-empty flow-terminal-cleared"><strong>Terminal cleared</strong></div>}
        {!cleared && issues.length === 0 && <div className="flow-panel-empty flow-valid"><CheckCircle2 size={21} /><strong>Flow is valid</strong><span>No generic validation issues.</span></div>}
        <div className="flow-issue-list">
          {!cleared && issues.map((issue, index) => {
          const key = `${issue.ruleId}-${issue.nodeId ?? ''}-${issue.edgeId ?? ''}-${index}`
          const targetId = issue.nodeId ?? issue.edgeId
          const targetKind = issue.nodeId
            ? document.nodes.find((node) => node.id === issue.nodeId)?.kind ?? 'node'
            : issue.edgeId
              ? document.edges.find((edge) => edge.id === issue.edgeId)?.kind ?? 'edge'
              : 'flow'
          return (
          <button className={focusedIssue === key ? 'focused' : ''} key={key} onClick={() => {
            setFocusedIssue(key)
            select(issue.nodeId ? [issue.nodeId] : [], issue.edgeId ? [issue.edgeId] : [])
          }} type="button">
            {issue.severity === 'error' ? <AlertCircle size={15} /> : <AlertTriangle size={15} />}
            <div><strong>{issue.message}</strong><small>{issue.ruleId}</small></div>
            <span className="flow-issue-target">
              <b>{targetId ? `${issue.nodeId ? 'node' : 'edge'} · ${targetId}` : 'flow'}</b>
              <code>{targetKind}</code>
              <em>{propertyLabel(issue.ruleId)}</em>
            </span>
          </button>
          )
          })}
        </div>
      </div>}
      {!validationActive && activeCustomTab && <div aria-label={`${activeCustomTab.label} output`} className="flow-output-tab-panel" role="tabpanel">{activeCustomTab.content}</div>}
    </aside>
  )
}
