import { memo } from 'react'

import { useEventStore } from '../stores/eventStore'
import type { DomainEvent } from '../types/events'
import { eventSource, eventSummary, formatEventTime, getEventSeverity } from '../utils/events'
import { formatVirtualTime, humanize } from '../utils/format'

interface EventTailProps {
  events: DomainEvent[]
  /** Hide the source column when every row belongs to one device. */
  showSource?: boolean
}

const EventTailRow = memo(function EventTailRow({ event, showSource, onSelect }: {
  event: DomainEvent
  showSource: boolean
  onSelect: (eventId: number) => void
}) {
  const severity = getEventSeverity(event)
  const source = eventSource(event)
  return (
    <button
      aria-label={`${severity} ${humanize(event.event_type)} on ${source}`}
      className={`list-row event-tail-row severity-${severity}`}
      onClick={() => onSelect(event.event_id)}
      type="button"
    >
      <time title={`Virtual time ${formatVirtualTime(event.timestamp_virtual_ns)}`}>{formatEventTime(event)}</time>
      <span className="event-tail-severity">{severity}</span>
      {showSource && <strong className="event-tail-source truncate">{source}</strong>}
      <span className="event-tail-type truncate">{humanize(event.event_type)}</span>
      <span className="event-tail-detail truncate">{eventSummary(event)}</span>
      <span className="event-tail-id">#{event.event_id}</span>
    </button>
  )
})

/** Compact, newest-first domain event list. Selecting a row opens the event inspector. */
export function EventTail({ events, showSource = true }: EventTailProps) {
  const selectEvent = useEventStore((state) => state.selectEvent)
  return (
    <div aria-label="Live event stream" className={`event-tail${showSource ? '' : ' no-source'}`} role="log">
      {events.map((event) => (
        <EventTailRow event={event} key={event.event_id} onSelect={selectEvent} showSource={showSource} />
      ))}
    </div>
  )
}
