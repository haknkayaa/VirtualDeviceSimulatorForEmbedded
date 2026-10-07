import { ArrowDownToLine, Download, FilterX, Search } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { useEventStore } from '../../stores/eventStore'
import { eventTypes, type DomainEvent } from '../../types/events'
import { eventSource, eventSummary, formatWallTime, getEventSeverity, type EventSeverity } from '../../utils/events'
import { formatVirtualTime, humanize } from '../../utils/format'
import './logs.css'

const ROW_HEIGHT = 24
const isTestMode = import.meta.env.MODE === 'test'

/** Lower-cased search haystack per event, computed once per event object. */
const searchCache = new WeakMap<DomainEvent, string>()
function searchText(event: DomainEvent) {
  let text = searchCache.get(event)
  if (text === undefined) {
    text = `${JSON.stringify(event)} ${eventSummary(event)}`.toLowerCase()
    searchCache.set(event, text)
  }
  return text
}

const payloadCache = new WeakMap<DomainEvent, string>()
function payloadText(event: DomainEvent) {
  let text = payloadCache.get(event)
  if (text === undefined) {
    // `kind` repeats the event type column; show only the payload fields.
    const fields: Record<string, unknown> = { ...event.payload }
    delete fields.kind
    text = JSON.stringify(fields)
    payloadCache.set(event, text)
  }
  return text
}

const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

const LogRow = memo(function LogRow({ event, index, selected, start, onSelect }: {
  event: DomainEvent
  index: number
  selected: boolean
  start: number
  onSelect: (eventId: number) => void
}) {
  const severity = getEventSeverity(event)
  const wall = event.timestamp_wall_ns > 0
  return (
    <button
      aria-label={`#${event.event_id} ${severity} ${humanize(event.event_type)} on ${eventSource(event)}`}
      aria-current={selected || undefined}
      className={`logs-row severity-${severity}${selected ? ' selected' : ''}`}
      data-index={index}
      onClick={() => onSelect(event.event_id)}
      style={{ transform: `translateY(${start}px)` }}
      tabIndex={-1}
      type="button"
    >
      <span className="logs-id">{event.event_id}</span>
      <time title={wall ? fullDateFormatter.format(new Date(event.timestamp_wall_ns / 1_000_000)) : undefined}>
        {wall ? formatWallTime(event.timestamp_wall_ns) : '—'}
      </time>
      <span className="logs-vtime">{formatVirtualTime(event.timestamp_virtual_ns)}</span>
      <span className="logs-sev">{severity}</span>
      <strong className="truncate">{eventSource(event)}</strong>
      <span className="logs-type truncate">{humanize(event.event_type)}</span>
      <span className="logs-summary truncate">{eventSummary(event)}</span>
      <code className="logs-payload truncate">{payloadText(event)}</code>
    </button>
  )
})

/**
 * Persistent domain-event history (restored from SQLite, then live over
 * WebSocket). Follows the tail only while the view is scrolled to the end.
 */
