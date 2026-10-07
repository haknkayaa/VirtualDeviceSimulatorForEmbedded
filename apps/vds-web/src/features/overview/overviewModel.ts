import type { Adapter, AdapterBinding, Device, DeviceCommand } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { humanize } from '../../utils/format'
import type { LiveTransaction } from '../transactions/transactionModel'

/* ── Host prerequisites ──────────────────────────────────────────────── */

export interface HostPrerequisites {
  /** Kernel modules the bound adapters need but the host does not provide. */
  missingModules: string[]
  /** Bound adapters that are ready to load but not loaded. */
  loadableAdapters: Adapter[]
  /** Bound adapters in the error state. */
  failedAdapters: Adapter[]
  nodesOpen: number
  nodesTotal: number
}

function kernelModule(adapter: Adapter): string | undefined {
  const driver = adapter.driver.toLowerCase()
  if (driver === 'cuse') return 'cuse'
  if (driver === 'gpio-sim') return 'gpio-sim'
  return undefined
}

/** What stands between the application and its device nodes, if anything. */
export function hostPrerequisites(adapters: Adapter[] | undefined): HostPrerequisites {
  const used = (adapters ?? []).filter((adapter) => adapter.bindings.length > 0)
  const missingModules = [...new Set(used
    .filter((adapter) => adapter.readiness !== 'ready')
    .map(kernelModule)
    .filter((module): module is string => Boolean(module)))].sort()
  const loaded = used.filter((adapter) => adapter.state === 'loaded')
  return {
    missingModules,
    loadableAdapters: used.filter((adapter) => adapter.readiness === 'ready' && adapter.state === 'unloaded'),
    failedAdapters: used.filter((adapter) => adapter.state === 'error'),
    nodesOpen: loaded.reduce((total, adapter) => total + adapter.bindings.length, 0),
    nodesTotal: used.reduce((total, adapter) => total + adapter.bindings.length, 0),
  }
}

/* ── Live device path ────────────────────────────────────────────────── */

export interface DevicePathLink {
  binding: AdapterBinding
  device?: Device
}

export interface DevicePathGroup {
  adapter: Adapter
  links: DevicePathLink[]
}

/** Adapters with at least one bound device, each with its devices in endpoint order. */
export function buildDevicePath(adapters: Adapter[] | undefined, devices: Device[] | undefined): DevicePathGroup[] {
  const byId = new Map((devices ?? []).map((device) => [device.id, device]))
  return (adapters ?? [])
    .filter((adapter) => adapter.bindings.length > 0)
    .map((adapter) => ({
      adapter,
      links: [...adapter.bindings]
        .sort((left, right) => left.endpoint - right.endpoint)
        .map((binding) => ({ binding, device: byId.get(binding.device_id) })),
    }))
}

export function unboundDevices(adapters: Adapter[] | undefined, devices: Device[] | undefined) {
  const bound = new Set((adapters ?? []).flatMap((adapter) => adapter.bindings.map((binding) => binding.device_id)))
  return (devices ?? []).filter((device) => !bound.has(device.id))
}

export type LinkActivity =
  | { kind: 'down'; label: string }
  | { kind: 'idle'; label: string }
  | { kind: 'active'; label: string; failed: boolean; edge?: boolean }

/** How long a link stays "active" after its last transaction. */
export const LINK_ACTIVE_MS = 10_000

export function transactionWallMs(transaction: LiveTransaction) {
  return (transaction.completedWallNs ?? transaction.startedWallNs ?? 0) / 1_000_000
}

function hexBytes(bytes: number[], limit = 4) {
  const shown = bytes.slice(0, limit).map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  return bytes.length > limit ? `${shown} …` : shown
}

/** Label for the link between an adapter and one device: last traffic, idle, or down. */
export function linkActivity(adapter: Adapter, deviceId: string, transactions: LiveTransaction[], now: number): LinkActivity {
  const last = transactions.find((transaction) => transaction.deviceId === deviceId)
  const recent = last && now - transactionWallMs(last) <= LINK_ACTIVE_MS
  if (adapter.state !== 'loaded' && !recent) {
    return { kind: 'down', label: adapter.state === 'error' ? 'Adapter error' : 'Not loaded' }
  }
  if (!last || !recent) return { kind: 'idle', label: 'Idle' }
  if (adapter.bus_type.toLowerCase() === 'gpio') {
    const edge = last.gpioEdges?.[0]
    return { kind: 'active', label: edge ? `Edge ${edge.to ? '↑' : '↓'} (line ${edge.line})` : 'Lines updated', failed: last.status === 'error', edge: true }
  }
  const tx = last.request.length ? `TX ${hexBytes(last.request, 2)}` : ''
  const rx = last.response.length ? `RX ${hexBytes(last.response, 3)}` : ''
  return { kind: 'active', label: [tx, rx].filter(Boolean).join(' / ') || 'Transfer', failed: last.status === 'error' }
}

/* ── Transactions ────────────────────────────────────────────────────── */

