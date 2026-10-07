import { CircleAlert, Plus, X } from 'lucide-react'
import { useState } from 'react'

import { BusTag } from '../../components/BusTag'
import type { Adapter, CreateAdapterInput } from '../../types/api'
import { adapterBuses, adapterBusSpecs, formatFrequency, suggestAdapter, type AdapterBus } from './adapterModel'

interface CreateAdapterFormProps {
  adapters: Adapter[]
  errorMessage?: string
  isPending: boolean
  onCancel: () => void
  onCreate: (input: CreateAdapterInput) => void
}

/** Inspector-mode form for a new host adapter. Field defaults avoid existing ids and bus numbers. */
export function CreateAdapterForm({ adapters, errorMessage, isPending, onCancel, onCreate }: CreateAdapterFormProps) {
  const [initial] = useState(() => suggestAdapter('spi', adapters))
  const [busType, setBusType] = useState<AdapterBus>('spi')
  const [id, setId] = useState(initial.id)
  const [name, setName] = useState(initial.name)
  const [busNumber, setBusNumber] = useState(String(initial.busNumber))
  const [lineCount, setLineCount] = useState('32')
  const [maxFrequency, setMaxFrequency] = useState(String(adapterBusSpecs.spi.defaultMaxFrequencyHz))

  const spec = adapterBusSpecs[busType]
  const changeBusType = (next: AdapterBus) => {
    const suggestion = suggestAdapter(next, adapters)
    setBusType(next)
    setId(suggestion.id)
    setName(suggestion.name)
    setBusNumber(String(suggestion.busNumber))
    if (adapterBusSpecs[next].defaultMaxFrequencyHz) setMaxFrequency(String(adapterBusSpecs[next].defaultMaxFrequencyHz))
  }

  const trimmedId = id.trim()
  const idTaken = adapters.some((adapter) => adapter.id === trimmedId)
  const busNumberValue = Number(busNumber)
  const busNumberTaken = busType !== 'gpio' && adapters.find(
    (adapter) => adapter.bus_type === busType && adapter.bus_number === busNumberValue,
  )
  const needsFrequency = busType === 'spi' || busType === 'i2c'
  const invalid = isPending || !trimmedId || !name.trim() || idTaken || (needsFrequency && !maxFrequency)
  const nodePreview = busType === 'spi'
    ? `/dev/spidev${busNumber || 'B'}.C`
    : busType === 'i2c'
      ? `/dev/i2c-${busNumber || 'N'}`
      : spec.nodePattern

  const submit = () => {
    if (invalid) return
    onCreate(busType === 'gpio'
      ? { id: trimmedId, name, bus_type: busType, line_count: Number(lineCount) }
      : { id: trimmedId, name, bus_type: busType, bus_number: busNumberValue, ...(busType === 'uart' ? {} : { max_frequency_hz: Number(maxFrequency) }) })
  }

  return (
    <form
      aria-label="New adapter"
      className="panel adp-inspector adp-create"
      onSubmit={(event) => { event.preventDefault(); submit() }}
    >
      <header className="adp-inspector-head">
        <Plus aria-hidden="true" className="faint" size={14} />
        <h2>New adapter</h2>
        <BusTag bus={busType} />
        <code className="adp-inspector-id">{trimmedId || '—'}</code>
        <div className="adp-inspector-actions">
          <button aria-label="Close new adapter form" className="icon-button" onClick={onCancel} type="button"><X aria-hidden="true" size={14} /></button>
        </div>
      </header>

      <div className="adp-inspector-body">
        {errorMessage && (
          <div className="inline-alert error" role="alert">
            <CircleAlert aria-hidden="true" size={14} />
            <span><strong>Adapter could not be created.</strong> {errorMessage}</span>
          </div>
        )}

        <section className="adp-section">
          <h3 className="panel-section-title">Bus</h3>
          <div className="adp-form-grid">
            <label className="field">
              <span>Bus type</span>
              <select onChange={(event) => changeBusType(event.target.value as AdapterBus)} value={busType}>
                {adapterBuses.map((bus) => <option key={bus} value={bus}>{adapterBusSpecs[bus].label}</option>)}
              </select>
            </label>
            <div className="field">
              <span>Linux ABI</span>
              <div className="adp-abi-readout"><span className="adp-bus-driver">{spec.driver}</span><code>{nodePreview}</code></div>
            </div>
          </div>
        </section>

        <section className="adp-section">
          <h3 className="panel-section-title">Identity</h3>
          <div className="adp-form-grid">
            <label className="field">
              <span>Name</span>
              <input onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label className="field">
              <span>Adapter ID</span>
              <input aria-invalid={idTaken} className="mono" onChange={(event) => setId(event.target.value)} spellCheck={false} value={id} />
              {idTaken && <small className="adp-field-error">An adapter with this id already exists.</small>}
            </label>
          </div>
        </section>

        <section className="adp-section">
          <h3 className="panel-section-title">{spec.label} configuration</h3>
          <div className="adp-form-grid">
            {busType === 'gpio' ? (
              <label className="field">
                <span>Line count</span>
                <select onChange={(event) => setLineCount(event.target.value)} value={lineCount}>
                  <option value="8">8 lines</option>
                  <option value="16">16 lines</option>
                  <option value="32">32 lines</option>
                </select>
                <small>The kernel assigns the gpiochip number when the adapter loads.</small>
              </label>
            ) : (
              <label className="field">
                <span>Bus number</span>
                <input className="mono" min="0" onChange={(event) => setBusNumber(event.target.value)} type="number" value={busNumber} />
                {busNumberTaken && <small className="adp-field-warn">{busNumberTaken.id} already uses {spec.label} bus {busNumberValue}.</small>}
              </label>
            )}
            {needsFrequency && (
              <label className="field">
                <span>Maximum frequency (Hz)</span>
                <input className="mono" min="1" onChange={(event) => setMaxFrequency(event.target.value)} type="number" value={maxFrequency} />
                <small>{formatFrequency(Number(maxFrequency))}</small>
              </label>
            )}
          </div>
        </section>

        <p className="adp-note">
          Created unloaded. Attach a virtual device, then load the adapter to expose <code>{nodePreview}</code>
          {spec.kernelModule ? <> (requires the <code>{spec.kernelModule}</code> kernel module)</> : null}.
        </p>
      </div>

      <footer className="adp-inspector-foot">
        <button className="button" onClick={onCancel} type="button">Cancel</button>
        <button className="button button-primary" disabled={invalid} type="submit">Create Adapter</button>
      </footer>
    </form>
  )
}
