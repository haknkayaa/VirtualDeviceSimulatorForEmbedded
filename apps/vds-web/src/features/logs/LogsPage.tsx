import { Download, ScrollText, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { eventTypes } from '../../types/events'
import { formatVirtualTime, humanize } from '../../utils/format'

const wallTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'medium',
})

export function LogsPage() {
  const events = useEventStore((state) => state.events)
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const selectEvent = useEventStore((state) => state.selectEvent)
  const [query, setQuery] = useState('')
  const [type, setType] = useState('all')
  const [device, setDevice] = useState('all')
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
      (!needle || JSON.stringify(event).toLowerCase().includes(needle)),
    )
  }, [device, events, query, type])
  // TanStack Virtual exposes an imperative instance that must not be memoized
  // by the React compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => logBodyRef.current,
    estimateSize: () => 40,
    initialRect: { width: 930, height: 480 },
    overscan: 12,
  })
  const visibleRows = import.meta.env.MODE === 'test'
    ? filtered.map((_, index) => ({ index, start: index * 40 }))
    : virtualizer.getVirtualItems()
  const virtualHeight = import.meta.env.MODE === 'test'
    ? filtered.length * 40
    : virtualizer.getTotalSize()

  useEffect(() => {
    if (filtered.length > 0) virtualizer.scrollToIndex(filtered.length - 1, { align: 'end' })
  }, [filtered.length, virtualizer])

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
    <div className="page-stack logs-page">
      <PageHeader
        action={<StatusBadge status={connectionStatus} />}
        description="Persistent domain-event history restored from SQLite and updated live over WebSocket."
        eyebrow="Observability"
        title="Logs"
      />
      <GlassPanel
        action={<span className="panel-count">{filtered.length} / {events.length} events</span>}
        className="logs-panel"
        title="Domain Event Log"
      >
        <div className="logs-toolbar">
          <label className="logs-search">
            <Search aria-hidden="true" size={15} />
            <input aria-label="Search logs" onChange={(event) => setQuery(event.target.value)} placeholder="Search device, event, payload…" value={query} />
          </label>
          <select aria-label="Filter logs by event type" onChange={(event) => setType(event.target.value)} value={type}>
            <option value="all">All event types</option>
            {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{humanize(eventType)}</option>)}
          </select>
          <select aria-label="Filter logs by device" onChange={(event) => setDevice(event.target.value)} value={device}>
            <option value="all">All devices</option>
            {devices.map((deviceId) => <option key={deviceId} value={deviceId}>{deviceId}</option>)}
            <option value="system">System / scenario</option>
          </select>
          <button className="button button-secondary" disabled={filtered.length === 0} onClick={exportLogs} type="button">
            <Download aria-hidden="true" size={14} /> Export JSON
          </button>
        </div>
        <div className="logs-table">
          <div className="logs-table-head"><span>ID</span><span>Wall time</span><span>Virtual time</span><span>Source</span><span>Event</span><span>Payload</span></div>
          <div className="logs-table-body" ref={logBodyRef}>
            <div className="logs-virtual-spacer" style={{ height: virtualHeight }}>
              {visibleRows.map((item) => {
                const event = filtered[item.index]
                return (
                  <button
                    className="logs-virtual-row"
                    data-index={item.index}
                    key={event.event_id}
                    onClick={() => selectEvent(event.event_id)}
                    ref={virtualizer.measureElement}
                    style={{ transform: `translateY(${item.start}px)` }}
                    type="button"
                  >
                    <code>#{event.event_id}</code>
                    <time>{wallTimeFormatter.format(new Date(event.timestamp_wall_ns / 1_000_000))}</time>
                    <code>{formatVirtualTime(event.timestamp_virtual_ns)}</code>
                    <strong>{event.device_id ?? event.scenario_run_id ?? 'system'}</strong>
                    <span>{humanize(event.event_type)}</span>
                    <code>{JSON.stringify(event.payload)}</code>
                  </button>
                )
              })}
            </div>
            {filtered.length === 0 && <div className="logs-empty"><ScrollText aria-hidden="true" size={22} /> No matching events</div>}
          </div>
        </div>
      </GlassPanel>
    </div>
  )
}