/** Human operation name: the device command matching the opcode, else read/write by direction. */
export function transactionOperation(transaction: LiveTransaction, commands: DeviceCommand[] | undefined) {
  const bus = transaction.busType.toLowerCase()
  if (bus === 'gpio') {
    const edges = transaction.gpioEdges?.length ?? 0
    return edges ? `Line change (${edges})` : 'Write (lines)'
  }
  const opcode = transaction.request[0]
  if (bus === 'spi' && opcode !== undefined) {
    const command = commands?.find((candidate) => candidate.opcode === opcode)
    if (command) return humanize(command.name.toLowerCase()).replace(/^\w/, (letter) => letter.toUpperCase())
  }
  const length = transaction.response.length || transaction.request.length
  const unit = `${length} byte${length === 1 ? '' : 's'}`
  return transaction.response.length ? `Read (${unit})` : `Write (${unit})`
}

export function transactionHex(bytes: number[], limit = 4) {
  return bytes.length ? hexBytes(bytes, limit) : '—'
}

/** Virtual time in seconds with millisecond precision, e.g. "02.318". */
export function virtualSeconds(nanoseconds: number | undefined) {
  if (nanoseconds === undefined) return '—'
  return (nanoseconds / 1_000_000_000).toFixed(3).padStart(6, '0')
}

/* ── Bus timeline ────────────────────────────────────────────────────── */

export interface TimelineTick {
  id: string
  /** Position in the window, 0 = window start, 1 = now. */
  at: number
  failed: boolean
}

export interface TimelineLane {
  bus: string
  ticks: TimelineTick[]
  configured: boolean
}

const TIMELINE_BUSES = ['spi', 'i2c', 'gpio', 'uart']

export function buildTimeline(transactions: LiveTransaction[], adapters: Adapter[] | undefined, now: number, windowMs: number): TimelineLane[] {
  const start = now - windowMs
  const lanes = new Map(TIMELINE_BUSES.map((bus) => [bus, [] as TimelineTick[]]))
  for (const transaction of transactions) {
    const wall = transactionWallMs(transaction)
    if (wall < start) break
    if (wall > now) continue
    const bus = transaction.busType.toLowerCase()
    if (bus === 'gpio' && (transaction.gpioEdges?.length ?? 0) === 0) continue
    if (!lanes.has(bus)) lanes.set(bus, [])
    lanes.get(bus)?.push({ id: transaction.id, at: (wall - start) / windowMs, failed: transaction.status === 'error' })
  }
  const configured = new Set((adapters ?? []).map((adapter) => adapter.bus_type.toLowerCase()))
  return [...lanes].map(([bus, ticks]) => ({ bus, ticks, configured: configured.has(bus) }))
}

/* ── Scenario run ────────────────────────────────────────────────────── */

export type ScenarioStepState = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export interface ScenarioRunStep {
  id: string
  action: string
  state: ScenarioStepState
  durationNs?: number
  error?: string
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
  /** Steps seen in the event stream, in execution order. */
  steps: ScenarioRunStep[]
}

function stepState(status: string): ScenarioStepState {
  if (/fail|error|timeout/i.test(status)) return 'failed'
  if (/skip/i.test(status)) return 'skipped'
  return 'passed'
}

/** Latest scenario run reconstructed from retained scenario events. */
export function latestScenarioRun(events: DomainEvent[]): ScenarioRunSummary | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.payload.kind !== 'scenario_started' && event.payload.kind !== 'scenario_completed') continue
    const runId = event.scenario_run_id
    const runEvents = runId ? events.filter((candidate) => candidate.scenario_run_id === runId) : [event]
    let started: DomainEvent | undefined
    let completed: DomainEvent | undefined
    const steps = new Map<string, ScenarioRunStep>()
    const stepStarts = new Map<string, number>()
    for (const candidate of runEvents) {
      const payload = candidate.payload
      if (payload.kind === 'scenario_started') started ??= candidate
      else if (payload.kind === 'scenario_completed') completed = candidate
      else if (payload.kind === 'scenario_step_started') {
        stepStarts.set(payload.step_id, candidate.timestamp_virtual_ns)
        steps.set(payload.step_id, { id: payload.step_id, action: payload.action, state: 'running' })
      } else if (payload.kind === 'scenario_step_completed') {
        const startedNs = stepStarts.get(payload.step_id)
        steps.set(payload.step_id, {
          id: payload.step_id,
          action: payload.action,
          state: stepState(payload.status),
          durationNs: startedNs === undefined ? undefined : candidate.timestamp_virtual_ns - startedNs,
          error: payload.error ?? undefined,
        })
      }
    }
    const completion = completed?.payload.kind === 'scenario_completed' ? completed.payload : undefined
    return {
      runId,
      scenarioId: completion?.scenario_id ?? (started?.payload.kind === 'scenario_started' ? started.payload.scenario_id : 'scenario'),
      status: completion?.status ?? 'running',
      startedVirtualNs: started?.timestamp_virtual_ns,
      completedVirtualNs: completed?.timestamp_virtual_ns,
      passed: completion?.steps_passed,
      failed: completion?.steps_failed,
      skipped: completion?.steps_skipped,
      steps: [...steps.values()],
    }
  }
  return undefined
}

/** Merge the scenario definition's step order with the states seen in the run. */
export function mergeScenarioSteps(run: ScenarioRunSummary, definition: { id: string; action: string }[] | undefined): ScenarioRunStep[] {
  if (!definition?.length) return run.steps
  const seen = new Map(run.steps.map((step) => [step.id, step]))
  const finished = run.status !== 'running'
  return definition.map((step) => seen.get(step.id) ?? { id: step.id, action: step.action, state: finished ? 'skipped' : 'queued' })
}
