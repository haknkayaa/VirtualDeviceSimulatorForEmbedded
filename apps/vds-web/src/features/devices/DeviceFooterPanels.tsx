import { CheckCircle2, RadioTower, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { GlassPanel } from '../../components/GlassPanel'
import type { Device, DeviceRegister } from '../../types/api'
import type { DomainEvent } from '../../types/events'
import { formatHex, formatVirtualTime } from '../../utils/format'

type TransactionFilter = 'all' | 'reads' | 'writes'

interface DeviceFooterPanelsProps {
  currentState: string | null
  device: Device | undefined
  events: DomainEvent[]
  isRefreshing: boolean
  liveRead: boolean
  onLiveReadChange: (enabled: boolean) => void
  onRefreshRegisters: () => void
  onSelectRegister: (address: number) => void
  registers: DeviceRegister[]
  selectedRegister: DeviceRegister | undefined
}

function eventTime(event: DomainEvent) {
  if (event.timestamp_wall_ns > 0) {
    return new Date(event.timestamp_wall_ns / 1_000_000).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }
  return formatVirtualTime(event.timestamp_virtual_ns)
}

function transactionValue(event: DomainEvent) {
  if (event.payload.kind === 'register_read') return event.payload.value
  if (event.payload.kind === 'register_write') return event.payload.new_value
  return null
}

export function DeviceFooterPanels({
  currentState,
  device,
  events,
  isRefreshing,
  liveRead,
  onLiveReadChange,
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
    () =>
      events
        .filter((event) => {
          if (event.payload.kind !== 'register_read' && event.payload.kind !== 'register_write') return false
          if (transactionFilter === 'reads') return event.payload.kind === 'register_read'
          if (transactionFilter === 'writes') return event.payload.kind === 'register_write'
          return true
        })
        .slice(0, 4),
    [events, transactionFilter],
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
          <div className="footer-card-empty">Register transactions will appear here from the live event stream.</div>
        ) : (
          <div className="recent-transaction-list">
            {transactions.map((event) => {
              const isRead = event.payload.kind === 'register_read'
              const address = 'address' in event.payload ? event.payload.address : 0
              const value = transactionValue(event)
              return (
                <div className="recent-transaction-row" key={event.event_id}>
                  <time>{eventTime(event)}</time>
                  <span className={isRead ? 'transaction-read' : 'transaction-write'}>
                    <i /> {isRead ? 'Read' : 'Write'}
                  </span>
                  <code>{formatHex(address, 16)}</code>
                  <code>{value === null ? '—' : formatHex(value)}</code>
                  <span className="transaction-source">{device?.name ?? device?.id ?? 'Device'}</span>
                  <strong><i /> OK</strong>
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
        <div className="value-control-footer">
          <label>
            <input
              checked={liveRead}
              disabled={!device}
              onChange={(event) => onLiveReadChange(event.target.checked)}
              type="checkbox"
            />
            Auto Refresh
          </label>
          <span>1,000 ms</span>
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
