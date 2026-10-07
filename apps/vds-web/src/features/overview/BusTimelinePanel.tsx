import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAdapters } from '../../api/queries'
import { Panel } from '../../components/Panel'
import { useNow } from '../../hooks/useNow'
import type { LiveTransaction } from '../transactions/transactionModel'
import { buildTimeline } from './overviewModel'

const windows = [
  { label: '10 s', ms: 10_000 },
  { label: '1 min', ms: 60_000 },
  { label: '10 min', ms: 600_000 },
] as const

function axisLabels(windowMs: number) {
  const seconds = windowMs / 1_000
  return Array.from({ length: 6 }, (_, index) => {
    const value = seconds - (index * seconds) / 5
    if (value === 0) return '0s'
    return seconds >= 120 ? `-${Math.round(value / 60)}m` : `-${Math.round(value)}s`
  })
}

/** Per-bus activity over a sliding wall-clock window, newest at the right edge. */
export function BusTimelinePanel({ transactions }: { transactions: LiveTransaction[] }) {
  const adapters = useAdapters()
  const now = useNow(1_000)
  const [windowMs, setWindowMs] = useState<number>(windows[0].ms)
  const lanes = useMemo(() => buildTimeline(transactions, adapters.data, now, windowMs), [adapters.data, now, transactions, windowMs])
  const label = windows.find((option) => option.ms === windowMs)?.label ?? ''

  return (
    <Panel
      actions={(
        <div aria-label="Time window" className="segmented" role="group">
          {windows.map((option) => (
            <button aria-pressed={windowMs === option.ms} key={option.ms} onClick={() => setWindowMs(option.ms)} type="button">{option.label}</button>
          ))}
        </div>
      )}
      className="overview-timeline"
      flush
      title={`Bus activity · last ${label}`}
    >
      <div className="tl">
        <div className="tl-axis" aria-hidden="true">
          <span />
          <div className="tl-axis-labels">{axisLabels(windowMs).map((text) => <span key={text}>{text}</span>)}</div>
        </div>
        {lanes.map((lane) => (
          <div className={`tl-lane bus-${lane.bus}`} key={lane.bus}>
            <Link className="tl-bus" to={`/transactions?bus=${lane.bus}`}>{lane.bus.toUpperCase()}</Link>
            <div className="tl-track">
              {lane.ticks.length === 0 && (
                <span className="tl-empty">{lane.configured ? `No ${lane.bus.toUpperCase()} traffic in the last ${label}` : 'Not configured'}</span>
              )}
              {lane.ticks.map((tick) => (
                <i className={`tl-tick${tick.failed ? ' failed' : ''}`} key={tick.id} style={{ left: `${tick.at * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
