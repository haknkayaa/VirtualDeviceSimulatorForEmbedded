import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

import { BusTag } from '../../components/BusTag'
import { formatWallTime } from '../../utils/events'
import {
  directionLabel,
  formatDuration,
  transactionDirection,
  transactionDurationNs,
  transactionResultLabel,
  transactionWallTime,
  transactionWire,
  type LiveTransaction,
} from './transactionModel'
import { observeRectWithFallback } from './virtualRows'

const ROW_HEIGHT = 24

interface TransactionTableProps {
  transactions: LiveTransaction[]
  selectedId: string | undefined
  /** Scroll the selected row into view when this id changes (deep links, keyboard). */
  revealId: string | null
  onSelect: (id: string) => void
}

/** Dense, virtualised capture table: one 24px row per paired transaction. */
export function TransactionTable({ transactions, selectedId, revealId, onSelect }: TransactionTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // TanStack Virtual intentionally returns an imperative instance; React
  // Compiler must not memoize this hook result.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    observeElementRect: observeRectWithFallback,
  })

  const revealedRef = useRef<string | null>(null)
  const revealIndex = revealId ? transactions.findIndex((transaction) => transaction.id === revealId) : -1
  useEffect(() => {
    if (!revealId || revealIndex < 0 || revealedRef.current === revealId) return
    revealedRef.current = revealId
    virtualizer.scrollToIndex(revealIndex, { align: 'auto' })
  }, [revealId, revealIndex, virtualizer])

  const selectedIndex = selectedId ? transactions.findIndex((transaction) => transaction.id === selectedId) : -1

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = Math.min(transactions.length - 1, Math.max(0, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)))
    const transaction = transactions[next]
    if (!transaction) return
    onSelect(transaction.id)
    virtualizer.scrollToIndex(next, { align: 'auto' })
  }

  const items = virtualizer.getVirtualItems()
  const paddingTop = items[0]?.start ?? 0
  const paddingBottom = items.length ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) : 0

  return (
    <div
      aria-label="Captured transactions. Use arrow keys to move the selection."
      className="txa-table-scroll"
      onKeyDown={handleKeyDown}
      ref={scrollRef}
      tabIndex={0}
    >
      <table className="data-table txa-table">
        <colgroup>
          <col className="txa-col-id" />
          <col className="txa-col-time" />
          <col className="txa-col-bus" />
          <col className="txa-col-device" />
          <col className="txa-col-dir" />
          <col />
          <col className="txa-col-bytes" />
          <col className="txa-col-bytes" />
          <col className="txa-col-dur" />
          <col className="txa-col-result" />
        </colgroup>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Time</th>
            <th>Bus</th>
            <th>Device</th>
            <th>Dir</th>
            <th>Wire (hex)</th>
            <th className="num">TX</th>
            <th className="num">RX</th>
            <th className="num">Dur</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && <tr aria-hidden="true" className="txa-spacer"><td colSpan={10} style={{ height: paddingTop }} /></tr>}
          {items.map((item) => {
            const transaction = transactions[item.index]
            const wallNs = transactionWallTime(transaction)
            const selected = transaction.id === selectedId
            const gpio = transaction.busType.toLowerCase() === 'gpio'
            return (
              <tr
                aria-selected={selected}
                className={`clickable txa-row txa-row-${transaction.status}`}
                key={transaction.id}
                onClick={() => onSelect(transaction.id)}
              >
                <td className="num dim">{transaction.transactionId}</td>
                <td className="mono dim">{wallNs ? formatWallTime(wallNs) : '—'}</td>
                <td><BusTag bus={transaction.busType} /></td>
                <td className="txa-device" title={transaction.deviceId}>{transaction.deviceId}</td>
                <td className="mono txa-dir">{gpio ? 'EDGE' : directionLabel[transactionDirection(transaction)]}</td>
                <td className="mono txa-wire" title={transactionWire(transaction, 64)}>{transactionWire(transaction)}</td>
                <td className="num">{transaction.request.length}</td>
                <td className="num">{transaction.response.length}</td>
                <td className="num dim">{formatDuration(transactionDurationNs(transaction))}</td>
                <td title={transactionResultLabel(transaction)}><span className={`txa-result ${transaction.status}`}>{transactionResultLabel(transaction)}</span></td>
              </tr>
            )
          })}
          {paddingBottom > 0 && <tr aria-hidden="true" className="txa-spacer"><td colSpan={10} style={{ height: paddingBottom }} /></tr>}
        </tbody>
      </table>
    </div>
  )
}
