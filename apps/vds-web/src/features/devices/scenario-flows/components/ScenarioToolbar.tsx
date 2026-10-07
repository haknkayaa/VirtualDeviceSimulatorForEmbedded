import { Braces, CheckCircle2, Loader2, Play } from 'lucide-react'

/** Scenario-specific commands rendered inside the editor's page-bar toolbar. Save lives in the shared toolbar. */
export function ScenarioToolbar({ onValidate, onPreview, onRun, running }: { onValidate: () => void; onPreview: () => void; onRun: () => void; running: boolean }) {
  return <>
    <button aria-label="Validate" className="button" onClick={onValidate} title="Validate against the live resource snapshot" type="button"><CheckCircle2 size={14} /><span className="flow-button-label">Validate</span></button>
    <button aria-label="Compile" className="button" onClick={onPreview} title="Compile preview" type="button"><Braces size={14} /><span className="flow-button-label">Compile</span></button>
    <button aria-label={running ? 'Starting…' : 'Run'} className="button" disabled={running} onClick={onRun} title="Compile and run on the scenario runtime" type="button">{running ? <Loader2 className="spin" size={14} /> : <Play size={14} />}<span className="flow-button-label">{running ? 'Starting…' : 'Run'}</span></button>
  </>
}
