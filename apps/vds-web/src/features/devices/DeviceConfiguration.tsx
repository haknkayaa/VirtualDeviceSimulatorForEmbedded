import { Cable, Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAttachAdapterDevice, useDetachAdapterDevice } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import type { Adapter, AdapterBinding, Device } from '../../types/api'
import { formatEndpoint } from '../../utils/endpoints'
import { readSpiInterfaceConfiguration, type SpiInterfaceConfiguration } from './spiInterfaceConfiguration'

interface DeviceConfigurationProps {
  device: Device
  adapters: Adapter[]
  adapter?: Adapter
  binding?: AdapterBinding
  onSaveStateChange?: (state: {
    dirty: boolean
    busy: boolean
    save: () => void
    summary?: { devicePath: string; adapterId: string; endpoint: number; driver: string }
  }) => void
}

interface Draft extends SpiInterfaceConfiguration {
  adapterId: string
  endpoint: number
}

export function DeviceConfiguration({ device, adapters, adapter, binding, onSaveStateChange }: DeviceConfigurationProps) {
  const attach = useAttachAdapterDevice()
  const detach = useDetachAdapterDevice()
  const initial = useMemo<Draft>(() => ({
    ...readSpiInterfaceConfiguration(device.id),
    adapterId: adapter?.id ?? adapters.find((candidate) => candidate.bus_type === 'spi')?.id ?? '',
    endpoint: binding?.endpoint ?? 0,
  }), [adapter?.id, adapters, binding?.endpoint, device.id])
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string>()

  const spiAdapters = adapters.filter((candidate) => candidate.bus_type === 'spi')
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const busy = attach.isPending || detach.isPending
  const selectedAdapter = spiAdapters.find((candidate) => candidate.id === draft.adapterId)
  const devicePath = selectedAdapter ? `/dev/spidev${selectedAdapter.bus_number}.${draft.endpoint}` : '—'
  const deviceName = devicePath.replace('/dev/', '')
  const adapterCommand = selectedAdapter
    ? `sudo build/adapters/spi-cuse/vds4e-spi-cuse --name ${deviceName} --device-id ${device.id} --socket /tmp/vds4e.sock`
    : 'Assign an SPI adapter first.'

  const save = useCallback(async () => {
    setError(undefined)
    try {
      const topologyChanged = draft.adapterId !== (adapter?.id ?? '') || draft.endpoint !== (binding?.endpoint ?? 0)
      if (topologyChanged && adapter && binding) {
        await detach.mutateAsync({ adapterId: adapter.id, deviceId: device.id })
      }
      if (topologyChanged) {
        await attach.mutateAsync({ adapterId: draft.adapterId, device_id: device.id, endpoint: draft.endpoint })
      }
      const interfaceConfig: SpiInterfaceConfiguration = {
        maxClockHz: draft.maxClockHz,
        cpol: draft.cpol,
        cpha: draft.cpha,
        bitsPerWord: draft.bitsPerWord,
        lsbFirst: draft.lsbFirst,
      }
      localStorage.setItem(`vds4e.spi.${device.id}`, JSON.stringify(interfaceConfig))
      setSaved(draft)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save SPI configuration.')
    }
  }, [adapter, attach, binding, detach, device.id, draft])

  useEffect(() => {
    onSaveStateChange?.({
      dirty,
      busy,
      save: () => void save(),
      summary: selectedAdapter ? {
        devicePath,
        adapterId: selectedAdapter.id,
        endpoint: draft.endpoint,
        driver: selectedAdapter.driver,
      } : undefined,
    })
  }, [busy, devicePath, dirty, draft.endpoint, onSaveStateChange, save, selectedAdapter])

  const bus = device.bus.toUpperCase()

  if (device.bus.toLowerCase() !== 'spi') {
    return (
      <Panel className="dv-tab-panel dv-config" icon={Cable} meta={`${bus} topology`} title={`${bus} configuration`}>
        {adapter && binding && (
          <dl className="kv-grid dv-config-readonly">
            <div><dt>Adapter</dt><dd className="mono">{adapter.id} · {adapter.driver}</dd></div>
            <div><dt>Endpoint</dt><dd className="mono">{formatEndpoint(adapter.bus_type, binding.endpoint)}</dd></div>
            <div><dt>Device node</dt><dd className="mono">{binding.device_path}</dd></div>
          </dl>
        )}
        <AsyncState
          detail={<>Bus-specific endpoint settings are not exposed by the current runtime. Manage bindings in <Link className="inline-link" to="/adapters">Adapters</Link>.</>}
          kind="empty"
          title="Configuration unavailable"
        />
      </Panel>
    )
  }

  if (spiAdapters.length === 0) {
    return (
      <Panel className="dv-tab-panel dv-config" icon={Cable} meta="SPI topology" title="SPI configuration">
        <AsyncState
          detail={<span>Create an SPI adapter before configuring this device. <Link className="inline-link" to="/adapters">Open Adapters</Link>.</span>}
          kind="empty"
          title="No adapters found"
        />
      </Panel>
    )
  }

  return (
    <Panel
      actions={dirty ? <span className="status-badge status-warning">Unsaved changes</span> : undefined}
      className="dv-tab-panel dv-config"
      icon={Cable}
      meta="SPI topology"
      title="SPI configuration"
    >
      {!adapter && (
        <div className="inline-alert info dv-config-note">
          <Info aria-hidden="true" size={14} />
          <span>This device is not attached. Select an adapter and chip select, then save. You can also <Link className="inline-link" to="/adapters">open Adapters</Link>.</span>
        </div>
      )}

      <fieldset className="dv-config-group">
        <legend>Host topology · Linux CUSE spidev adapter</legend>
        <div className="dv-config-fields">
          <label className="field"><span>Adapter</span><select onChange={(event) => setDraft({ ...draft, adapterId: event.target.value })} value={draft.adapterId}>
            {spiAdapters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.id})</option>)}
          </select></label>
          <label className="field"><span>Chip select</span><select onChange={(event) => setDraft({ ...draft, endpoint: Number(event.target.value) })} value={draft.endpoint}>
            {Array.from({ length: 8 }, (_, endpoint) => <option key={endpoint} value={endpoint}>CS{endpoint}</option>)}
          </select></label>
        </div>
      </fieldset>

      <fieldset className="dv-config-group">
        <legend>SPI interface defaults</legend>
        <div className="dv-config-fields">
          <label className="field"><span>Max clock speed</span><span className="dv-input-unit"><input min="1" onChange={(event) => setDraft({ ...draft, maxClockHz: Number(event.target.value) })} type="number" value={draft.maxClockHz} /><small>Hz</small></span></label>
          <label className="field"><span>CPOL</span><select onChange={(event) => setDraft({ ...draft, cpol: Number(event.target.value) as 0 | 1 })} value={draft.cpol}><option value="0">0 · Idle low</option><option value="1">1 · Idle high</option></select></label>
          <label className="field"><span>CPHA</span><select onChange={(event) => setDraft({ ...draft, cpha: Number(event.target.value) as 0 | 1 })} value={draft.cpha}><option value="0">0 · Leading edge</option><option value="1">1 · Trailing edge</option></select></label>
          <label className="field"><span>Bits per word</span><select onChange={(event) => setDraft({ ...draft, bitsPerWord: Number(event.target.value) as 8 | 16 | 32 })} value={draft.bitsPerWord}><option value="8">8 bit</option><option value="16">16 bit</option><option value="32">32 bit</option></select></label>
          <label className="field"><span>Bit order</span><select onChange={(event) => setDraft({ ...draft, lsbFirst: event.target.value === 'lsb' })} value={draft.lsbFirst ? 'lsb' : 'msb'}><option value="msb">MSB first</option><option value="lsb">LSB first</option></select></label>
          <div className="field"><span>SPI mode</span><output className="dv-config-mode">Mode {(draft.cpol << 1) | draft.cpha}</output></div>
        </div>
      </fieldset>

      <div className="dv-config-command">
        <span className="panel-section-title dv-flush-title">Character-device daemon</span>
        <code className="code-block">{adapterCommand}</code>
      </div>
      {error && <AsyncState detail={error} kind="error" title="Configuration save failed" />}
    </Panel>
  )
}
