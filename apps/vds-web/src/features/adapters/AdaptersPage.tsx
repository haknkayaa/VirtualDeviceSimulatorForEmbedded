import { Cable, CheckCircle2, CircleAlert, Link2, LoaderCircle, LockKeyhole, Plus, Power, PowerOff, Unlink } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ApiError } from '../../api/client'
import {
  useAdapters,
  useAttachAdapterDevice,
  useCreateAdapter,
  useDetachAdapterDevice,
  useDevices,
  useLoadAdapter,
  useUnloadAdapter,
} from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import type { Adapter } from '../../types/api'
import { AdapterTree, type AdapterTreeSelection } from './AdapterTree'

interface AttachDraft {
  deviceId: string
  endpoint: string
}

export function AdaptersPage() {
  const adapters = useAdapters()
  const devices = useDevices()
  const createAdapter = useCreateAdapter()
  const loadAdapter = useLoadAdapter()
  const unloadAdapter = useUnloadAdapter()
  const attachDevice = useAttachAdapterDevice()
  const detachDevice = useDetachAdapterDevice()
  const [drafts, setDrafts] = useState<Record<string, AttachDraft>>({})
  const [authorizationAdapter, setAuthorizationAdapter] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selection, setSelection] = useState<AdapterTreeSelection>()

  const attachedDeviceIds = useMemo(
    () => new Set((adapters.data ?? []).flatMap((adapter) => adapter.bindings.map((binding) => binding.device_id))),
    [adapters.data],
  )
  const selectedAdapter = (adapters.data ?? []).find((adapter) => adapter.id === selection?.adapterId)
    ?? adapters.data?.[0]
  const effectiveSelection = selectedAdapter
    ? selection?.adapterId === selectedAdapter.id
      ? selection
      : { adapterId: selectedAdapter.id }
    : undefined
  const busy = loadAdapter.isPending || unloadAdapter.isPending || attachDevice.isPending || detachDevice.isPending

  const mutateLoad = (adapterId: string) => {
    loadAdapter.mutate(adapterId, {
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'adapter_authorization_required') {
          setAuthorizationAdapter(adapterId)
        }
      },
    })
  }

  return (
    <div className="page-stack adapters-page">
      <PageHeader
        action={(
          <button className="button button-primary" onClick={() => setShowCreate(true)} type="button">
            <Plus aria-hidden="true" size={14} /> New Adapter
          </button>
        )}
        description="Manage host bus adapters, operating-system drivers, and device endpoint topology."
        eyebrow="Host integration"
        title="Adapters"
      />

      <div className={`adapters-page-layout${showCreate ? ' creating-adapter' : ''}`}>
        <AdapterTree
          adapters={adapters.data ?? []}
          busy={busy}
          errorMessage={adapters.error?.message}
          isLoading={adapters.isPending}
          onLoad={mutateLoad}
          onSelect={setSelection}
          onUnload={(adapterId) => unloadAdapter.mutate(adapterId)}
          selection={effectiveSelection}
        />
        <div className="adapter-detail-page">
          {showCreate && (
            <CreateAdapterPanel
              isPending={createAdapter.isPending}
              onCancel={() => setShowCreate(false)}
              onCreate={(input) => createAdapter.mutate(input, {
                onSuccess: () => {
                  setShowCreate(false)
                  setSelection({ adapterId: input.id })
                },
              })}
            />
          )}
          {!showCreate && adapters.isPending && <GlassPanel><AsyncState kind="loading" title="Loading adapters" /></GlassPanel>}
          {!showCreate && adapters.isError && <GlassPanel><AsyncState detail={adapters.error.message} kind="error" title="Adapters unavailable" /></GlassPanel>}
          {!showCreate && !adapters.isPending && !selectedAdapter && (
            <GlassPanel><AsyncState kind="empty" title="Select an adapter" /></GlassPanel>
          )}
          {!showCreate && selectedAdapter && (() => {
          const adapter = selectedAdapter
          const draft = drafts[adapter.id] ?? { deviceId: '', endpoint: '0' }
          const availableDevices = (devices.data ?? []).filter(
            (device) => device.bus.toLowerCase() === adapter.bus_type && !attachedDeviceIds.has(device.id),
          )
          const selectedDeviceId = draft.deviceId || availableDevices[0]?.id || ''
          return (
            <AdapterCard
              adapter={adapter}
              attachDraft={{ ...draft, deviceId: selectedDeviceId }}
              availableDevices={availableDevices}
              busy={busy}
              key={adapter.id}
              onAttach={() => attachDevice.mutate({
                adapterId: adapter.id,
                device_id: selectedDeviceId,
                endpoint: Number(draft.endpoint),
              })}
              onDetach={(deviceId) => detachDevice.mutate({ adapterId: adapter.id, deviceId })}
              onDraft={(next) => setDrafts((current) => ({ ...current, [adapter.id]: next }))}
              onLoad={() => mutateLoad(adapter.id)}
              onUnload={() => unloadAdapter.mutate(adapter.id)}
            />
          )
        })()}
        </div>
      </div>

      {(loadAdapter.error || unloadAdapter.error || attachDevice.error || detachDevice.error || createAdapter.error) && (
        <GlassPanel>
          <AsyncState
            detail={(loadAdapter.error ?? unloadAdapter.error ?? attachDevice.error ?? detachDevice.error ?? createAdapter.error)?.message}
            kind="error"
            title="Adapter operation failed"
          />
        </GlassPanel>
      )}

      {authorizationAdapter && (
        <AuthorizationDialog
          adapterId={authorizationAdapter}
          onClose={() => setAuthorizationAdapter(null)}
          onRetry={() => {
            const adapterId = authorizationAdapter
            setAuthorizationAdapter(null)
            mutateLoad(adapterId)
          }}
        />
      )}
    </div>
  )
}

