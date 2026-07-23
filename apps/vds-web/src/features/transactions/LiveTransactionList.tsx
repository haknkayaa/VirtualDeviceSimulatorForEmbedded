import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, LoaderCircle } from 'lucide-react'

import {
  transactionDirection,
  type LiveTransaction,
  type TransactionDirection,
} from './transactionModel'

interface LiveTransactionTableProps {
  transactions: LiveTransaction[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function timestamp(transaction: LiveTransaction) {
  const nanoseconds = transaction.completedWallNs ?? transaction.startedWallNs
  if (nanoseconds === undefined) return '—'
  return new Date(nanoseconds / 1_000_000).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function DirectionIcon({ direction }: { direction: TransactionDirection }) {
  if (direction === 'tx') return <ArrowUpRight size={11} />
  if (direction === 'rx') return <ArrowDownLeft size={11} />
  return <ArrowLeftRight size={11} />
}

export function LiveTransactionTable({
  transactions,
  selectedId,
  onSelect,
}: LiveTransactionTableProps) {
  return (
    <div className="live-transaction-table" role="table">
      <div className="live-transaction-table-head" role="row">
        <span role="columnheader">Time</span>
        <span role="columnheader">Bus</span>
        <span role="columnheader">Device</span>
        <span role="columnheader">Summary</span>
        <span role="columnheader">Status</span>
      </div>
      <div className="live-transaction-table-body">
        {transactions.map((transaction) => {
          const direction = transactionDirection(transaction)
          return (
            <button
              className={selectedId === transaction.id ? 'active' : ''}
              key={transaction.id}
              onClick={() => onSelect(transaction.id)}
              role="row"
              type="button"
            >
              <time role="cell">{timestamp(transaction)}</time>
              <span role="cell"><i className={`transaction-bus-badge bus-${transaction.busType.toLowerCase()}`}>{transaction.busType}</i></span>
              <strong role="cell">{transaction.deviceId}</strong>
              <span className="transaction-table-summary" role="cell">
                <DirectionIcon direction={direction} />
                TX {transaction.request.length} · RX {transaction.response.length}
              </span>
              <span role="cell">
                <i className={`transaction-status-badge status-${transaction.status}`}>
                  {transaction.status === 'running' && <LoaderCircle className="spin" size={11} />}
                  {transaction.errorCode ?? transaction.status}
                </i>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
