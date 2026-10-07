import { useMemo } from 'react'

import { useDevices } from '../api/queries'
import { buildLiveTransactions, type LiveTransaction } from '../features/transactions/transactionModel'
import { useEventStore } from '../stores/eventStore'

/** Paired transactions for the retained session, newest first. */
export function useSessionTransactions() {
  const events = useEventStore((state) => state.events)
  const devices = useDevices().data
  return useMemo(() => buildLiveTransactions(events, devices ?? []), [devices, events])
}

/** Wall-clock duration of a completed transaction in microseconds. */
export function transactionWallDurationUs(transaction: LiveTransaction) {
  if (transaction.startedWallNs === undefined || transaction.completedWallNs === undefined) return undefined
  return (transaction.completedWallNs - transaction.startedWallNs) / 1_000
}

export function percentile(values: number[], fraction: number) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]
}
