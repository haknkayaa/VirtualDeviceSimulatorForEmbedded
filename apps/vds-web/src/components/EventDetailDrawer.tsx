import { X } from 'lucide-react'

import { useEventStore } from '../stores/eventStore'
import { formatVirtualTime, humanize } from '../utils/format'
import { StatusBadge } from './StatusBadge'

export function EventDetailDrawer() {
  const selectedEventId = useEventStore((state) => state.selectedEventId)
  const event = useEventStore((state) =>
    state.events.find((candidate) => candidate.event_id === selectedEventId),
  )
  const selectEvent = useEventStore((state) => state.selectEvent)

  if (!event) return null
  return (
    <aside className="event-drawer" aria-label="Event detail">
      <header>
        <div>
          <p className="eyebrow">Event #{event.event_id}</p>
          <h2>{humanize(event.event_type)}</h2>
        </div>
        <button className="icon-button" type="button" onClick={() => selectEvent(null)} aria-label="Close event detail">
          <X size={18} />
        </button>
      </header>
      <dl className="detail-grid">
        <div><dt>Status</dt><dd><StatusBadge status="success" /></dd></div>
        <div><dt>Virtual time</dt><dd>{formatVirtualTime(event.timestamp_virtual_ns)}</dd></div>
        <div><dt>Device</dt><dd>{event.device_id ?? '—'}</dd></div>
        <div><dt>Scenario run</dt><dd>{event.scenario_run_id ?? '—'}</dd></div>
      </dl>
      <div className="json-block">
        <span>Typed payload</span>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </div>
    </aside>
  )
}
