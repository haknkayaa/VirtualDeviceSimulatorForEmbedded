import { CircleAlert, Link2, LoaderCircle, Power, PowerOff, RotateCcw, Unlink } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { BusTag } from '../../components/BusTag'
import { StatusBadge } from '../../components/StatusBadge'
import type { Adapter, Device } from '../../types/api'
import {
  adapterNodePath,
  adapterStateTone,
  bindingEndpointLabel,
  bindingNodePath,
  busLabel,
  expectedNodePath,
  formatFrequency,
  kernelModuleFor,
  parseEndpoint,
} from './adapterModel'
import { formatEndpoint } from '../../utils/endpoints'

export interface AttachDraft {
  deviceId: string
  endpoint: string
}

interface AdapterInspectorProps {
  adapter: Adapter
  availableDevices: Device[]
  attachDraft: AttachDraft
  busy: boolean
  errorMessage?: string
  focusedDeviceId?: string
  onAttach: (endpoint: number) => void
  onDetach: (deviceId: string) => void
  onDraft: (draft: AttachDraft) => void
  onLoad: () => void
  onUnload: () => void
}

/** Right-hand inspector for one host adapter: identity, runtime state, bindings and lifecycle. */
export function AdapterInspector(props: AdapterInspectorProps) {
  const { adapter, busy, errorMessage, onLoad, onUnload } = props
  const loaded = adapter.state === 'loaded'
  const unloadable = loaded || adapter.state === 'error'
  const transitioning = adapter.state === 'loading' || adapter.state === 'unloading'
  const loadBlockedReason = adapter.bindings.length === 0
    ? 'Attach a device before loading the adapter.'
    : adapter.readiness === 'unavailable'
      ? `${adapter.driver} is unavailable on this host.`
      : undefined
  const exposed = loaded ? adapter.bindings.length : 0

  return (
    <section aria-label={`${adapter.name} adapter`} className="panel adp-inspector">
      <header className="adp-inspector-head">
        <i aria-hidden="true" className={`status-dot ${adapterStateTone(adapter.state)}`} />
        <h2>{adapter.name}</h2>
        <BusTag bus={adapter.bus_type} />
        <code className="adp-inspector-id">{adapter.id}</code>
        <StatusBadge status={adapter.state} />
        <div className="adp-inspector-actions">
          {unloadable ? (
            <button className="button button-danger" disabled={busy || transitioning} onClick={onUnload} type="button">
              {loaded ? <PowerOff aria-hidden="true" size={13} /> : <RotateCcw aria-hidden="true" size={13} />}
              {loaded ? 'Unload' : 'Reset Adapter'}
            </button>
          ) : (
            <button
              className="button button-primary"
              disabled={busy || transitioning || Boolean(loadBlockedReason)}
              onClick={onLoad}
              title={loadBlockedReason}
              type="button"
            >
              {transitioning ? <LoaderCircle aria-hidden="true" className="spin" size={13} /> : <Power aria-hidden="true" size={13} />} Load Adapter
            </button>
          )}
        </div>
      </header>

      <div className="adp-inspector-body">
        {errorMessage && (
          <div className="inline-alert error" role="alert">
            <CircleAlert aria-hidden="true" size={14} />
            <span><strong>Adapter operation failed.</strong> {errorMessage}</span>
          </div>
        )}
        <ReadinessNotice adapter={adapter} />
        {adapter.error && (
          <div className="inline-alert error">
            <CircleAlert aria-hidden="true" size={14} />
            <span><strong>Adapter error.</strong> <code>{adapter.error}</code></span>
          </div>
        )}

        <div className="adp-facts">
          <section className="adp-section">
            <h3 className="panel-section-title">Identity</h3>
            <dl className="kv-grid adp-kv">
              <div><dt>Name</dt><dd>{adapter.name}</dd></div>
              <div><dt>Adapter ID</dt><dd className="mono">{adapter.id}</dd></div>
              <div><dt>Bus</dt><dd className="mono">{adapter.bus_type === 'gpio' ? 'GPIO' : `${adapter.bus_type.toUpperCase()}${adapter.bus_number}`}</dd></div>
              <div><dt>Driver</dt><dd className="mono">{adapter.driver}</dd></div>
              {adapter.bus_type !== 'gpio' && <div><dt>Bus number</dt><dd className="mono">{adapter.bus_number}</dd></div>}
              {(adapter.bus_type === 'spi' || adapter.bus_type === 'i2c') && (
                <div><dt>Max frequency</dt><dd className="mono" title={adapter.max_frequency_hz ? `${adapter.max_frequency_hz} Hz` : undefined}>{formatFrequency(adapter.max_frequency_hz)}</dd></div>
              )}
              {adapter.bus_type === 'gpio' && <div><dt>Line count</dt><dd className="mono">{adapter.line_count ?? '—'}</dd></div>}
              <div><dt>Device path</dt><dd className="mono">{adapterNodePath(adapter)}</dd></div>
            </dl>
          </section>
          <section className="adp-section">
            <h3 className="panel-section-title">Runtime</h3>
            <dl className="kv-grid adp-kv">
              <div><dt>Readiness</dt><dd><StatusBadge status={adapter.readiness} /></dd></div>
              <div>
                <dt>Daemon PIDs</dt>
                <dd className="adp-pids">
                  {adapter.daemon_pids.length
                    ? adapter.daemon_pids.map((pid) => <code className="chip mono" key={pid} title="Adapter daemon process id">#{pid}</code>)
                    : <span className="faint">—</span>}
                </dd>
              </div>
              <div><dt>Exposed nodes</dt><dd className="mono">{exposed} / {adapter.bindings.length}{!loaded && adapter.bindings.length > 0 ? <span className="faint"> · load to expose</span> : null}</dd></div>
            </dl>
          </section>
        </div>

        <BindingsSection {...props} />
        <AttachSection {...props} />
      </div>
    </section>
  )
}

function ReadinessNotice({ adapter }: { adapter: Adapter }) {
  if (adapter.readiness === 'ready') return null
  const module = kernelModuleFor(adapter)
  if (adapter.readiness === 'authorization_required') {
    return (
      <div className="inline-alert warn">
        <CircleAlert aria-hidden="true" size={14} />
        <div className="adp-alert-text">
          <span><code>{adapter.driver}</code> needs operating-system authorization before this adapter can load.</span>
          {module && <span>Authorize it in a terminal, then load again: <code className="adp-cmd">sudo modprobe {module}</code></span>}
        </div>
      </div>
    )
  }
  return (
    <div className="inline-alert error">
      <CircleAlert aria-hidden="true" size={14} />
      <div className="adp-alert-text">
        <span><code>{adapter.driver}</code> is unavailable on this host, so the adapter cannot load.</span>
        {module
          ? <span>Load the kernel module, then retry: <code className="adp-cmd">sudo modprobe {module}</code></span>
          : <span>Check that the host provides the required driver.</span>}
      </div>
    </div>
  )
}

function BindingsSection({ adapter, busy, focusedDeviceId, onDetach }: AdapterInspectorProps) {
  const loaded = adapter.state === 'loaded'
  const detachLocked = loaded && adapter.bus_type !== 'spi'
  const showLines = adapter.bus_type === 'gpio'
  return (
    <section className="adp-section">
      <h3 className="panel-section-title">Bindings <span className="count">{adapter.bindings.length}</span></h3>
      {adapter.bindings.length === 0 ? (
        <p className="adp-empty">No virtual device attached. Linux applications see nothing on <code>{adapterNodePath(adapter)}</code> until one is attached and the adapter is loaded.</p>
      ) : (
        <div className="adp-table-wrap">
          <table className="data-table adp-bindings">
            <thead>
              <tr>
                <th>Device</th>
                <th>{adapter.bus_type === 'i2c' ? 'Addr' : adapter.bus_type === 'spi' ? 'CS' : 'EP'}</th>
                <th>Node</th>
                {showLines && <th>Line names</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {adapter.bindings.map((binding) => (
                <tr className={focusedDeviceId === binding.device_id ? 'selected' : ''} key={binding.device_id}>
                  <td><Link className="adp-device-link" to={`/devices/${encodeURIComponent(binding.device_id)}`}>{binding.device_id}</Link></td>
                  <td className="mono">{bindingEndpointLabel(adapter, binding)}</td>
                  <td><code className={loaded ? 'adp-node' : 'adp-node adp-node-down'}>{bindingNodePath(adapter, binding)}</code></td>
                  {showLines && (
                    <td className="mono dim adp-lines" title={binding.line_names?.join(', ')}>
                      {binding.line_names?.length
                        ? `${binding.line_names[0]} … ${binding.line_names.at(-1)}`
                        : '—'}
                    </td>
                  )}
                  <td className="adp-row-actions">
                    <button
                      aria-label={`Detach ${binding.device_id}`}
                      className="icon-button sm"
                      disabled={busy || detachLocked}
                      onClick={() => onDetach(binding.device_id)}
                      title={detachLocked ? 'Unload the adapter before disconnecting this device.' : 'Detach device'}
                      type="button"
                    >
                      <Unlink aria-hidden="true" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Guidance({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="adp-guidance">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  )
}

function AttachSection({ adapter, availableDevices, attachDraft, busy, onAttach, onDraft }: AdapterInspectorProps) {
  const loaded = adapter.state === 'loaded'
  const busName = busLabel(adapter.bus_type)
  const isGpio = adapter.bus_type === 'gpio'
  const isUart = adapter.bus_type === 'uart'
  const topologyLocked = loaded && adapter.bus_type !== 'spi'
  const portFull = (isUart || isGpio) && adapter.bindings.length > 0
  const endpoint = isGpio || isUart ? 0 : parseEndpoint(adapter.bus_type, attachDraft.endpoint)
  const conflict = endpoint === null || isGpio || isUart
    ? undefined
    : adapter.bindings.find((binding) => binding.endpoint === endpoint)
  const endpointError = !isGpio && !isUart && attachDraft.endpoint.trim() !== '' && endpoint === null
    ? adapter.bus_type === 'i2c' ? 'Use a 7-bit address, e.g. 0x50.' : 'Use a non-negative chip-select index.'
    : conflict
      ? `${formatEndpoint(adapter.bus_type, conflict.endpoint)} is used by ${conflict.device_id}.`
      : undefined
  const canAttach = !busy && Boolean(attachDraft.deviceId) && endpoint !== null && !conflict

  let body: ReactNode
  if (portFull && isUart) {
    body = <Guidance title="This UART port is fully assigned.">Create another UART adapter when you need a second independent serial device.</Guidance>
  } else if (portFull) {
    body = <Guidance title="This GPIO controller is assigned.">One GPIO bank maps onto the controller lines. Detach {adapter.bindings[0].device_id}{loaded ? ' after unloading' : ''} to connect a different bank.</Guidance>
  } else if (topologyLocked) {
    body = <Guidance title="Topology is locked while loaded.">Unload the {busName} adapter to connect or disconnect devices. Existing Linux clients will temporarily lose this endpoint.</Guidance>
  } else if (availableDevices.length === 0) {
    body = <Guidance title="No compatible unassigned devices.">Add a {busName} device on the <Link className="inline-link" to="/devices">Devices</Link> page, or detach one from another adapter.</Guidance>
  } else {
    body = (
      <form
        className="adp-attach-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (canAttach && endpoint !== null) onAttach(endpoint)
        }}
      >
        <label className="field">
          <span>{isGpio ? 'Device' : 'Virtual device'}</span>
          <select disabled={busy} onChange={(event) => onDraft({ ...attachDraft, deviceId: event.target.value })} value={attachDraft.deviceId}>
            {availableDevices.map((device) => <option key={device.id} value={device.id}>{device.id}</option>)}
          </select>
        </label>
        {!isGpio && !isUart && (
          <label className="field adp-endpoint-field">
            <span>{adapter.bus_type === 'i2c' ? 'Slave address' : 'Chip select'}</span>
            <input
              aria-invalid={Boolean(endpointError)}
              className="mono"
              disabled={busy}
              inputMode={adapter.bus_type === 'i2c' ? 'text' : 'numeric'}
              onChange={(event) => onDraft({ ...attachDraft, endpoint: event.target.value })}
              placeholder={adapter.bus_type === 'i2c' ? '0x50' : '0'}
              value={attachDraft.endpoint}
            />
          </label>
        )}
        <div className="adp-attach-preview" aria-label="Adapter connection preview">
          <span className="field-label">Linux node</span>
          <code>{expectedNodePath(adapter, endpoint)}</code>
        </div>
        <button className="button" disabled={!canAttach} type="submit">
          <Link2 aria-hidden="true" size={13} /> {isGpio ? 'Attach' : 'Connect device'}
        </button>
        {endpointError && <span className="adp-field-error" role="status">{endpointError}</span>}
      </form>
    )
  }

  return (
    <section className="adp-section">
      <h3 className="panel-section-title">Attach device</h3>
      {body}
    </section>
  )
}
