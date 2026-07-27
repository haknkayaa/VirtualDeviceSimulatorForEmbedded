import { Braces, CheckCircle2, FlaskConical } from 'lucide-react'

export function BehaviorToolbar({ onValidate, onPreview, onTest }: {
  onValidate: () => void
  onPreview: () => void
  onTest: () => void
}) {
  return <div className="flow-tool-group behavior-toolbar-actions">
    <button onClick={onValidate} title="Validate device flow" type="button"><CheckCircle2 size={15} /><span>Validate</span></button>
    <button onClick={onPreview} title="Compile preview" type="button"><Braces size={15} /><span>Compile</span></button>
    <button onClick={onTest} title="Toggle test panel" type="button"><FlaskConical size={15} /><span>Test</span></button>
  </div>
}
