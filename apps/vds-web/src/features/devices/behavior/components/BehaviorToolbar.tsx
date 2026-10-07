import { Braces, CheckCircle2, FlaskConical } from 'lucide-react'

export function BehaviorToolbar({ onValidate, onPreview, onTest, testing }: {
  onValidate: () => void
  onPreview: () => void
  onTest: () => void
  testing: boolean
}) {
  return <>
    <button aria-label="Validate" className="button" onClick={onValidate} title="Validate behavior model" type="button"><CheckCircle2 size={14} /><span className="flow-button-label">Validate</span></button>
    <button aria-label="Compile" className="button" onClick={onPreview} title="Compile preview" type="button"><Braces size={14} /><span className="flow-button-label">Compile</span></button>
    <button aria-label="Test" aria-pressed={testing} className="button" onClick={onTest} title="Observe the runtime device on the canvas" type="button"><FlaskConical size={14} /><span className="flow-button-label">Test</span></button>
  </>
}
