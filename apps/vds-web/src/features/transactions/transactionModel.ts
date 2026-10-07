import type { Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'

export type TransactionStatus = 'running' | 'success' | 'error' | 'partial'
export type TransactionDirection = 'full_duplex' | 'tx' | 'rx'

export interface GpioEdgeChange {
  line: number
  from: 0 | 1
  to: 0 | 1
}

export interface LiveTransaction {
  id: string
  transactionId: number
  deviceId: string
  busType: string
  startedWallNs?: number
  completedWallNs?: number
  startedVirtualNs?: number
  completedVirtualNs?: number
  request: number[]
  response: number[]
  gpioOutputLines?: boolean[]
  gpioEdges?: GpioEdgeChange[]
  status: TransactionStatus
  errorCode?: string
}

export function transactionDirection(transaction: LiveTransaction): TransactionDirection {
  if (transaction.response.length === 0) return 'tx'
  if (
    transaction.request.length > 0 &&
    transaction.request.every((byte) => byte === 0)
  ) {
    return 'rx'
  }
  return 'full_duplex'
}

export function buildLiveTransactions(
  events: DomainEvent[],
  devices: Device[],
): LiveTransaction[] {
  const buses = new Map(devices.map((device) => [device.id, device.bus]))
  const transactions = new Map<string, LiveTransaction>()
  // Transactions injected by the runtime itself (e.g. scenario steps) carry no
  // adapter transaction id; they are strictly sequential per device, so a
  // completion closes the most recent open start on the same device.
  const openUnnumbered = new Map<string, { id: string; transactionId: number }>()

  for (const event of events) {
    if (!event.device_id) continue
    const payload = event.payload
    if (
      payload.kind !== 'transaction_started' &&
      payload.kind !== 'transaction_completed'
    ) {
      continue
    }
    let key: { id: string; transactionId: number } | undefined
    if (payload.transaction_id !== null) {
      key = { id: `${event.device_id}:${payload.transaction_id}`, transactionId: payload.transaction_id }
    } else if (payload.kind === 'transaction_started') {
      key = { id: `${event.device_id}:ev${event.event_id}`, transactionId: event.event_id }
      openUnnumbered.set(event.device_id, key)
    } else {
      key = openUnnumbered.get(event.device_id)
      openUnnumbered.delete(event.device_id)
    }
    if (!key) continue
    const { id } = key
    const current = transactions.get(id) ?? {
      id,
      transactionId: key.transactionId,
      deviceId: event.device_id,
      busType: buses.get(event.device_id) ?? 'unknown',
      request: [],
      response: [],
      status: 'partial' as const,
    }
    if (payload.kind === 'transaction_started') {
      current.request = payload.request
      current.gpioOutputLines = payload.gpio_output_lines ?? undefined
      current.startedWallNs = event.timestamp_wall_ns
      current.startedVirtualNs = event.timestamp_virtual_ns
      current.status = 'running'
    } else {
      current.response = payload.response
      current.completedWallNs = event.timestamp_wall_ns
      current.completedVirtualNs = event.timestamp_virtual_ns
      current.errorCode = payload.error_code ?? undefined
      current.status = payload.result === 'success' ? 'success' : 'error'
    }
    transactions.set(id, current)
  }

  const chronological = [...transactions.values()].sort((left, right) => {
    const leftTime = left.completedWallNs ?? left.startedWallNs ?? 0
    const rightTime = right.completedWallNs ?? right.startedWallNs ?? 0
    return leftTime - rightTime || left.transactionId - right.transactionId
  })
  const previousGpioValues = new Map<string, number[]>()
  const annotated = chronological.map((transaction) => {
    if (
      transaction.busType.toLowerCase() !== 'gpio' ||
      transaction.status !== 'success' ||
      transaction.response.length === 0
    ) {
      return transaction
    }

    const previous = previousGpioValues.get(transaction.deviceId)
    previousGpioValues.set(transaction.deviceId, [...transaction.response])
    if (!previous || previous.length !== transaction.response.length) {
      return { ...transaction, gpioEdges: [] }
    }

    const gpioEdges = transaction.response.flatMap<GpioEdgeChange>((value, line) => {
      const from = previous[line] === 0 ? 0 : 1
      const to = value === 0 ? 0 : 1
      return from === to ? [] : [{ line, from, to }]
    })
    return { ...transaction, gpioEdges }
  })

  return annotated.sort((left, right) => {
    const leftTime = left.completedWallNs ?? left.startedWallNs ?? 0
    const rightTime = right.completedWallNs ?? right.startedWallNs ?? 0
    return rightTime - leftTime || right.transactionId - left.transactionId
  })
}

function hexBytes(bytes: number[], limit: number) {
  const shown = bytes
    .slice(0, limit)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
  return bytes.length > limit ? `${shown} …` : shown
}

/** Compact on-the-wire summary: request bytes, then response bytes, in hex. */
export function transactionWire(transaction: LiveTransaction, limit = 8) {
  if (transaction.busType.toLowerCase() === 'gpio') {
    const edges = transaction.gpioEdges ?? []
    const first = edges[0]
    if (!first) return 'no edge'
    const label = `IO${first.line} ${first.from ? 'H' : 'L'}→${first.to ? 'H' : 'L'}`
    return edges.length === 1 ? label : `${label} +${edges.length - 1}`
  }
  const request = transaction.request.length ? hexBytes(transaction.request, limit) : '—'
  return transaction.response.length
    ? `${request} ⇄ ${hexBytes(transaction.response, limit)}`
    : request
}

/** Wall-clock duration between transaction_started and transaction_completed. */
export function transactionDurationNs(transaction: LiveTransaction) {
  if (transaction.startedWallNs === undefined || transaction.completedWallNs === undefined) return undefined
  return Math.max(0, transaction.completedWallNs - transaction.startedWallNs)
}

export function transactionResultLabel(transaction: LiveTransaction) {
  if (transaction.status === 'error') return transaction.errorCode ?? 'error'
  if (transaction.status === 'running') return 'in flight'
  if (transaction.status === 'partial') return 'partial'
  return 'ok'
}

export function transactionWallTime(transaction: LiveTransaction) {
  return transaction.completedWallNs ?? transaction.startedWallNs
}

export const directionLabel: Record<TransactionDirection, string> = {
  full_duplex: 'FDX',
  tx: 'TX',
  rx: 'RX',
}

/** Short human duration for nanosecond spans (µs/ms resolution). */
export function formatDuration(nanoseconds: number | undefined) {
  if (nanoseconds === undefined) return '—'
  if (nanoseconds >= 1_000_000_000) return `${(nanoseconds / 1_000_000_000).toFixed(2)} s`
  if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(2)} ms`
  if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(1)} µs`
  return `${nanoseconds} ns`
}
