export const eventTypes = [
  'transaction_started',
  'transaction_completed',
  'register_read',
  'register_write',
  'state_transition',
  'operation_started',
  'operation_completed',
  'fault_triggered',
  'scenario_started',
  'scenario_step_started',
  'scenario_step_completed',
  'scenario_completed',
  'device_reset',
  'signal_changed',
] as const

export type EventType = (typeof eventTypes)[number]

export type EventPayload =
  | {
      kind: 'transaction_started'
      transaction_id: number | null
      request: number[]
      gpio_output_lines?: boolean[] | null
    }
  | {
      kind: 'transaction_completed'
      transaction_id: number | null
      response: number[]
      result: string
      error_code: string | null
    }
  | { kind: 'register_read'; name: string | null; address: number; value: number | null }
  | {
      kind: 'register_write'
      name: string | null
      address: number
      old_value: number | null
      new_value: number | null
    }
  | {
      kind: 'state_transition'
      from_state: string
      to_state: string
      trigger: string
      result: string
    }
  | { kind: 'operation_started'; command: string; scheduled_duration_ns: number; busy: boolean }
  | { kind: 'operation_completed'; command: string; scheduled_duration_ns: number; result: string }
  | {
      kind: 'fault_triggered'
      fault_id: string
      command: string
      trigger: string
      trigger_count: number
      action: string
      result: string
    }
  | { kind: 'scenario_started'; scenario_id: string }
  | { kind: 'scenario_step_started'; step_id: string; action: string }
  | {
      kind: 'scenario_step_completed'
      step_id: string
      action: string
      status: string
      error: string | null
    }
  | {
      kind: 'scenario_completed'
      scenario_id: string
      status: string
      steps_passed: number
      steps_failed: number
      steps_skipped: number
    }
  | { kind: 'device_reset'; result: string }
  | {
      kind: 'signal_changed'
      phase: 'emitted' | 'delivered'
      source: string
      target: string
      value: boolean
      delay_ns: number
    }

export interface DomainEvent {
  event_id: number
  event_type: EventType
  timestamp_virtual_ns: number
  timestamp_wall_ns: number
  device_id?: string
  scenario_run_id?: string
  payload: EventPayload
}

export type EventConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
