import { Braces, CheckCircle2, FlaskConical, Save } from 'lucide-react'

import type { Device } from '../../../types/api'
import type { BehaviorSettings } from '../types/deviceBehaviorFlow'

export function BehaviorToolbar({ devices, settings, readOnly, onSettings, onValidate, onPreview, onTest, onSave }: {
  devices: Device[]
  settings: BehaviorSettings
  readOnly: boolean
  onSettings: (settings: BehaviorSettings) => void
  onValidate: () => void
  onPreview: () => void
  onTest: () => void
  onSave: () => void
}) {
  const knownDevice = devices.some((device) => device.id === settings.device_id)
  return <div className="behavior-toolbar glass-panel">
    <div className="behavior-toolbar-copy"><strong>Device Behavior</strong><span>Edge-centric state-machine authoring</span></div>
    <label><span>Runtime device</span><select disabled={readOnly} onChange={(event) => onSettings({ ...settings, device_id: event.target.value })} value={settings.device_id}>
      <option value="">Compile without snapshot</option>
      {settings.device_id && !knownDevice && <option value={settings.device_id}>Missing: {settings.device_id}</option>}
      {devices.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
    </select></label>
    <button onClick={onValidate} type="button"><CheckCircle2 size={15} /> Validate</button>
    <button onClick={onPreview} type="button"><Braces size={15} /> Compile preview</button>
    <button onClick={onTest} type="button"><FlaskConical size={15} /> Test panel</button>
    <button disabled={readOnly} onClick={onSave} type="button"><Save size={15} /> Save</button>
  </div>
}
