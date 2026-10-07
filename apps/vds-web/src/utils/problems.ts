import type { Adapter, BusTelemetry, Device, Fault } from '../types/api'
import type { DomainEvent, EventConnectionStatus } from '../types/events'
import { getEventSeverity } from './events'

export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface Problem {
  id: string
  severity: ProblemSeverity
  /** Object the problem belongs to: adapter id, device id, `vds-server`, … */
  source: string
  message: string
  detail?: string
  /** Workspace route where the problem can be inspected or fixed. */
  to?: string
}

export interface ProblemInputs {
  controlApiError?: boolean
  connectionStatus: EventConnectionStatus
  reconnectAttempt?: number
  adapters?: Adapter[]
  devices?: Device[]
  faults?: Fault[]
  telemetry?: BusTelemetry[]
  events: DomainEvent[]
}

const severityRank: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 }

function adapterRoute(adapterId: string) {
  return `/adapters?adapter=${encodeURIComponent(adapterId)}`
}

function deviceRoute(deviceId: string) {
  return `/devices/${encodeURIComponent(deviceId)}`
}

/**
 * Derives the workspace problem list from authoritative snapshots and the
 * retained event history. Pure so the Overview and status bar always agree.
 */
export function collectProblems(inputs: ProblemInputs): Problem[] {
  const problems: Problem[] = []

  if (inputs.controlApiError) {
    problems.push({ id: 'control-api', severity: 'error', source: 'vds-server', message: 'Control API is not responding', detail: 'REST snapshots are stale until the server is reachable again.' })
  }
  if (inputs.connectionStatus === 'disconnected' || inputs.connectionStatus === 'reconnecting') {
    problems.push({
      id: 'event-stream',
      severity: 'warning',
      source: 'event stream',
      message: inputs.connectionStatus === 'reconnecting'
        ? `Event stream reconnecting${inputs.reconnectAttempt ? ` (attempt ${inputs.reconnectAttempt})` : ''}`
        : 'Event stream disconnected',
      detail: 'Live transactions and logs resume from the last received event id.',
    })
  }

  for (const adapter of inputs.adapters ?? []) {
    const to = adapterRoute(adapter.id)
    if (adapter.state === 'error') {
      problems.push({ id: `adapter-error-${adapter.id}`, severity: 'error', source: adapter.id, message: `Adapter failed: ${adapter.error ?? 'unknown error'}`, to })
    } else if (adapter.readiness === 'authorization_required') {
      problems.push({ id: `adapter-auth-${adapter.id}`, severity: 'warning', source: adapter.id, message: 'Kernel adapter needs OS authorization', detail: adapter.bus_type === 'gpio' ? 'sudo modprobe gpio-sim' : 'sudo modprobe cuse', to })
    } else if (adapter.readiness === 'unavailable') {
      problems.push({ id: `adapter-unavailable-${adapter.id}`, severity: 'warning', source: adapter.id, message: `${adapter.driver} driver unavailable on this host`, to })
    } else if (adapter.state === 'unloaded' && adapter.bindings.length > 0) {
      const paths = adapter.bindings.map((binding) => binding.device_path).join(', ')
      problems.push({ id: `adapter-unloaded-${adapter.id}`, severity: 'warning', source: adapter.id, message: 'Adapter not loaded — device nodes are not exposed', detail: paths, to })
    }
    if (adapter.bindings.length === 0) {
      problems.push({ id: `adapter-empty-${adapter.id}`, severity: 'info', source: adapter.id, message: 'Adapter has no attached devices', to })
    }
  }

  if (inputs.adapters && inputs.devices) {
    const bound = new Set(inputs.adapters.flatMap((adapter) => adapter.bindings.map((binding) => binding.device_id)))
    for (const device of inputs.devices) {
      if (device.state === 'error') {
        problems.push({ id: `device-error-${device.id}`, severity: 'error', source: device.id, message: 'Device runtime is in the error state', to: deviceRoute(device.id) })
      }
      if (!bound.has(device.id)) {
        problems.push({ id: `device-unbound-${device.id}`, severity: 'info', source: device.id, message: 'Device is not bound to an adapter', detail: 'Applications cannot reach it through a Linux device node.', to: deviceRoute(device.id) })
      }
    }
  }

  for (const fault of inputs.faults ?? []) {
    if (!fault.enabled) continue
    problems.push({ id: `fault-${fault.id}`, severity: 'warning', source: fault.device_id, message: `Fault injection active: ${fault.id}`, detail: `${fault.action} on ${fault.trigger}`, to: deviceRoute(fault.device_id) })
  }

  for (const bus of inputs.telemetry ?? []) {
    if (bus.health !== 'degraded' && bus.health !== 'unhealthy') continue
    problems.push({
      id: `bus-${bus.device_id}`,
      severity: bus.health === 'unhealthy' ? 'error' : 'warning',
      source: bus.device_id,
      message: `${bus.bus_type.toUpperCase()} bus ${bus.health}: ${bus.errors.count} error${bus.errors.count === 1 ? '' : 's'} (${(bus.errors.rate * 100).toFixed(1)}%)`,
      detail: bus.errors.last_code ? `last error ${bus.errors.last_code}` : undefined,
      to: '/transactions',
    })
  }

  // Aggregate retained error events per source so a noisy device is one row.
  const eventErrors = new Map<string, { count: number; last: DomainEvent }>()
  for (const event of inputs.events) {
    if (getEventSeverity(event) !== 'error') continue
    const key = event.device_id ?? event.scenario_run_id ?? 'system'
    const current = eventErrors.get(key)
    eventErrors.set(key, { count: (current?.count ?? 0) + 1, last: event })
  }
  for (const [source, { count, last }] of eventErrors) {
    const scenario = last.payload.kind === 'scenario_completed' || last.payload.kind === 'scenario_step_completed'
    problems.push({
      id: `events-${source}`,
      severity: 'error',
      source,
      message: `${count} error event${count === 1 ? '' : 's'} in session`,
      detail: `last #${last.event_id} ${last.event_type.replaceAll('_', ' ')}`,
      to: scenario || !last.device_id ? '/logs' : '/transactions',
    })
  }

  return problems.sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
}

export function countProblems(problems: Problem[]) {
  let errors = 0
  let warnings = 0
  for (const problem of problems) {
    if (problem.severity === 'error') errors += 1
    else if (problem.severity === 'warning') warnings += 1
  }
  return { errors, warnings }
}
