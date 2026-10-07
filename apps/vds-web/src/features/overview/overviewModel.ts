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

export type BringUpStatus = 'ok' | 'fail' | 'blocked' | 'idle'

export interface BringUpStep {
  id: 'modules' | 'adapters' | 'nodes' | 'traffic'
  title: string
  status: BringUpStatus
  detail: string
}

export interface BringUpState {
  steps: BringUpStep[]
  /** First failing step; undefined when the host is ready. */
  current?: BringUpStep
  missingModules: string[]
  /** Adapters with bindings that are ready to load but not loaded. */
  loadableAdapters: Adapter[]
  nodesOpen: number
  nodesTotal: number
}

function kernelModule(adapter: Adapter): string | undefined {
  const driver = adapter.driver.toLowerCase()
  if (driver === 'cuse') return 'cuse'
  if (driver === 'gpio-sim') return 'gpio-sim'
  return undefined
}

/**
 * The host bring-up path an application depends on, in the order it fails:
 * kernel modules → adapters loaded → device nodes open → runtime traffic.
 * Steps after the first failure are reported as blocked, not failed, so the
 * user fixes one cause instead of reading four symptoms.
 */
export function buildBringUp(adapters: Adapter[] | undefined, transactions: LiveTransaction[]): BringUpState {
  const used = (adapters ?? []).filter((adapter) => adapter.bindings.length > 0)
  const missingModules = [...new Set(used
    .filter((adapter) => adapter.readiness !== 'ready')
    .map(kernelModule)
    .filter((module): module is string => Boolean(module)))]
  const loaded = used.filter((adapter) => adapter.state === 'loaded')
  const failedAdapters = used.filter((adapter) => adapter.state === 'error')
  const loadableAdapters = used.filter((adapter) => adapter.readiness === 'ready' && (adapter.state === 'unloaded' || adapter.state === 'error'))
  const nodesTotal = used.reduce((total, adapter) => total + adapter.bindings.length, 0)
  const nodesOpen = loaded.reduce((total, adapter) => total + adapter.bindings.length, 0)
  const failed = transactions.filter((transaction) => transaction.status === 'error').length

  const modulesStatus: BringUpStatus = missingModules.length ? 'fail' : 'ok'
  let adaptersStatus: BringUpStatus = 'fail'
  if (used.length > 0 && loaded.length === used.length) adaptersStatus = 'ok'
  else if (used.length > 0 && failedAdapters.length === 0 && modulesStatus === 'fail') adaptersStatus = 'blocked'
  const nodesStatus: BringUpStatus = nodesTotal > 0 && nodesOpen === nodesTotal ? 'ok' : adaptersStatus === 'ok' ? 'fail' : 'blocked'
  const trafficStatus: BringUpStatus = transactions.length > 0 ? 'ok' : 'idle'

  const steps: BringUpStep[] = [
    {
      id: 'modules',
      title: 'Kernel modules',
      status: modulesStatus,
      detail: missingModules.length ? missingModules.map((module) => `${module} missing`).join(' · ') : used.length ? 'cuse and gpio-sim available' : 'No adapters need a module yet',
    },
    {
      id: 'adapters',
      title: 'Adapters loaded',
      status: adaptersStatus,
      detail: used.length === 0
        ? 'No adapter has a device attached'
        : `${loaded.length} of ${used.length}${failedAdapters.length ? ` · ${failedAdapters.map((adapter) => adapter.id).join(', ')} failed` : ` · ${used.map((adapter) => adapter.id).join(', ')}`}`,
    },
    {
      id: 'nodes',
      title: 'Device nodes open',
      status: nodesStatus,
      detail: nodesTotal === 0 ? 'No device nodes bound' : `${nodesOpen} of ${nodesTotal}`,
    },
    {
      id: 'traffic',
      title: 'Runtime traffic',
      status: trafficStatus,
      detail: transactions.length === 0 ? 'No transactions yet' : `${transactions.length} transactions${failed ? ` · ${failed} failed` : ''}`,
    },
  ]
  return {
    steps,
    current: steps.find((step) => step.status === 'fail'),
    missingModules,
    loadableAdapters,
    nodesOpen,
    nodesTotal,
  }
}

export interface BusLane {
  bus: string
  transactions: LiveTransaction[]
  total: number
  failed: number
  /** Why the lane is silent, when it has no transactions. */
  silentReason?: string
}

const LANE_BUSES = ['spi', 'i2c', 'gpio', 'uart']

/** One lane per bus: the newest transactions oldest-first, so time reads left to right. */
export function buildBusLanes(transactions: LiveTransaction[], adapters: Adapter[] | undefined, limit = 18): BusLane[] {
  const extra = [...new Set(transactions.map((transaction) => transaction.busType.toLowerCase()))].filter((bus) => !LANE_BUSES.includes(bus))
  return [...LANE_BUSES, ...extra].map((bus) => {
    const onBus = transactions.filter((transaction) => transaction.busType.toLowerCase() === bus)
    const busAdapters = (adapters ?? []).filter((adapter) => adapter.bus_type.toLowerCase() === bus)
    let silentReason: string | undefined
    if (onBus.length === 0) {
      if (busAdapters.length === 0) silentReason = `No ${bus.toUpperCase()} adapter configured`
      else if (!busAdapters.some((adapter) => adapter.state === 'loaded')) silentReason = `${busAdapters.map((adapter) => adapter.id).join(', ')} not loaded`
      else silentReason = bus === 'gpio' ? 'No line edges yet' : 'No traffic yet'
    }
    return {
      bus,
      transactions: onBus.slice(0, limit).reverse(),
      total: onBus.length,
      failed: onBus.filter((transaction) => transaction.status === 'error').length,
      silentReason,
    }
  })
}

/** Short opcode-style label for a lane chip. */
export function laneLabel(transaction: LiveTransaction) {
  if (transaction.busType.toLowerCase() === 'gpio') {
    const edge = transaction.gpioEdges?.[0]
    return edge ? `IO${edge.line} ${edge.to ? '↑' : '↓'}` : 'IO'
  }
  const bytes = transaction.request.length ? transaction.request : transaction.response
  if (bytes.length === 0) return '—'
  const head = bytes.slice(0, 2).map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  return bytes.length > 2 ? `${head}…` : head
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
