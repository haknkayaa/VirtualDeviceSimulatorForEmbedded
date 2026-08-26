import { CheckCircle2, RadioTower, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { GlassPanel } from '../../components/GlassPanel'
import type { Device, DeviceRegister } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatHex, formatVirtualTime } from '../../utils/format'
import { buildLiveTransactions, transactionDirection, type LiveTransaction, type TransactionDirection, type TransactionStatus } from '../transactions/transactionModel'

type TransactionFilter = 'all' | 'reads' | 'writes'

interface DeviceFooterPanelsProps {
  currentState: string | null
  device: Device | undefined
  events: DomainEvent[]
  isRefreshing: boolean
  onRefreshRegisters: () => void
  onSelectRegister: (address: number) => void
  registers: DeviceRegister[]
  selectedRegister: DeviceRegister | undefined
}

interface RecentTransaction {
  id: string
  context: string
  direction: TransactionDirection
  request: number[]
  response: number[]
  status: TransactionStatus
  virtualTimeNs: number
  wallTimeNs: number
}

function transactionTime(transaction: RecentTransaction) {
  const wallTimeNs = transaction.wallTimeNs
  if (wallTimeNs > 0) {
    return new Date(wallTimeNs / 1_000_000).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }
  return formatVirtualTime(transaction.virtualTimeNs)
}

function transactionBytes(values: number[]) {
  if (values.length === 0) return '—'
  const preview = values.slice(0, 3).map((value) => formatHex(value)).join(' ')
  return values.length > 3 ? `${preview}…` : preview
}

