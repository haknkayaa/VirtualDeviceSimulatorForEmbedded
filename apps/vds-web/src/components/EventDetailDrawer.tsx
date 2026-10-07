import { X } from 'lucide-react'
import { useEffect } from 'react'

import { useEventStore } from '../stores/eventStore'
import { eventSource, eventSummary, formatWallTime, getEventSeverity } from '../utils/events'
import { formatVirtualTime, humanize } from '../utils/format'

const severityTone = { info: 'status-info', warn: 'status-warning', error: 'status-negative' } as const

/** Docked event inspector opened from any event row in the workspace. */
export function EventDetailDrawer() {
  const selectedEventId = useEventStore((state) => state.selectedEventId)
  const event = useEventStore((state) =>
    state.selectedEventId === null ? undefined : state.events.find((candidate) => candidate.event_id === state.selectedEventId),
  )
  const selectEvent = useEventStore((state) => state.selectEvent)

  useEffect(() => {
    if (selectedEventId === null) return
    const onKeyDown = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') selectEvent(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectEvent, selectedEventId])

  if (!event) return null
  const severity = getEventSeverity(event)
  return (
    <aside aria-label="Event detail" className="event-drawer">
      <header>
        <span className="event-drawer-id">#{event.event_id}</span>
        <h2>{humanize(event.event_type)}</h2>
        <button aria-label="Close event detail" className="icon-button" onClick={() => selectEvent(null)} type="button">
          <X size={15} />
        </button>
      </header>
      <div className="event-drawer-body">
        <p className="event-drawer-summary">{eventSummary(event)}</p>
        <dl className="kv-grid">
          <div><dt>Severity</dt><dd><span className={`status-badge ${severityTone[severity]}`}>{severity}</span></dd></div>
          <div><dt>Source</dt><dd className="mono">{eventSource(event)}</dd></div>
          <div><dt>Device</dt><dd className="mono">{event.device_id ?? '—'}</dd></div>
          <div><dt>Scenario run</dt><dd className="mono">{event.scenario_run_id ?? '—'}</dd></div>
          <div><dt>Virtual time</dt><dd className="mono">{formatVirtualTime(event.timestamp_virtual_ns)}</dd></div>
          <div><dt>Wall time</dt><dd className="mono">{event.timestamp_wall_ns > 0 ? formatWallTime(event.timestamp_wall_ns) : '—'}</dd></div>
        </dl>
        <div className="event-drawer-payload">
          <span className="panel-section-title">Payload · {event.payload.kind}</span>
          <pre className="code-block">{JSON.stringify(event.payload, null, 2)}</pre>
        </div>
      </div>
    </aside>
  )
}
