import type { DomainEvent } from '../types/events'
import { formatHex, formatVirtualTime, humanize } from './format'

export type EventSeverity = 'info' | 'warn' | 'error'

function includesFailure(value: string | null | undefined) {
  return value != null && /error|fail|reject|timeout|cancel/i.test(value)
}

export function getEventSeverity(event: DomainEvent): EventSeverity {
  const payload = event.payload
  if (payload.kind === 'transaction_completed' && (payload.error_code || includesFailure(payload.result))) return 'error'
  if (payload.kind === 'scenario_step_completed' && includesFailure(payload.status)) return 'error'
  if (payload.kind === 'scenario_completed' && includesFailure(payload.status)) return 'error'
  if (payload.kind === 'operation_completed' && includesFailure(payload.result)) return 'error'
  if (payload.kind === 'state_transition' && (payload.to_state === 'error' || includesFailure(payload.result))) return 'error'
  if (payload.kind === 'fault_triggered') return 'warn'
  return 'info'
}

export function eventSource(event: DomainEvent) {
  return event.device_id ?? event.scenario_run_id ?? 'system'
}

const wallTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
})

/** Wall-clock time of day (HH:MM:SS.mmm); falls back to virtual time when no wall stamp exists. */
export function formatEventTime(event: Pick<DomainEvent, 'timestamp_wall_ns' | 'timestamp_virtual_ns'>) {
  if (event.timestamp_wall_ns > 0) return formatWallTime(event.timestamp_wall_ns)
  return formatVirtualTime(event.timestamp_virtual_ns)
}

export function formatWallTime(wallNs: number) {
  return wallTimeFormatter.format(new Date(wallNs / 1_000_000))
}

function registerName(name: string | null, address: number) {
  return name ?? formatHex(address, 16)
}

/** One-line, human-readable payload summary used by event tails and logs. */
export function eventSummary(event: DomainEvent) {
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
    case 'signal_changed':
      return `${payload.source} → ${payload.target} = ${payload.value ? 'high' : 'low'} · ${payload.phase}${payload.delay_ns > 0 ? ` (+${formatVirtualTime(payload.delay_ns)})` : ''}`
  }
}