function buildRegisterTransactions(events: DomainEvent[], device: Device | undefined): RecentTransaction[] {
  const transactions: RecentTransaction[] = []
  for (const event of events) {
    if (event.payload.kind !== 'register_read' && event.payload.kind !== 'register_write') continue
    if (event.payload.kind === 'register_read') {
      transactions.push({
        id: `register:${event.event_id}`,
        context: `${device?.name ?? device?.id ?? 'Device'} · ${formatHex(event.payload.address, 16)}`,
        direction: 'rx',
        request: [],
        response: event.payload.value === null ? [] : [event.payload.value],
        status: 'success',
        virtualTimeNs: event.timestamp_virtual_ns,
        wallTimeNs: event.timestamp_wall_ns,
      })
      continue
    }
    transactions.push({
      id: `register:${event.event_id}`,
      context: `${device?.name ?? device?.id ?? 'Device'} · ${formatHex(event.payload.address, 16)}`,
      direction: 'tx',
      request: event.payload.new_value === null ? [] : [event.payload.new_value],
      response: [],
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
    context: `${transaction.busType.toUpperCase()} #${transaction.transactionId}`,
    direction: transactionDirection(transaction),
    request: transaction.request,
    response: transaction.response,
    status: transaction.status,
    virtualTimeNs: transaction.completedVirtualNs ?? transaction.startedVirtualNs ?? 0,
    wallTimeNs: transaction.completedWallNs ?? transaction.startedWallNs ?? 0,
  }
}

function buildScenarioTransactions(events: DomainEvent[], device: Device | undefined): RecentTransaction[] {
  const pending = new Map<string, DomainEvent & { payload: Extract<DomainEvent['payload'], { kind: 'transaction_started' }> }>()
  const transactions: RecentTransaction[] = []

  for (const event of events) {
    if (
      !event.scenario_run_id ||
      (event.payload.kind !== 'transaction_started' && event.payload.kind !== 'transaction_completed') ||
      event.payload.transaction_id !== null
    ) continue
    const key = `${event.scenario_run_id}:${event.device_id ?? ''}`
    if (event.payload.kind === 'transaction_started') {
      pending.set(key, event as DomainEvent & { payload: Extract<DomainEvent['payload'], { kind: 'transaction_started' }> })
      continue
    }
    if (event.payload.kind !== 'transaction_completed') continue
    const started = pending.get(key)
    if (!started) continue
    pending.delete(key)
    const request = started.payload.request
    const response = event.payload.response
    const direction = transactionDirection({ request, response } as LiveTransaction)
    transactions.push({
      id: `scenario:${event.scenario_run_id}:${started.event_id}`,
      context: `${device?.bus?.toUpperCase() ?? 'DEVICE'} · scenario`,
      direction,
      request,
      response,
      status: event.payload.result === 'success' ? 'success' : 'error',
      virtualTimeNs: event.timestamp_virtual_ns,
      wallTimeNs: event.timestamp_wall_ns,
    })
  }

  return transactions
}

export function DeviceFooterPanels({
  currentState,
  device,
  events,
  isRefreshing,
  onRefreshRegisters,
  onSelectRegister,
  registers,
  selectedRegister,
}: DeviceFooterPanelsProps) {
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all')
  const [draftValue, setDraftValue] = useState(() =>
    selectedRegister ? formatHex(selectedRegister.value, selectedRegister.width_bits) : '',
  )
  const transactions = useMemo(
    () => {
      const chronologicalEvents = [...events].reverse()
      return [
        ...buildLiveTransactions(chronologicalEvents, device ? [device] : []).map(normalizeBusTransaction),
        ...buildScenarioTransactions(chronologicalEvents, device),
        ...buildRegisterTransactions(chronologicalEvents, device),
      ]
      .sort((left, right) => right.wallTimeNs - left.wallTimeNs || right.virtualTimeNs - left.virtualTimeNs)
      .filter((transaction) => {
        if (transactionFilter === 'reads') return transaction.direction !== 'tx'
        if (transactionFilter === 'writes') return transaction.direction !== 'rx'
        return true
      })
      .slice(0, 4)
    },
    [device, events, transactionFilter],
  )
  const metadataCoverage = registers.length === 0
    ? 0
    : Math.round(
        (registers.filter((register) => register.reset_value !== undefined && Boolean(register.description)).length
          / registers.length)
          * 100,
      )

  return (
    <section aria-label="Device register tools" className="device-footer-grid">
      <GlassPanel
        action={(
          <div aria-label="Transaction filters" className="footer-card-tabs" role="group">
            {(['all', 'reads', 'writes'] as const).map((filter) => (
              <button
                aria-pressed={transactionFilter === filter}
                className={transactionFilter === filter ? 'active' : ''}
                key={filter}
                onClick={() => setTransactionFilter(filter)}
                type="button"
              >
                {filter[0].toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        )}
        className="device-footer-card recent-transactions-card"
        title="Recent Transactions"
      >
        {transactions.length === 0 ? (
          <div className="footer-card-empty">Device transactions will appear here from the live event stream.</div>
        ) : (
          <div className="recent-transaction-list">
            {transactions.map((transaction) => {
              const direction = transaction.direction
              const directionLabel = direction === 'full_duplex' ? 'I/O' : direction === 'rx' ? 'Read' : 'Write'
              return (
                <div className="recent-transaction-row" key={transaction.id}>
                  <time>{transactionTime(transaction)}</time>
                  <span className={direction === 'rx' ? 'transaction-read' : direction === 'tx' ? 'transaction-write' : 'transaction-duplex'}>
                    <i /> {directionLabel}
                  </span>
                  <code
                    className="transaction-summary"
                    title={`${transaction.context} · TX: ${transaction.request.map((value) => formatHex(value)).join(' ')} · RX: ${transaction.response.map((value) => formatHex(value)).join(' ')}`}
                  >
                    {transactionBytes(transaction.request)} → {transactionBytes(transaction.response)}
                  </code>
                  <strong className={transaction.status === 'error' ? 'transaction-status-error' : ''}><i /> {transaction.status === 'running' ? 'Live' : transaction.status === 'partial' ? 'Partial' : transaction.status === 'error' ? 'Error' : 'OK'}</strong>
                </div>
              )
            })}
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="device-footer-card value-controls-card" title="Value Controls">
        <div className="value-control-fields">
          <label>
            <span>Address</span>
            <select
              aria-label="Value control register"
              disabled={registers.length === 0}
              onChange={(event) => onSelectRegister(Number(event.target.value))}
              value={selectedRegister?.address ?? ''}
            >
              {registers.map((register) => (
                <option key={register.address} value={register.address}>
                  {formatHex(register.address, 16)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Value (Hex)</span>
            <input
              aria-label="Register value draft"
              disabled={!selectedRegister}
              onChange={(event) => setDraftValue(event.target.value)}
              value={draftValue}
            />
          </label>
          <div className="value-width">
            <span>Data Width</span>
            <div>
              {[8, 16, 32].map((width) => (
                <button
                  aria-pressed={selectedRegister?.width_bits === width}
                  disabled
                  key={width}
                  type="button"
                >
                  {width}-bit
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="value-control-actions">
          <button className="button button-secondary" disabled={!selectedRegister || isRefreshing} onClick={onRefreshRegisters} type="button">
            <RefreshCw aria-hidden="true" className={isRefreshing ? 'spin' : ''} size={13} /> Read
          </button>
          <button className="button button-secondary" disabled title="Register writes are not exposed by the Control API." type="button">
            Write
          </button>
          <button className="button button-secondary" disabled title="Register writes are not exposed by the Control API." type="button">
            Write &amp; Verify
          </button>
        </div>
      </GlassPanel>

      <GlassPanel className="device-footer-card validation-state-card" title="Validation & State">
        <dl className="footer-detail-list">
          <div><dt>Register Map CRC</dt><dd>Not exposed</dd></div>
          <div><dt>Last Verified</dt><dd>{registers.length > 0 ? 'Live snapshot' : '—'}</dd></div>
          <div><dt>Mismatches</dt><dd>Not evaluated</dd></div>
        </dl>
        <div className="coverage-row">
          <span>Metadata coverage</span>
          <div><i style={{ width: `${metadataCoverage}%` }} /></div>
          <strong>{metadataCoverage}%</strong>
        </div>
        <div className="validation-state">
          <span>State</span>
          <strong><ShieldCheck aria-hidden="true" size={14} /> {currentState ?? 'Unknown'}</strong>
          {currentState && <CheckCircle2 aria-label="State snapshot available" size={15} />}
        </div>
      </GlassPanel>

      <GlassPanel className="device-footer-card device-information-card" title="Device Information">
        <dl className="footer-detail-list">
          <div><dt>Type</dt><dd>{device?.type ?? 'Not reported'}</dd></div>
          <div><dt>Model</dt><dd>{device?.model ?? 'Not reported'}</dd></div>
          <div><dt>Version</dt><dd>{device?.version ?? 'Not reported'}</dd></div>
          <div><dt>Interface</dt><dd>{device?.bus?.toUpperCase() ?? 'Not reported'}</dd></div>
          <div><dt>Registers</dt><dd>{registers.length}</dd></div>
          <div><dt>Telemetry</dt><dd className="telemetry-value"><RadioTower aria-hidden="true" size={12} /> Live events</dd></div>
        </dl>
      </GlassPanel>
    </section>
  )
}
