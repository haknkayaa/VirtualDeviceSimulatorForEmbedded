import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useEventStore } from '../stores/eventStore'
import type { DomainEvent } from '../types/events'
import { eventSource, eventSummary, formatEventTime, getEventSeverity } from '../utils/events'
import { formatVirtualTime, humanize } from '../utils/format'

interface VirtualEventListProps {
  events: DomainEvent[]
  /** Hide the source column when every row belongs to one device. */
  showSource?: boolean
  'aria-label'?: string
}

const ROW_HEIGHT = 24

/**
 * Virtualised variant of the shared EventTail: identical row markup and
 * classes, but only the visible rows are mounted so long histories stay cheap.
 */
export function VirtualEventList({ events, showSource = true, 'aria-label': ariaLabel = 'Event stream' }: VirtualEventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const selectEvent = useEventStore((state) => state.selectEvent)
  // TanStack Virtual intentionally returns an imperative instance; React
  // Compiler must not memoize this hook result.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    <div aria-label={ariaLabel} className={`event-tail virtual-event-list${showSource ? '' : ' no-source'}`} ref={parentRef} role="log">
      <div className="virtual-event-list-spacer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const event = events[item.index]
          const severity = getEventSeverity(event)
          const source = eventSource(event)
          return (
            <button
              aria-label={`${severity} ${humanize(event.event_type)} on ${source}`}
              className={`list-row event-tail-row severity-${severity}`}
              data-index={item.index}
              key={event.event_id}
              onClick={() => selectEvent(event.event_id)}
              style={{ transform: `translateY(${item.start}px)` }}
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
        })}
      </div>
    </div>
  )
}