export function LogsPage() {
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const selectedEventId = useEventStore((state) => state.selectedEventId)
  const selectEvent = useEventStore((state) => state.selectEvent)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [device, setDevice] = useState('all')
  const [severity, setSeverity] = useState<'all' | EventSeverity>('all')
  const [follow, setFollow] = useState(true)
  const [pausedAtId, setPausedAtId] = useState(0)
  const logBodyRef = useRef<HTMLDivElement>(null)

  const devices = useMemo(
    () => [...new Set(events.flatMap((event) => event.device_id ? [event.device_id] : []))].sort(),
    [events],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return events.filter((event) =>
      (type === 'all' || event.event_type === type) &&
      (device === 'all' || (device === 'system' ? !event.device_id : event.device_id === device)) &&
      (severity === 'all' || getEventSeverity(event) === severity) &&
      (!needle || searchText(event).includes(needle)),
    )
  }, [device, events, query, severity, type])
  const filtersActive = query !== '' || type !== 'all' || device !== 'all' || severity !== 'all'
  const newSincePause = useMemo(() => {
    if (follow) return 0
    let count = 0
    for (let index = filtered.length - 1; index >= 0 && filtered[index].event_id > pausedAtId; index -= 1) count += 1
    return count
  }, [filtered, follow, pausedAtId])

  // TanStack Virtual exposes an imperative instance that must not be memoized
  // by the React compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => logBodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    initialRect: { width: 1100, height: 600 },
    overscan: 16,
  })
  const visibleRows = isTestMode
    ? filtered.map((_, index) => ({ index, start: index * ROW_HEIGHT }))
    : virtualizer.getVirtualItems()
  const virtualHeight = isTestMode ? filtered.length * ROW_HEIGHT : virtualizer.getTotalSize()

  // Follow the tail only while following; never yank the view while the user reads history.
  useEffect(() => {
    const element = logBodyRef.current
    if (follow && element) element.scrollTop = element.scrollHeight
  }, [follow, filtered.length, virtualHeight])

  const pause = useCallback(() => {
    if (!follow) return
    setPausedAtId(useEventStore.getState().lastEventId)
    setFollow(false)
  }, [follow])

  const onScroll = () => {
    const element = logBodyRef.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= ROW_HEIGHT
    if (atBottom && !follow) setFollow(true)
    if (!atBottom && follow) pause()
  }

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyEvent.key !== 'ArrowDown' && keyEvent.key !== 'ArrowUp' && keyEvent.key !== 'End' && keyEvent.key !== 'Home') return
    if (filtered.length === 0) return
    keyEvent.preventDefault()
    const current = filtered.findIndex((event) => event.event_id === selectedEventId)
    let next: number
    if (keyEvent.key === 'End') next = filtered.length - 1
    else if (keyEvent.key === 'Home') next = 0
    else if (current === -1) next = keyEvent.key === 'ArrowDown' ? 0 : filtered.length - 1
    else next = Math.max(0, Math.min(filtered.length - 1, current + (keyEvent.key === 'ArrowDown' ? 1 : -1)))
    if (next < filtered.length - 1) pause()
    selectEvent(filtered[next].event_id)
    virtualizer.scrollToIndex(next, { align: 'auto' })
  }

  const clearFilters = () => {
    setQuery('')
    setType('all')
    setDevice('all')
    setSeverity('all')
  }

  function exportLogs() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vds4e-events-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page logs-page">
      <PageHeader
        actions={(
          <>
            <button
              aria-pressed={follow}
              className="button button-sm logs-follow"
              onClick={() => (follow ? pause() : setFollow(true))}
              title={follow ? 'Following new events. Scroll up or click to pause.' : 'Jump to the newest event and follow'}
              type="button"
            >
              <ArrowDownToLine aria-hidden="true" size={12} /> Follow
              {newSincePause > 0 && <span className="logs-new">+{newSincePause}</span>}
            </button>
            <button className="button button-sm" disabled={filtered.length === 0} onClick={exportLogs} title="Export the filtered events as JSON" type="button">
              <Download aria-hidden="true" size={12} /> Export JSON
            </button>
          </>
        )}
        context={<span className="mono">{filtered.length} / {events.length} events</span>}
        title="Event Log"
      >
        <label className="search-input logs-search">
          <Search aria-hidden="true" size={13} />
          <input aria-label="Search logs" onChange={(event) => setQuery(event.target.value)} placeholder="Search source, event, payload…" type="search" value={query} />
        </label>
        <select aria-label="Filter logs by event type" className="logs-filter" onChange={(event) => setType(event.target.value)} value={type}>
          <option value="all">All event types</option>
          {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{humanize(eventType)}</option>)}
        </select>
        <select aria-label="Filter logs by device" className="logs-filter" onChange={(event) => setDevice(event.target.value)} value={device}>
          <option value="all">All sources</option>
          {devices.map((deviceId) => <option key={deviceId} value={deviceId}>{deviceId}</option>)}
          <option value="system">System / scenario</option>
        </select>
        <select aria-label="Filter logs by severity" className="logs-filter logs-filter-sm" onChange={(event) => setSeverity(event.target.value as 'all' | EventSeverity)} value={severity}>
          <option value="all">All severities</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        {filtersActive && (
          <button aria-label="Clear filters" className="icon-button" onClick={clearFilters} title="Clear filters" type="button">
            <FilterX aria-hidden="true" size={14} />
          </button>
        )}
      </PageHeader>

      <div className="page-body fill flush">
        <div className="logs-table">
          <div aria-hidden="true" className="logs-row logs-head">
            <span>#</span>
            <span>Wall time</span>
            <span>Virtual time</span>
            <span>Sev</span>
            <span>Source</span>
            <span>Event</span>
            <span>Summary</span>
            <span>Payload</span>
          </div>
          <div
            aria-label="Domain event log. Use arrow keys to step through events."
            className="logs-table-body"
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            ref={logBodyRef}
            aria-live="off"
            role="log"
            tabIndex={0}
          >
            <div className="logs-virtual-spacer" style={{ height: virtualHeight }}>
              {visibleRows.map((item) => {
                const event = filtered[item.index]
                return (
                  <LogRow
                    event={event}
                    index={item.index}
                    key={event.event_id}
                    onSelect={selectEvent}
                    selected={event.event_id === selectedEventId}
                    start={item.start}
                  />
                )
              })}
            </div>
            {events.length === 0 && connectionStatus === 'disconnected' && (
              <AsyncState centered detail="History is restored from the server when the event stream connects." kind="disconnected" title="Event stream disconnected" />
            )}
            {events.length === 0 && connectionStatus !== 'disconnected' && (
              <AsyncState centered kind="empty" title="Waiting for domain events" />
            )}
            {events.length > 0 && filtered.length === 0 && (
              <div className="logs-empty">
                <AsyncState kind="empty" title="No events match the filters" />
                <button className="button button-sm" onClick={clearFilters} type="button">Clear filters</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
