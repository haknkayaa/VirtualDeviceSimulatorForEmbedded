import { Zap } from 'lucide-react'

import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import type { Fault } from '../../types/api'
import { humanize } from '../../utils/format'

interface DeviceFaultsProps {
  faults: Fault[]
  isLoading: boolean
  errorMessage?: string
  toggleErrorMessage?: string
  isToggling: boolean
  onToggle: (fault: Fault) => void
  selectedId?: string
  onSelect: (id: string) => void
}

/** Fault profiles for one device: a compact table with arm/disarm toggles. */
export function DeviceFaults({ faults, isLoading, errorMessage, toggleErrorMessage, isToggling, onToggle, selectedId, onSelect }: DeviceFaultsProps) {
  const armed = faults.filter((fault) => fault.enabled).length
  return (
    <Panel
      className="dv-tab-panel dv-faults"
      flush
      icon={Zap}
      meta={`${faults.length} defined · ${armed} armed`}
      title="Fault profiles"
    >
      {isLoading && <AsyncState kind="loading" title="Loading faults" />}
      {errorMessage && <AsyncState detail={errorMessage} kind="error" title="Faults unavailable" />}
      {!isLoading && !errorMessage && faults.length === 0 && <AsyncState kind="empty" title="No faults defined for this device" />}
      {toggleErrorMessage && <div className="inline-alert error" role="alert"><strong>Fault update failed</strong>&nbsp;{toggleErrorMessage}</div>}
      {faults.length > 0 && (
        <div className="dv-table-scroll">
          <table className="data-table">
            <thead>
              <tr><th className="dv-col-toggle">Armed</th><th>Fault</th><th>Trigger</th><th>Action</th><th className="num">Priority</th><th>Persistent</th></tr>
            </thead>
            <tbody>
              {faults.map((fault) => (
                <tr
                  aria-selected={fault.id === selectedId}
                  className={`clickable${fault.id === selectedId ? ' selected' : ''}${fault.enabled ? ' dv-fault-armed' : ''}`}
                  key={fault.id}
                  onClick={() => onSelect(fault.id)}
                >
                  <td className="dv-col-toggle">
                    <button
                      aria-label={`${fault.enabled ? 'Disable' : 'Enable'} ${fault.id}`}
                      aria-pressed={fault.enabled}
                      className="toggle"
                      disabled={isToggling}
                      onClick={(event) => { event.stopPropagation(); onToggle(fault) }}
                      type="button"
                    ><span /></button>
                  </td>
                  <td className="mono"><strong>{fault.id}</strong></td>
                  <td className="dim">{humanize(fault.trigger)}</td>
                  <td>{humanize(fault.action)}</td>
                  <td className="num">{fault.priority}</td>
                  <td className="dim">{fault.persistent ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

export function DeviceFaultInspector({ fault }: { fault?: Fault }) {
  return (
    <Panel className="dv-fault-inspector" icon={Zap} title="Fault Inspector">
      {!fault
        ? <AsyncState detail="Select a fault profile to inspect it." kind="empty" title="No fault selected" />
        : (
          <>
            <h3 className="dv-inspector-heading mono">{fault.id}</h3>
            <dl className="kv-grid">
              <div><dt>State</dt><dd><span className={`status-badge ${fault.enabled ? 'status-warning' : ''}`}>{fault.enabled ? 'armed' : 'disarmed'}</span></dd></div>
              <div><dt>Trigger</dt><dd className="mono">{fault.trigger}</dd></div>
              <div><dt>Action</dt><dd className="mono">{fault.action}</dd></div>
              <div><dt>Priority</dt><dd className="mono">{fault.priority}</dd></div>
              <div><dt>Persistent</dt><dd>{fault.persistent ? 'Trigger count survives device reset' : 'Trigger count clears on device reset'}</dd></div>
              <div><dt>Device</dt><dd className="mono">{fault.device_id}</dd></div>
            </dl>
            <p className="dv-inspector-note">Armed faults are evaluated in priority order (highest first) on each matching operation; a terminal action stops evaluation of lower-priority faults.</p>
          </>
        )}
    </Panel>
  )
}
