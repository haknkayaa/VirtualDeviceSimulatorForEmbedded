import { AudioWaveform, FileSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { formatWallTime } from '../../utils/events'
import { formatVirtualTime } from '../../utils/format'
import { BusSignalScope } from './BusSignalScope'
import { supportsSignalScope } from './signalScopeSupport'
import { TransactionHexViewer } from './TransactionHexViewer'
import {
  formatDuration,
  transactionDirection,
  transactionDurationNs,
  type LiveTransaction,
} from './transactionModel'

const directionText = { full_duplex: 'Full duplex', tx: 'Write (TX only)', rx: 'Read (RX only)' } as const

function gpioDirection(transaction: LiveTransaction) {
  const edges = transaction.gpioEdges ?? []
  const rising = edges.some((edge) => edge.from === 0 && edge.to === 1)
  const falling = edges.some((edge) => edge.from === 1 && edge.to === 0)
  return rising && falling ? 'Mixed' : rising ? 'Rising' : falling ? 'Falling' : '—'
}

function DecodedFields({ transaction, gpioControllerIndex }: { transaction: LiveTransaction; gpioControllerIndex?: number }) {
  const gpio = transaction.busType.toLowerCase() === 'gpio'
  const virtualStart = transaction.startedVirtualNs
  const virtualEnd = transaction.completedVirtualNs
  return (
    <div className="txa-decode">
      <dl className="kv-grid txa-fields">
        <div><dt>Transaction</dt><dd className="mono">{transaction.id}</dd></div>
        <div><dt>Operation</dt><dd>{gpio ? `Edge · ${gpioDirection(transaction)}` : directionText[transactionDirection(transaction)]}</dd></div>
        {!gpio && <div><dt>Bytes</dt><dd className="mono">TX {transaction.request.length} · RX {transaction.response.length}</dd></div>}
        <div><dt>Started</dt><dd className="mono">{transaction.startedWallNs ? formatWallTime(transaction.startedWallNs) : '—'}{virtualStart !== undefined && <span className="dim"> · v {formatVirtualTime(virtualStart)}</span>}</dd></div>
        <div><dt>Completed</dt><dd className="mono">{transaction.completedWallNs ? formatWallTime(transaction.completedWallNs) : '—'}{virtualEnd !== undefined && <span className="dim"> · v {formatVirtualTime(virtualEnd)}</span>}</dd></div>
        <div><dt>Duration</dt><dd className="mono">{formatDuration(transactionDurationNs(transaction))}</dd></div>
        <div><dt>Result</dt><dd className={`mono${transaction.status === 'error' ? ' text-err' : ''}`}>{transaction.status === 'error' ? transaction.errorCode ?? 'error' : transaction.status}</dd></div>
      </dl>
      {gpio
        ? (
          <div className="txa-edges" aria-label="GPIO edge changes" role="list">
            <div className="txa-edges-head"><span>Line</span><span>From</span><span>To</span><span>Edge</span></div>
            {(transaction.gpioEdges ?? []).map((edge) => {
              const rising = edge.from === 0 && edge.to === 1
              return (
                <div className="txa-edge" key={edge.line} role="listitem">
                  <code>{`GPIO${gpioControllerIndex ?? 0}_IO${edge.line}`}</code>
                  <span className={edge.from ? 'high' : 'low'}>{edge.from ? 'HIGH' : 'LOW'}</span>
                  <span className={edge.to ? 'high' : 'low'}>{edge.to ? 'HIGH' : 'LOW'}</span>
                  <span className="txa-edge-kind">{rising ? '↑ rising' : '↓ falling'}</span>
                </div>
              )
            })}
          </div>
        )
        : <TransactionHexViewer request={transaction.request} response={transaction.response} />}
    </div>
  )
}

interface TransactionDetailProps {
  transaction?: LiveTransaction
  /** A locked selection that is not in the current capture/filter. */
  missingId: string | null
  gpioControllerIndex?: number
  onFollowLive: () => void
}

/** Selected transaction: electrical scope on the left, decoded fields + hex dump on the right. */
export function TransactionDetail({ transaction, missingId, gpioControllerIndex, onFollowLive }: TransactionDetailProps) {
  return (
    <Panel
      actions={transaction && (
        <>
          <StatusBadge status={transaction.status === 'running' ? 'running' : transaction.status === 'success' ? 'ok' : transaction.status === 'error' ? 'error' : 'partial'} />
          <Link
            className="button button-ghost button-sm"
            title="Open this transaction in the Logic Analyzer"
            to={`/waveform?transaction=${encodeURIComponent(transaction.id)}&bus=${encodeURIComponent(transaction.busType.toLowerCase())}&device=${encodeURIComponent(transaction.deviceId)}`}
          >
            <AudioWaveform aria-hidden="true" size={12} /> Logic Analyzer
          </Link>
        </>
      )}
      className="txa-detail"
      flush
      icon={FileSearch}
      meta={transaction ? `${transaction.deviceId} · #${transaction.transactionId}` : undefined}
      title={transaction ? <>Transaction <BusTag bus={transaction.busType} /></> : 'Transaction'}
    >
      {!transaction && missingId && (
        <div className="txa-detail-empty">
          <AsyncState
            detail="It may have been cleared, filtered out, or aged out of the retained event window."
            kind="empty"
            title={`Transaction ${missingId} is not in the current capture`}
          />
          <button className="button button-sm" onClick={onFollowLive} type="button">Follow live tail</button>
        </div>
      )}
      {!transaction && !missingId && <AsyncState centered detail="Select a row to inspect its signals and bytes." kind="empty" title="No transaction selected" />}
      {transaction && (
        <div className="txa-detail-grid">
          <div className="txa-scope-pane">
            {supportsSignalScope(transaction.busType)
              ? <BusSignalScope gpioControllerIndex={gpioControllerIndex} transaction={transaction} />
              : <AsyncState detail="The payload is available in the hex dump." kind="empty" title={`No electrical timing scope for ${transaction.busType.toUpperCase()}`} />}
          </div>
          <DecodedFields gpioControllerIndex={gpioControllerIndex} transaction={transaction} />
        </div>
      )}
    </Panel>
  )
}
