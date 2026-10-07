import type { ScenarioFlowSettings } from '../types/scenarioFlow'

/** Document-level scenario settings, shown in the inspector when nothing is selected. */
export function ScenarioSettingsInspector({ settings, onSettings, blocked, flowId, nodeCount, edgeCount }: {
  settings: ScenarioFlowSettings
  onSettings: (settings: ScenarioFlowSettings) => void
  blocked: boolean
  flowId: string
  nodeCount: number
  edgeCount: number
}) {
  return (
    <div className="flow-inspector-section flow-document-inspector scenario-settings">
      <dl className="kv-grid flow-identity">
        <div><dt>Scenario ID</dt><dd className="mono" title={flowId}>{flowId}</dd></div>
        <div><dt>Revision</dt><dd className="mono">r{settings.revision}</dd></div>
        <div><dt>Graph</dt><dd className="mono">{nodeCount} nodes · {edgeCount} edges</dd></div>
      </dl>
      <label className="flow-field flow-field-stacked">
        <span>Description</span>
        <textarea defaultValue={settings.description} disabled={blocked} key={`description-${settings.description}`} onBlur={(event) => { if (event.target.value !== settings.description) onSettings({ ...settings, description: event.target.value }) }} rows={3} />
      </label>
      <label className="flow-field">
        <span>Tags</span>
        <input defaultValue={settings.tags.join(', ')} disabled={blocked} key={`tags-${settings.tags.join(',')}`} onBlur={(event) => onSettings({ ...settings, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="comma separated" />
      </label>
      <label className="flow-field">
        <span>Timeout ms</span>
        <input className="mono" defaultValue={settings.timeout_ms} disabled={blocked} key={`timeout-${settings.timeout_ms}`} min="1" onBlur={(event) => { const timeout_ms = Number(event.target.value); if (timeout_ms !== settings.timeout_ms) onSettings({ ...settings, timeout_ms }) }} type="number" />
      </label>
      <label className="flow-field">
        <span>Continue on failure</span>
        <span className="flow-field-check"><input checked={settings.continue_on_failure} disabled={blocked} onChange={(event) => onSettings({ ...settings, continue_on_failure: event.target.checked })} type="checkbox" /> {settings.continue_on_failure ? 'Enabled' : 'Disabled'}</span>
      </label>
      <p className="flow-note">Select a step to edit it. Steps run in topological order from Start to End.</p>
    </div>
  )
}
