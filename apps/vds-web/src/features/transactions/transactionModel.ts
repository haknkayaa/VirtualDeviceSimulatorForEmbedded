import type { Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'

export type TransactionStatus = 'running' | 'success' | 'error' | 'partial'
export type TransactionDirection = 'full_duplex' | 'tx' | 'rx'

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

  for (const event of events) {
    if (!event.device_id) continue
    const payload = event.payload
    if (
      payload.kind !== 'transaction_started' &&
      payload.kind !== 'transaction_completed'
    ) {
      continue
    }
    if (payload.transaction_id === null) continue
    const id = `${event.device_id}:${payload.transaction_id}`
    const current = transactions.get(id) ?? {
      id,
      transactionId: payload.transaction_id,
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

  return [...transactions.values()].sort((left, right) => {
    const leftTime = left.completedWallNs ?? left.startedWallNs ?? 0
    const rightTime = right.completedWallNs ?? right.startedWallNs ?? 0
    return rightTime - leftTime || right.transactionId - left.transactionId
  })
}
