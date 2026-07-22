import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { useEventStore } from '../stores/eventStore'
import type { DomainEvent } from '../types/events'
import { formatVirtualTime, humanize } from '../utils/format'

interface VirtualEventListProps {
  events: DomainEvent[]
  compact?: boolean
}

export function VirtualEventList({ events, compact = false }: VirtualEventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const selectEvent = useEventStore((state) => state.selectEvent)
  // TanStack Virtual intentionally returns an imperative instance; React
  // Compiler must not memoize this hook result.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (compact ? 54 : 66),
    overscan: 8,
  })

  return (
    <div className={`event-list ${compact ? 'event-list-compact' : ''}`} ref={parentRef}>
      <div className="event-list-spacer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const event = events[item.index]
          return (
            <button
              className="event-row"
              data-index={item.index}
              key={event.event_id}
              onClick={() => selectEvent(event.event_id)}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
              type="button"
            >
              <span className="event-sequence">#{event.event_id}</span>
              <span className={`event-dot event-${event.event_type}`} />
              <span className="event-primary">
                <strong>{humanize(event.event_type)}</strong>
                <small>{event.device_id ?? event.scenario_run_id ?? 'system'}</small>
              </span>
              <span className="event-time">{formatVirtualTime(event.timestamp_virtual_ns)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
