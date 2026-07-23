import { CircleAlert, CircleX, Info } from 'lucide-react'

import { useEventStore } from '../../stores/eventStore'
import type { DomainEvent } from '../../types/events'
import { formatHex, formatVirtualTime, humanize } from '../../utils/format'

type EventSeverity = 'info' | 'warn' | 'error'

interface LiveEventStreamProps {
  events: DomainEvent[]
}

const wallTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
})

const severityIcons = {
  info: Info,
  warn: CircleAlert,
  error: CircleX,
} as const

function includesFailure(value: string | null | undefined) {
  return value != null && /error|fail|reject|timeout|cancel/i.test(value)
}

function getSeverity(event: DomainEvent): EventSeverity {
  const payload = event.payload
  if (payload.kind === 'transaction_completed' && (payload.error_code || includesFailure(payload.result))) return 'error'
  if (payload.kind === 'scenario_step_completed' && includesFailure(payload.status)) return 'error'
  if (payload.kind === 'scenario_completed' && includesFailure(payload.status)) return 'error'
  if (payload.kind === 'operation_completed' && includesFailure(payload.result)) return 'error'
  if (payload.kind === 'state_transition' && (payload.to_state === 'error' || includesFailure(payload.result))) return 'error'
  if (payload.kind === 'fault_triggered') return 'warn'
  return 'info'
}

function formatEventTimestamp(event: DomainEvent) {
  if (event.timestamp_wall_ns > 0) return wallTimeFormatter.format(new Date(event.timestamp_wall_ns / 1_000_000))
  return formatVirtualTime(event.timestamp_virtual_ns)
}

function registerName(name: string | null, address: number) {
  return name ?? formatHex(address, 16)
}

function eventDetail(event: DomainEvent) {
  const payload = event.payload
  switch (payload.kind) {
    case 'transaction_started':
      return `${payload.request.length} request byte${payload.request.length === 1 ? '' : 's'}`
    case 'transaction_completed':
      return payload.error_code ?? `${payload.response.length} response byte${payload.response.length === 1 ? '' : 's'} · ${payload.result}`
    case 'register_read':
      return `${registerName(payload.name, payload.address)} = ${payload.value == null ? '—' : formatHex(payload.value)}`
    case 'register_write':
      return `${registerName(payload.name, payload.address)} · ${payload.old_value == null ? '—' : formatHex(payload.old_value)} → ${payload.new_value == null ? '—' : formatHex(payload.new_value)}`
    case 'state_transition':
      return `${payload.from_state} → ${payload.to_state} · ${payload.trigger}`
    case 'operation_started':
      return `${payload.command} · ${formatVirtualTime(payload.scheduled_duration_ns)}`
    case 'operation_completed':
      return `${payload.command} · ${payload.result}`
    case 'fault_triggered':
      return `${payload.fault_id} · ${payload.action}`
    case 'scenario_started':
      return payload.scenario_id
    case 'scenario_step_started':
      return `${payload.step_id} · ${humanize(payload.action)}`
    case 'scenario_step_completed':
      return `${payload.step_id} · ${payload.status}${payload.error ? ` · ${payload.error}` : ''}`
    case 'scenario_completed':
      return `${payload.scenario_id} · ${payload.status}`
    case 'device_reset':
      return payload.result
  }
}

export function LiveEventStream({ events }: LiveEventStreamProps) {
  const selectEvent = useEventStore((state) => state.selectEvent)

  return (
    <div aria-label="Live event stream" className="dashboard-live-events" role="log">
      {events.map((event) => {
        const severity = getSeverity(event)
        const SeverityIcon = severityIcons[severity]
        return (
          <button
            aria-label={`${severity} ${humanize(event.event_type)} on ${event.device_id ?? event.scenario_run_id ?? 'system'}`}
            className="dashboard-live-event"
            key={event.event_id}
            onClick={() => selectEvent(event.event_id)}
            type="button"
          >
            <time title={`Virtual time ${formatVirtualTime(event.timestamp_virtual_ns)}`}>{formatEventTimestamp(event)}</time>
            <span className={`live-event-severity severity-${severity}`}>
              <SeverityIcon aria-hidden="true" size={13} />
              {severity}
            </span>
            <strong className="live-event-source">{event.device_id ?? event.scenario_run_id ?? 'system'}</strong>
            <span className="live-event-type">{humanize(event.event_type)}</span>
            <span className="live-event-detail">{eventDetail(event)}</span>
            <span className="live-event-id">#{event.event_id}</span>
          </button>
        )
      })}
    </div>
  )
}
