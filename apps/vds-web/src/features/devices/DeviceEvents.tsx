import { ListTree, ScrollText } from 'lucide-react'
import { useMemo } from 'react'

import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { VirtualEventList } from '../../components/VirtualEventList'
import type { DomainEvent } from '../../types/events'
import { formatEventTime, getEventSeverity } from '../../utils/events'
import { humanize } from '../../utils/format'

export interface DeviceEventFilter {
  type: string
  problemsOnly: boolean
}

interface DeviceEventsProps {
  /** Device-scoped events, newest first. */
  events: DomainEvent[]
  filter: DeviceEventFilter
  onFilterChange: (filter: DeviceEventFilter) => void
}

export function DeviceEvents({ events, filter, onFilterChange }: DeviceEventsProps) {
  const types = useMemo(() => [...new Set(events.map((event) => event.event_type))].sort(), [events])
  const visible = useMemo(
    () => events.filter((event) =>
      (filter.type === 'all' || event.event_type === filter.type)
      && (!filter.problemsOnly || getEventSeverity(event) !== 'info')),
    [events, filter],
  )

  return (
    <Panel
      actions={(
        <>
          <select aria-label="Event type" onChange={(event) => onFilterChange({ ...filter, type: event.target.value })} value={filter.type}>
            <option value="all">All types</option>
            {types.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
            {filter.type !== 'all' && !types.some((type) => type === filter.type) && <option value={filter.type}>{humanize(filter.type)}</option>}
          </select>
          <button aria-pressed={filter.problemsOnly} className="button button-sm" onClick={() => onFilterChange({ ...filter, problemsOnly: !filter.problemsOnly })} type="button">
            Problems only
          </button>
        </>
      )}
      className="dv-tab-panel dv-events"
      flush
      icon={ScrollText}
      meta={visible.length === events.length ? `${events.length} retained` : `${visible.length}/${events.length}`}
      title="Device events"
    >
      {events.length === 0
        ? <AsyncState detail="Events appear as the runtime handles transactions, register access and state changes." kind="empty" title="No events retained for this device" />
        : visible.length === 0
          ? <AsyncState detail="Adjust the type or severity filter." kind="empty" title="No matching events" />
          : <VirtualEventList aria-label="Device events" events={visible} showSource={false} />}
    </Panel>
  )
}

/** Per-type histogram of the device's retained (chronological) events; selecting a type filters the list. */
export function DeviceEventBreakdown({ events, filter, onFilterChange }: DeviceEventsProps) {
  const rows = useMemo(() => {
    const byType = new Map<string, { count: number; problems: number; last: DomainEvent }>()
    for (const event of events) {
      const entry = byType.get(event.event_type)
      const problem = getEventSeverity(event) !== 'info' ? 1 : 0
      if (entry) {
        entry.count += 1
        entry.problems += problem
        entry.last = event
      } else {
        byType.set(event.event_type, { count: 1, problems: problem, last: event })
      }
    }
    return [...byType.entries()].sort((left, right) => right[1].count - left[1].count)
  }, [events])

  return (
    <Panel className="dv-event-breakdown" flush icon={ListTree} meta={`${rows.length} types`} title="Event Breakdown">
      {rows.length === 0
        ? <AsyncState kind="empty" title="No events yet" />
        : (
          <table className="data-table">
            <thead><tr><th>Type</th><th className="num">Count</th><th className="num">Err</th><th>Last</th></tr></thead>
            <tbody>
              {rows.map(([type, entry]) => (
                <tr
                  aria-selected={filter.type === type}
                  className={`clickable${filter.type === type ? ' selected' : ''}`}
                  key={type}
                  onClick={() => onFilterChange({ ...filter, type: filter.type === type ? 'all' : type })}
                >
                  <td>{humanize(type)}</td>
                  <td className="num">{entry.count}</td>
                  <td className={`num${entry.problems ? ' text-err' : ' dim'}`}>{entry.problems}</td>
                  <td className="mono dim">{formatEventTime(entry.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Panel>
  )
}