function AdapterCard({ adapter, availableDevices, attachDraft, busy, onAttach, onDetach, onDraft, onLoad, onUnload }: {
  adapter: Adapter
  availableDevices: Array<{ id: string }>
  attachDraft: AttachDraft
  busy: boolean
  onAttach: () => void
  onDetach: (deviceId: string) => void
  onDraft: (draft: AttachDraft) => void
  onLoad: () => void
  onUnload: () => void
}) {
  const loaded = adapter.state === 'loaded'
  const unloadable = loaded || adapter.state === 'error'
  const transitioning = adapter.state === 'loading' || adapter.state === 'unloading'
  return (
    <article className="glass-panel adapter-card">
      <header className="adapter-card-header">
        <span className="adapter-card-icon"><Cable aria-hidden="true" size={21} /></span>
        <div><p>{adapter.bus_type.toUpperCase()} · {adapter.driver.toUpperCase()}</p><h2>{adapter.name}</h2><span>{adapter.id}</span></div>
        <StatusBadge status={adapter.state} />
      </header>

      <dl className="adapter-metadata">
        <div><dt>Bus</dt><dd>{adapter.bus_type === 'gpio' ? `${adapter.line_count ?? 0} GPIO lines` : `${adapter.bus_type.toUpperCase()}${adapter.bus_number}`}</dd></div>
        <div><dt>Driver</dt><dd>{adapter.readiness.replaceAll('_', ' ')}</dd></div>
        <div><dt>Devices</dt><dd>{adapter.bindings.length}</dd></div>
        <div><dt>Daemon</dt><dd>{adapter.daemon_pids.length ? adapter.daemon_pids.map((pid) => `#${pid}`).join(', ') : '—'}</dd></div>
      </dl>

      {adapter.readiness !== 'ready' && (
        <div className={`adapter-readiness adapter-readiness-${adapter.readiness}`}>
          <CircleAlert aria-hidden="true" size={16} />
          <span>{adapter.readiness === 'authorization_required'
            ? `${adapter.driver} needs operating-system authorization.`
            : `${adapter.driver} is unavailable.`}</span>
        </div>
      )}

      {adapter.bus_type === 'gpio' ? (
        <div className="adapter-device-management">
          <section className="adapter-bindings adapter-device-pane">
            <header><strong>Kernel GPIO controller</strong><span>{adapter.line_count ?? 0} lines</span></header>
            <div className="adapter-binding-row">
              <span className="adapter-binding-icon"><Link2 aria-hidden="true" size={15} /></span>
              <div>
                <strong>{adapter.device_path ? 'GPIO chip loaded' : 'Waiting for kernel allocation'}</strong>
                <code>{adapter.device_path ?? '/dev/gpiochipX'}</code>
              </div>
              <span>GPIO</span>
            </div>
          </section>
          <section className="adapter-attach-pane">
            <header><strong>GPIO runtime</strong><span>Bind one declarative GPIO bank before loading.</span></header>
            {adapter.bindings.length > 0 ? (
              <div className="adapter-binding-row">
                <span className="adapter-binding-icon"><Link2 aria-hidden="true" size={15} /></span>
                <div><strong>{adapter.bindings[0].device_id}</strong><code>{adapter.bindings[0].device_path}</code></div>
                <button aria-label={`Detach ${adapter.bindings[0].device_id}`} disabled={busy} onClick={() => onDetach(adapter.bindings[0].device_id)} type="button">
                  <Unlink aria-hidden="true" size={14} />
                </button>
              </div>
            ) : (
              <div className="adapter-attach-form">
                <label><span>Device</span><select disabled={busy || availableDevices.length === 0} onChange={(event) => onDraft({ ...attachDraft, deviceId: event.target.value })} value={attachDraft.deviceId}>
                  {availableDevices.length === 0 && <option value="">No GPIO devices</option>}
                  {availableDevices.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
                </select></label>
                <button className="button button-secondary" disabled={busy || !attachDraft.deviceId} onClick={onAttach} type="button">
                  <Link2 aria-hidden="true" size={14} /> Attach
                </button>
              </div>
            )}
          </section>
        </div>
      ) : <div className="adapter-device-management">
        <section className="adapter-bindings adapter-device-pane">
          <header><strong>Device endpoints</strong><span>{adapter.bindings.length} attached</span></header>
          {adapter.bindings.length === 0 && <p className="adapter-empty">No devices attached to this adapter.</p>}
          {adapter.bindings.map((binding) => (
            <div className="adapter-binding-row" key={binding.device_id}>
              <span className="adapter-binding-icon"><Link2 aria-hidden="true" size={15} /></span>
              <div><strong>{binding.device_id}</strong><code>{binding.device_path}</code></div>
              <span>{adapter.bus_type === 'i2c' ? `0x${binding.endpoint.toString(16).padStart(2, '0')}` : `CS${binding.endpoint}`}</span>
              <button aria-label={`Detach ${binding.device_id}`} disabled={busy} onClick={() => onDetach(binding.device_id)} type="button">
                <Unlink aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </section>

        <section className="adapter-attach-pane">
          <header><strong>Attach device</strong><span>Assign an available device to this adapter.</span></header>
          <div className="adapter-attach-form">
            <label><span>Device</span><select disabled={busy || availableDevices.length === 0} onChange={(event) => onDraft({ ...attachDraft, deviceId: event.target.value })} value={attachDraft.deviceId}>
              {availableDevices.length === 0 && <option value="">No unassigned devices</option>}
              {availableDevices.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
            </select></label>
            <label><span>{adapter.bus_type === 'i2c' ? 'Slave address' : 'Chip select'}</span><input disabled={busy} min="0" onChange={(event) => onDraft({ ...attachDraft, endpoint: event.target.value })} value={attachDraft.endpoint} /></label>
            <button className="button button-secondary" disabled={busy || !attachDraft.deviceId || !attachDraft.endpoint} onClick={onAttach} type="button">
              <Link2 aria-hidden="true" size={14} /> Attach
            </button>
          </div>
        </section>
      </div>}

      <footer>
        {unloadable
          ? <button className="button button-danger adapter-unload-button" disabled={busy || transitioning} onClick={onUnload} type="button"><PowerOff aria-hidden="true" size={15} /> {loaded ? 'Unload' : 'Reset Adapter'}</button>
          : <button className="button button-primary" disabled={busy || transitioning || adapter.bindings.length === 0 || adapter.readiness === 'unavailable'} onClick={onLoad} type="button">
            {transitioning ? <LoaderCircle className="spin" size={15} /> : <Power size={15} />} Load Adapter
          </button>}
      </footer>
    </article>
  )
}

function CreateAdapterPanel({ isPending, onCancel, onCreate }: {
  isPending: boolean
  onCancel: () => void
  onCreate: (input: { id: string; name: string; bus_type: string; bus_number?: number; line_count?: number; max_frequency_hz?: number }) => void
}) {
  const [busType, setBusType] = useState<'spi' | 'i2c' | 'gpio'>('spi')
  const [id, setId] = useState('spi1')
  const [name, setName] = useState('SPI 1')
  const [busNumber, setBusNumber] = useState('1')
  const [lineCount, setLineCount] = useState('32')
  const [maxFrequency, setMaxFrequency] = useState('10000000')
  const changeBusType = (next: 'spi' | 'i2c' | 'gpio') => {
    setBusType(next)
    setId(next === 'gpio' ? 'gpio0' : next === 'i2c' ? 'i2c0' : 'spi1')
    setName(next === 'gpio' ? 'GPIO 0' : next === 'i2c' ? 'I2C 0' : 'SPI 1')
    setMaxFrequency(next === 'i2c' ? '400000' : '10000000')
  }
  const adapterTypes = [
    { id: 'spi' as const, label: 'SPI Adapter', driver: 'CUSE', path: '/dev/spidevX.Y' },
    { id: 'i2c' as const, label: 'I2C Adapter', driver: 'CUSE', path: '/dev/i2c-N' },
    { id: 'gpio' as const, label: 'GPIO Adapter', driver: 'gpio-sim', path: '/dev/gpiochipX' },
  ]
  return (
    <GlassPanel className="adapter-create-panel" eyebrow="Topology" title="New Adapter">
      <div className="adapter-create-layout">
        <div className="adapter-create-form">
          <label>
            <span>Bus type</span>
            <select onChange={(event) => changeBusType(event.target.value as 'spi' | 'i2c' | 'gpio')} value={busType}>
              <option value="spi">SPI</option>
              <option value="i2c">I2C</option>
              <option value="gpio">GPIO</option>
            </select>
          </label>
          <label><span>Name</span><input onChange={(event) => setName(event.target.value)} value={name} /></label>
          <label><span>Adapter ID</span><input onChange={(event) => setId(event.target.value)} value={id} /></label>

          <section className="adapter-bus-configuration">
            <header>
              <span>{busType.toUpperCase()} configuration</span>
              <small>{busType === 'spi' ? '/dev/spidevX.Y' : busType === 'i2c' ? '/dev/i2c-N' : '/dev/gpiochipX'}</small>
            </header>
            {busType !== 'gpio'
              ? <>
                  <label>
                    <span>Bus number</span>
                    <input min="0" onChange={(event) => setBusNumber(event.target.value)} type="number" value={busNumber} />
                  </label>
                  <label>
                    <span>Maximum frequency (Hz)</span>
                    <input min="1" onChange={(event) => setMaxFrequency(event.target.value)} type="number" value={maxFrequency} />
                  </label>
                </>
              : <label>
                  <span>Line count</span>
                  <select onChange={(event) => setLineCount(event.target.value)} value={lineCount}>
                    <option value="8">8 lines</option>
                    <option value="16">16 lines</option>
                    <option value="32">32 lines</option>
                  </select>
                  <small>The kernel assigns the final gpiochip path when the adapter loads.</small>
                </label>}
          </section>
        </div>

        <aside className="available-adapters">
          <header><span>Available adapters</span><small>Linux ABI host integrations</small></header>
          <div>
            {adapterTypes.map((adapter) => (
              <button
                aria-pressed={busType === adapter.id}
                className={busType === adapter.id ? 'selected' : ''}
                key={adapter.id}
                onClick={() => changeBusType(adapter.id)}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={17} />
                <span><strong>{adapter.label}</strong><small>{adapter.driver} · {adapter.path}</small></span>
              </button>
            ))}
          </div>
          <p>Standard Linux device interfaces with server-owned runtime topology.</p>
        </aside>
      </div>
      <footer><button className="button button-secondary" onClick={onCancel} type="button">Cancel</button><button className="button button-primary" disabled={isPending || !id || !name || (busType !== 'gpio' && !maxFrequency)} onClick={() => onCreate(busType !== 'gpio'
        ? { id, name, bus_type: busType, bus_number: Number(busNumber), max_frequency_hz: Number(maxFrequency) }
        : { id, name, bus_type: busType, line_count: Number(lineCount) })} type="button">Create Adapter</button></footer>
    </GlassPanel>
  )
}

function AuthorizationDialog({ adapterId, onClose, onRetry }: { adapterId: string; onClose: () => void; onRetry: () => void }) {
  return (
    <div aria-labelledby="adapter-authorization-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <section className="glass-panel adapter-authorization-dialog">
        <LockKeyhole aria-hidden="true" size={25} />
        <div><p>Operating-system authorization</p><h2 id="adapter-authorization-title">Kernel adapter access required</h2></div>
        <p>VDS4E never accepts or stores your sudo password. Authorize the required kernel adapter through the operating system, then retry loading {adapterId}.</p>
        <code>GPIO: sudo modprobe gpio-sim · SPI/I2C: sudo modprobe cuse</code>
        <footer><button className="button button-secondary" onClick={onClose} type="button">Close</button><button className="button button-primary" onClick={onRetry} type="button">Retry</button></footer>
      </section>
    </div>
  )
}
