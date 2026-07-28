import type { DomainEvent } from '../../types/events'

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
