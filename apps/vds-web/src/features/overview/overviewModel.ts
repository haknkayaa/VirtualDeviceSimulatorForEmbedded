import type { Adapter, AdapterBinding, BusTelemetry, Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import type { LiveTransaction } from '../transactions/transactionModel'

export interface DeviceNodeRow {
  key: string
  adapter?: Adapter
  binding?: AdapterBinding
  device?: Device
  deviceId?: string
  telemetry?: BusTelemetry
  lastActivityWallNs?: number
}

/**
 * One row per Linux device node an application can open, followed by adapters
 * with nothing attached and runtime devices no adapter exposes.
 */
export function buildDeviceNodeRows(
  adapters: Adapter[] | undefined,
  devices: Device[] | undefined,
  telemetry: BusTelemetry[] | undefined,
  events: DomainEvent[],
): DeviceNodeRow[] {
  const devicesById = new Map((devices ?? []).map((device) => [device.id, device]))
  const telemetryById = new Map((telemetry ?? []).map((bus) => [bus.device_id, bus]))
  const lastActivity = new Map<string, number>()
  for (const event of events) {
    if (event.device_id && (event.event_type === 'transaction_completed' || event.event_type === 'signal_changed')) {
      lastActivity.set(event.device_id, event.timestamp_wall_ns)
    }
  }
  const rows: DeviceNodeRow[] = []
  const bound = new Set<string>()
  for (const adapter of adapters ?? []) {
    if (adapter.bindings.length === 0) {
      rows.push({ key: `adapter:${adapter.id}`, adapter })
      continue
    }
    for (const binding of adapter.bindings) {
      bound.add(binding.device_id)
      rows.push({
        key: `${adapter.id}:${binding.device_id}`,
        adapter,
        binding,
        device: devicesById.get(binding.device_id),
        deviceId: binding.device_id,
        telemetry: telemetryById.get(binding.device_id),
        lastActivityWallNs: lastActivity.get(binding.device_id),
      })
    }
  }
  for (const device of devices ?? []) {
    if (bound.has(device.id)) continue
    rows.push({
      key: `device:${device.id}`,
      device,
      deviceId: device.id,
      telemetry: telemetryById.get(device.id),
      lastActivityWallNs: lastActivity.get(device.id),
    })
  }
  return rows
}

function hexPreview(bytes: number[], limit = 4) {
  const preview = bytes.slice(0, limit).map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  return bytes.length > limit ? `${preview} …` : preview
}

/** Compact wire-level summary of a transaction for overview tables. */
export function transactionWireSummary(transaction: LiveTransaction) {
  if (transaction.busType.toLowerCase() === 'gpio') {
    const edges = transaction.gpioEdges ?? []
    if (edges.length === 0) return 'no edge'
    const first = edges[0]
    const label = `IO${first.line} ${first.to ? '↑' : '↓'}`
    return edges.length === 1 ? label : `${label} +${edges.length - 1}`
  }
  const request = transaction.request.length ? hexPreview(transaction.request) : '—'
  return transaction.response.length ? `${request} → ${hexPreview(transaction.response)}` : request
}

export interface ScenarioRunSummary {
  runId?: string
  scenarioId: string
  status: string
  startedVirtualNs?: number
  completedVirtualNs?: number
  passed?: number
  failed?: number
  skipped?: number
  lastStep?: string
  lastError?: string
}

function findLastEvent(events: DomainEvent[], predicate: (event: DomainEvent) => boolean) {
  for (let index = events.length - 1; index >= 0; index -= 1) if (predicate(events[index])) return events[index]
  return undefined
}

/** Latest scenario run reconstructed from retained scenario events. */
export function latestScenarioRun(events: DomainEvent[]): ScenarioRunSummary | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.payload.kind !== 'scenario_started' && event.payload.kind !== 'scenario_completed') continue
    const runId = event.scenario_run_id
    const runEvents = runId ? events.filter((candidate) => candidate.scenario_run_id === runId) : [event]
    const started = runEvents.find((candidate) => candidate.payload.kind === 'scenario_started')
    const completed = findLastEvent(runEvents, (candidate) => candidate.payload.kind === 'scenario_completed')
    const steps = runEvents.filter((candidate) => candidate.payload.kind === 'scenario_step_completed')
    const lastStep = steps.at(-1)
    const failedStep = findLastEvent(steps, (candidate) => candidate.payload.kind === 'scenario_step_completed' && Boolean(candidate.payload.error))
    const completion = completed?.payload.kind === 'scenario_completed' ? completed.payload : undefined
    const scenarioId = completion?.scenario_id
      ?? (started?.payload.kind === 'scenario_started' ? started.payload.scenario_id : 'scenario')
    return {
      runId,
      scenarioId,
      status: completion?.status ?? 'running',
      startedVirtualNs: started?.timestamp_virtual_ns,
      completedVirtualNs: completed?.timestamp_virtual_ns,
      passed: completion?.steps_passed,
      failed: completion?.steps_failed,
      skipped: completion?.steps_skipped,
      lastStep: lastStep?.payload.kind === 'scenario_step_completed' ? lastStep.payload.step_id : undefined,
      lastError: failedStep?.payload.kind === 'scenario_step_completed' ? failedStep.payload.error ?? undefined : undefined,
    }
  }
  return undefined
}
