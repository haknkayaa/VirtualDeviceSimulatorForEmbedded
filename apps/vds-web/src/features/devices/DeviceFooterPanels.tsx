import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Device } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatWallTime } from '../../utils/events'
import { formatHex, formatVirtualTime } from '../../utils/format'
import { buildLiveTransactions, transactionDirection, type LiveTransaction, type TransactionDirection, type TransactionStatus } from '../transactions/transactionModel'
import { readPreference, writePreference } from './deviceModel'

type TransactionFilter = 'all' | 'reads' | 'writes'

const MAX_ROWS = 200
const OPEN_PREFERENCE = 'vds4e.devices.transactionsOpen'

interface DeviceFooterPanelsProps {
  device: Device | undefined
  /** Device-scoped domain events in chronological order. */
  events: DomainEvent[]
  onSelectRegister: (address: number) => void
}

interface RecentTransaction {
  id: string
  source: 'bus' | 'register'
  context: string
  registerAddress?: number
  /** Register accesses carry one value, not wire bytes; render it as a register value. */
  registerValue?: string
  direction: TransactionDirection
  request: number[]
  response: number[]
  status: TransactionStatus
  errorCode?: string
  virtualTimeNs: number
  wallTimeNs: number
}

function transactionTime(transaction: RecentTransaction) {
  return transaction.wallTimeNs > 0 ? formatWallTime(transaction.wallTimeNs) : formatVirtualTime(transaction.virtualTimeNs)
}

function transactionBytes(values: number[]) {
  if (values.length === 0) return '—'
  const preview = values.slice(0, 8).map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' ')
  return values.length > 8 ? `${preview} …` : preview
}

function buildRegisterTransactions(events: DomainEvent[]): RecentTransaction[] {
  const transactions: RecentTransaction[] = []
  for (const event of events) {
    const payload = event.payload
    if (payload.kind !== 'register_read' && payload.kind !== 'register_write') continue
    const context = payload.name ?? formatHex(payload.address, 16)
    const read = payload.kind === 'register_read'
    const value = read ? payload.value : payload.new_value
    transactions.push({
      id: `register:${event.event_id}`,
      source: 'register',
      context,
      registerAddress: payload.address,
      registerValue: value === null ? '—' : formatHex(value),
      direction: read ? 'rx' : 'tx',
      request: !read && value !== null ? [value] : [],
      response: read && value !== null ? [value] : [],
      status: 'success',
      virtualTimeNs: event.timestamp_virtual_ns,
      wallTimeNs: event.timestamp_wall_ns,
    })
  }
  return transactions
}

function normalizeBusTransaction(transaction: LiveTransaction): RecentTransaction {
  return {
    id: transaction.id,
    source: 'bus',
    // Runtime-injected transactions (scenario steps) have no adapter transaction id.
    context: transaction.id.includes(':ev')
      ? `${transaction.busType.toUpperCase()} · injected`
      : `${transaction.busType.toUpperCase()} #${transaction.transactionId}`,
    direction: transactionDirection(transaction),
    request: transaction.request,
    response: transaction.response,
    status: transaction.status,
    errorCode: transaction.errorCode,
    virtualTimeNs: transaction.completedVirtualNs ?? transaction.startedVirtualNs ?? 0,
    wallTimeNs: transaction.completedWallNs ?? transaction.startedWallNs ?? 0,
  }
}

const directionLabel: Record<TransactionDirection, string> = { full_duplex: 'I/O', rx: 'Read', tx: 'Write' }
const directionClass: Record<TransactionDirection, string> = { full_duplex: 'transaction-duplex', rx: 'transaction-read', tx: 'transaction-write' }

