import { ArrowLeftRight, Clock3, ListChecks, Timer, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'

import { useAdapters, useClock, useHealth } from '../api/queries'
import { percentile, transactionWallDurationUs, useSessionTransactions } from '../hooks/useSessionTransactions'
import { useNow } from '../hooks/useNow'
import { useEventStore } from '../stores/eventStore'
import type { LiveTransaction } from '../features/transactions/transactionModel'
import { formatVirtualTime } from '../utils/format'

const RATE_WINDOW_MS = 10_000
const RATE_BINS = 40

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
      <circle cx="6" cy="6" fill="none" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.2 8.4 12.4 22.5 16.8 9.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="17.6" cy="7" fill="var(--bus-uart)" r="2.6" />
      <path d="M20.2 7h3.2a6.6 6.6 0 0 1 0 13.2h-4" fill="none" stroke="var(--accent-text)" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="21.4" cy="15" fill="none" r="2" stroke="var(--bus-gpio)" strokeWidth="1.8" />
      <circle cx="13.6" cy="25.6" fill="var(--accent-text)" r="2.6" />
    </svg>
  )
}

function Kpi({ icon: Icon, label, hint, children, tone }: {
  icon: typeof Clock3
  label: string
  hint?: string
  tone?: 'warn' | 'err'
  children: React.ReactNode
}) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <Icon aria-hidden="true" className="kpi-icon" size={22} strokeWidth={1.6} />
      <div className="kpi-text">
        <span className="kpi-label">{label}{hint && <small>{hint}</small>}</span>
        <span className="kpi-value">{children}</span>
      </div>
    </div>
  )
}

function ServerKpi() {
  const health = useHealth()
  const status = useEventStore((state) => state.connectionStatus)
  const connected = !health.isError && health.data?.status === 'ok'
  const tone = health.isError ? 'err' : connected ? (status === 'connected' ? 'ok' : 'warn') : 'warn'
  const label = health.isError ? 'Server unreachable' : connected ? 'Server connected' : 'Connecting to server'
  return (
    <div className="kpi kpi-server">
      <i aria-hidden="true" className={`kpi-dot ${tone}`} />
      <div className="kpi-text">
        <span className="kpi-title">{label}</span>
        <span className="kpi-sub">{window.location.host}</span>
      </div>
    </div>
  )
}

function AdaptersKpi() {
  const adapters = useAdapters()
  const used = (adapters.data ?? []).filter((adapter) => adapter.bindings.length > 0)
  const loaded = used.filter((adapter) => adapter.state === 'loaded').length
  const ready = used.length > 0 && loaded === used.length
  return (
    <Kpi icon={ListChecks} label="Adapters" tone={used.length > 0 && !ready ? 'warn' : undefined}>
      {adapters.data ? <>{loaded} / {used.length} <small>{ready ? 'ready' : 'loaded'}</small></> : '—'}
    </Kpi>
  )
}

function VirtualTimeKpi() {
  const clock = useClock()
  return (
    <Kpi icon={Clock3} label="Virtual time">
      {clock.data ? formatVirtualTime(clock.data.virtual_time_ns) : '—'}
    </Kpi>
  )
}

function rateBins(transactions: LiveTransaction[], now: number) {
  const bins = new Array<number>(RATE_BINS).fill(0)
  const start = now - RATE_WINDOW_MS
  for (const transaction of transactions) {
    const wallMs = (transaction.completedWallNs ?? transaction.startedWallNs ?? 0) / 1_000_000
    if (wallMs < start) break
    if (wallMs > now) continue
    const index = Math.min(RATE_BINS - 1, Math.floor(((wallMs - start) / RATE_WINDOW_MS) * RATE_BINS))
    bins[index] += 1
  }
  return bins
}

function RateKpi({ transactions }: { transactions: LiveTransaction[] }) {
  const now = useNow(1_000)
  const bins = useMemo(() => rateBins(transactions, now), [now, transactions])
  const total = bins.reduce((sum, count) => sum + count, 0)
  const peak = Math.max(1, ...bins)
  return (
    <div className="kpi kpi-rate">
      <ArrowLeftRight aria-hidden="true" className="kpi-icon" size={22} strokeWidth={1.6} />
      <div className="kpi-text">
        <span className="kpi-label">Transaction rate <small>last 10 s</small></span>
        <span className="kpi-value">{(total / (RATE_WINDOW_MS / 1_000)).toFixed(1)} <small>tx/s</small></span>
      </div>
      <svg aria-hidden="true" className="kpi-spark" preserveAspectRatio="none" viewBox={`0 0 ${RATE_BINS * 3} 24`}>
        <line className="kpi-spark-base" x1="0" x2={RATE_BINS * 3} y1="23.5" y2="23.5" />
        {bins.map((count, index) => count > 0 && (
          <rect height={Math.max(2, (count / peak) * 22)} key={index} rx="0.5" width="2" x={index * 3} y={24 - Math.max(2, (count / peak) * 22)} />
        ))}
      </svg>
    </div>
  )
}

function FailuresKpi({ transactions }: { transactions: LiveTransaction[] }) {
  const failed = transactions.filter((transaction) => transaction.status === 'error').length
  return (
    <Kpi icon={TriangleAlert} label="Failures" tone={failed > 0 ? 'warn' : undefined}>
      {failed} / {transactions.length} <small>session</small>
    </Kpi>
  )
}

function LatencyKpi({ transactions }: { transactions: LiveTransaction[] }) {
  const p95 = useMemo(() => percentile(
    transactions.map(transactionWallDurationUs).filter((value): value is number => value !== undefined),
    0.95,
  ), [transactions])
  return (
    <Kpi icon={Timer} label="Latency" hint="p95">
      {p95 === undefined ? '—' : <>{p95 >= 1_000 ? (p95 / 1_000).toFixed(2) : p95.toFixed(0)} <small>{p95 >= 1_000 ? 'ms' : 'µs'}</small></>}
    </Kpi>
  )
}

/** Global run-state strip: is the simulator up, and what is the bus doing right now. */
export function TopBar() {
  const transactions = useSessionTransactions()
  return (
    <header aria-label="Simulator summary" className="topbar">
      <NavLink aria-label="VDS4E overview" className="brand" end to="/">
        <BrandMark />
        <span className="brand-name">VDS4E</span>
      </NavLink>
      <div className="topbar-kpis">
        <ServerKpi />
        <AdaptersKpi />
        <VirtualTimeKpi />
        <RateKpi transactions={transactions} />
        <FailuresKpi transactions={transactions} />
        <LatencyKpi transactions={transactions} />
      </div>
    </header>
  )
}
