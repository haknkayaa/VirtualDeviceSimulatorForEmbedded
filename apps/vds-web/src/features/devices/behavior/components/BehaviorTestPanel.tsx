import { Activity, Play, RotateCcw, X } from 'lucide-react'

import { useDeviceState, useRegisters, useResetDevice } from '../../../../api/queries'
import { StatusBadge } from '../../../../components/StatusBadge'
import { useEventStore } from '../../../../stores/eventStore'
import { formatHex } from '../../../../utils/format'

/** Runtime observation view for the behavior editor's bottom panel. Canvas highlighting is driven by useBehaviorRuntimeSync. */
export function BehaviorTestPanel({ deviceId, observing, onStart, onClose }: { deviceId: string; observing: boolean; onStart: () => void; onClose: () => void }) {
  const events = useEventStore((state) => state.events)
  const connection = useEventStore((state) => state.connectionStatus)
  const deviceState = useDeviceState(observing && deviceId ? deviceId : undefined)
  const registers = useRegisters(observing && deviceId ? deviceId : undefined)
  const reset = useResetDevice()
  if (!deviceId) {
    return <div className="flow-empty inline"><Activity aria-hidden="true" size={14} /><strong>No runtime device</strong><span>Select a runtime device to observe and reset it.</span></div>
  }
  if (!observing) {
    return (
      <div className="flow-empty inline">
        <Activity aria-hidden="true" size={14} />
        <strong>Runtime observation is off</strong>
        <span>Highlight the live state of <code>{deviceId}</code> on the canvas.</span>
        <button className="button button-sm" onClick={onStart} type="button"><Play size={12} /> Observe</button>
      </div>
    )
  }
  const timeline = events.filter((event) => event.device_id === deviceId && event.payload.kind === 'state_transition').slice(-12).reverse()
  return (
    <div className="behavior-runtime" aria-label="Runtime observation">
      <section className="behavior-runtime-state">
        <header className="flow-section-title">
          <span>Device</span>
          <button aria-label="Close test panel" className="icon-button sm" onClick={onClose} title="Stop observing" type="button"><X size={13} /></button>
        </header>
        <dl className="kv-grid">
          <div><dt>Device</dt><dd className="mono" title={deviceId}>{deviceId}</dd></div>
          <div><dt>Current state</dt><dd><code className="behavior-current-state">{deviceState.data?.state ?? 'unknown'}</code></dd></div>
          <div><dt>Event stream</dt><dd><StatusBadge status={connection} /></dd></div>
        </dl>
        <button className="button button-sm" disabled={reset.isPending} onClick={() => reset.mutate(deviceId)} type="button"><RotateCcw size={12} /> Reset device</button>
        <p className="flow-note">Command execution and manual time/event dispatch are intentionally unavailable: the Control API exposes no safe data-plane adapter.</p>
      </section>
      <section className="behavior-runtime-registers">
        <header className="flow-section-title"><span>Registers</span><span className="count">{registers.data?.length ?? 0}</span></header>
        <div className="behavior-runtime-scroll">
          <table className="data-table">
            <thead><tr><th>Register</th><th className="num">Value</th></tr></thead>
            <tbody>
              {(registers.data ?? []).map((register) => (
                <tr key={register.name} title={`${register.name} @ ${formatHex(register.address, 8)} · ${register.width_bits} bit`}>
                  <td className="mono">{register.name}</td>
                  <td className="num">{formatHex(register.value, register.width_bits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {registers.isError && <p className="flow-note">Register snapshot unavailable.</p>}
        </div>
      </section>
      <section className="behavior-runtime-timeline">
        <header className="flow-section-title"><span>Transition timeline</span><span className="count">{timeline.length}</span></header>
        <div className="behavior-runtime-scroll">
          {timeline.length === 0 ? <p className="flow-note">No transition events.</p> : (
            <table className="data-table">
              <thead><tr><th className="num">Event</th><th>Transition</th><th>Trigger</th></tr></thead>
              <tbody>
                {timeline.map((event) => event.payload.kind === 'state_transition' && (
                  <tr key={event.event_id}>
                    <td className="num dim">#{event.event_id}</td>
                    <td className="mono" title={`${event.payload.from_state} → ${event.payload.to_state}`}>{event.payload.from_state} → {event.payload.to_state}</td>
                    <td className="mono dim" title={event.payload.trigger}>{event.payload.trigger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
