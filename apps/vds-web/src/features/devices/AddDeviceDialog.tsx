import { Cpu, Info, Plus, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import type { CreateDeviceInput, DeviceTemplate } from '../../types/api'

interface AddDeviceDialogProps {
  defaultDeviceId: string
  errorMessage?: string
  isCreating: boolean
  isLoadingTemplates: boolean
  onClose: () => void
  onSubmit: (input: CreateDeviceInput) => void
  templates: DeviceTemplate[]
}

const deviceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const busTypes = ['gpio', 'spi', 'i2c', 'qspi', 'uart', 'ethernet'] as const

export function AddDeviceDialog({
  defaultDeviceId,
  errorMessage,
  isCreating,
  isLoadingTemplates,
  onClose,
  onSubmit,
  templates,
}: AddDeviceDialogProps) {
  const [deviceId, setDeviceId] = useState(defaultDeviceId)
  const [busType, setBusType] = useState('')
  const [templateId, setTemplateId] = useState('')
  const effectiveTemplateId = templates.some((template) => template.id === templateId)
    ? templateId
    : templates[0]?.id || ''
  const selectedTemplate = templates.find((template) => template.id === effectiveTemplateId)
  const effectiveBusType = busType || selectedTemplate?.bus.toLowerCase() || 'spi'
  const availableBusTypes = new Set(templates.map((template) => template.bus.toLowerCase()))
  const idError = deviceId.length > 0 && !deviceIdPattern.test(deviceId)
    ? 'Use 1–64 letters, numbers, dots, underscores or hyphens.'
    : undefined
  const canSubmit = Boolean(effectiveTemplateId && deviceId && !idError && !isCreating)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit({ template_id: effectiveTemplateId, device_id: deviceId })
  }

  return (
    <div aria-labelledby="add-device-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <form className="glass-panel add-device-dialog" onSubmit={submit}>
        <header>
          <span className="add-device-dialog-icon"><Cpu aria-hidden="true" size={20} /></span>
          <div>
            <p>Runtime instance</p>
            <h2 id="add-device-title">Add Device</h2>
            <span>Create an independent device from one configured model.</span>
          </div>
          <button aria-label="Close Add Device" className="icon-button" disabled={isCreating} onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="add-device-fields">
          <label>
            <span>Bus type</span>
            <select
              aria-label="Bus type"
              onChange={(event) => {
                setBusType(event.target.value)
                const matchingTemplate = templates.find(
                  (template) => template.bus.toLowerCase() === event.target.value,
                )
                setTemplateId(matchingTemplate?.id ?? '')
              }}
              value={effectiveBusType}
            >
              {busTypes.map((bus) => (
                <option disabled={!availableBusTypes.has(bus)} key={bus} value={bus}>{bus.toUpperCase()}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Device model</span>
            <select
              aria-label="Device model"
              disabled={isLoadingTemplates || templates.length === 0}
              onChange={(event) => {
                setTemplateId(event.target.value)
                const template = templates.find((item) => item.id === event.target.value)
                setBusType(template?.bus.toLowerCase() ?? '')
              }}
              value={effectiveTemplateId}
            >
              {isLoadingTemplates && <option value="">Loading configured models…</option>}
              {!isLoadingTemplates && templates.length === 0 && <option value="">No configured models</option>}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.bus.toUpperCase()}</option>
              ))}
            </select>
          </label>

          <div className="add-device-field">
            <label htmlFor="new-device-id"><span>Device instance ID</span></label>
            <input
              aria-describedby={idError ? 'device-id-error' : 'device-id-help'}
              aria-invalid={Boolean(idError)}
              autoFocus
              id="new-device-id"
              maxLength={64}
              onChange={(event) => setDeviceId(event.target.value)}
              placeholder="spi-flash-1"
              value={deviceId}
            />
            {idError
              ? <small className="field-error" id="device-id-error">{idError}</small>
              : <small id="device-id-help">Must be unique in the current environment.</small>}
          </div>

          <label>
            <span>Environment</span>
            <input disabled value="Local simulator" />
          </label>

          {effectiveBusType === 'spi' && (
            <div className="add-device-field">
              <label htmlFor="new-device-path"><span>Suggested device path</span></label>
              <input
                aria-describedby="device-path-help"
                disabled
                id="new-device-path"
                value="/dev/spidev0.0"
              />
              <small id="device-path-help">
                Created by the SPI CUSE adapter for {deviceId || '<device-id>'}.
              </small>
            </div>
          )}
        </div>

        <aside className="add-device-runtime-note">
          <Info aria-hidden="true" size={15} />
          <span>This creates an in-memory runtime instance. Start the bus-specific adapter from Configuration to create its kernel device node.</span>
        </aside>

        {errorMessage && <p className="add-device-error" role="alert">{errorMessage}</p>}

        <footer>
          <button className="button button-secondary" disabled={isCreating} onClick={onClose} type="button">Cancel</button>
          <button className="button button-primary" disabled={!canSubmit} type="submit">
            <Plus aria-hidden="true" size={15} /> {isCreating ? 'Creating…' : 'Create Instance'}
          </button>
        </footer>
      </form>
    </div>
  )
}