const TransactionRow = memo(function TransactionRow({ transaction, onSelectRegister }: { transaction: RecentTransaction; onSelectRegister: (address: number) => void }) {
  const address = transaction.registerAddress
  return (
    <tr
      className={address !== undefined ? 'clickable' : undefined}
      onClick={address !== undefined ? () => onSelectRegister(address) : undefined}
      title={address !== undefined ? 'Select register' : undefined}
    >
      <td className="mono dim">{transactionTime(transaction)}</td>
      <td><span className={`dv-dir ${directionClass[transaction.direction]}`}>{directionLabel[transaction.direction]}</span></td>
      <td className="mono">{transaction.context}</td>
      <td className="mono dv-bytes" title={transaction.request.map((value) => formatHex(value)).join(' ')}>{transaction.registerValue && transaction.direction === 'tx' ? transaction.registerValue : transactionBytes(transaction.request)}</td>
      <td className="mono dv-bytes" title={transaction.response.map((value) => formatHex(value)).join(' ')}>{transaction.registerValue && transaction.direction === 'rx' ? transaction.registerValue : transactionBytes(transaction.response)}</td>
      <td className={`mono dv-result dv-result-${transaction.status}`}>
        {transaction.status === 'error' ? transaction.errorCode ?? 'error' : transaction.status === 'running' ? 'in flight' : transaction.status === 'partial' ? 'partial' : 'ok'}
      </td>
    </tr>
  )
})

/**
 * Collapsible bottom pane with the device's recent bus and register
 * transactions, derived from the live event stream.
 */
export function DeviceFooterPanels({ device, events, onSelectRegister }: DeviceFooterPanelsProps) {
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all')
  const [open, setOpen] = useState(() => readPreference(OPEN_PREFERENCE, true))
  const all = useMemo(
    () => [
      ...buildLiveTransactions(events, device ? [device] : []).map(normalizeBusTransaction),
      ...buildRegisterTransactions(events),
    ].sort((left, right) => right.wallTimeNs - left.wallTimeNs || right.virtualTimeNs - left.virtualTimeNs),
    [device, events],
  )
  const transactions = useMemo(
    () => all
      .filter((transaction) => {
        if (transactionFilter === 'reads') return transaction.direction !== 'tx'
        if (transactionFilter === 'writes') return transaction.direction !== 'rx'
        return true
      })
      .slice(0, MAX_ROWS),
    [all, transactionFilter],
  )
  const errors = useMemo(() => all.filter((transaction) => transaction.status === 'error').length, [all])

  const toggle = () => {
    setOpen((current) => {
      writePreference(OPEN_PREFERENCE, !current)
      return !current
    })
  }

  return (
    <section aria-label="Recent device transactions" className={`dv-bottom${open ? ' open' : ''}`}>
      <header className="dv-bottom-head">
        <button aria-expanded={open} aria-label={open ? 'Collapse recent transactions' : 'Expand recent transactions'} className="icon-button sm" onClick={toggle} type="button">
          {open ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
        </button>
        <h2 className="panel-title">Recent Transactions</h2>
        <span className="panel-meta">{all.length}{errors ? ` · ${errors} failed` : ''}</span>
        {open && (
          <div aria-label="Transaction filters" className="segmented" role="group">
            {(['all', 'reads', 'writes'] as const).map((filter) => (
              <button aria-pressed={transactionFilter === filter} key={filter} onClick={() => setTransactionFilter(filter)} type="button">
                {filter[0].toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        )}
        <Link className="button button-ghost button-sm dv-bottom-link" to="/transactions">Transactions <ArrowRight aria-hidden="true" size={12} /></Link>
      </header>
      {open && (
        <div className="dv-bottom-body">
          {transactions.length === 0
            ? <p className="dv-bottom-empty">Transactions for this device appear here from the live event stream.</p>
            : (
              <table className="data-table">
                <thead><tr><th>Time</th><th>Dir</th><th>Context</th><th>TX</th><th>RX</th><th>Result</th></tr></thead>
                <tbody>
                  {transactions.map((transaction) => <TransactionRow key={transaction.id} onSelectRegister={onSelectRegister} transaction={transaction} />)}
                </tbody>
              </table>
            )}
        </div>
      )}
    </section>
  )
}
