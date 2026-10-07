import { humanize } from '../utils/format'

export type StatusTone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral'

interface StatusBadgeProps {
  status: string | null | undefined
  /** Override the displayed text while keeping the status-derived tone. */
  label?: string
  tone?: StatusTone
}

const positive = new Set(['ok', 'ready', 'passed', 'connected', 'success', 'loaded', 'healthy', 'online', 'attached'])
const warning = new Set(['queued', 'running', 'busy', 'resetting', 'reconnecting', 'connecting', 'loading', 'unloading', 'degraded', 'authorization_required', 'partial', 'skipped'])
const negative = new Set(['failed', 'timed_out', 'cancelled', 'disconnected', 'error', 'unhealthy', 'unavailable', 'fail'])

function statusTone(status: string | null | undefined): StatusTone {
  const value = status ?? 'unknown'
  if (positive.has(value)) return 'positive'
  if (warning.has(value)) return 'warning'
  if (negative.has(value)) return 'negative'
  return 'neutral'
}

export function StatusBadge({ status, label, tone }: StatusBadgeProps) {
  const value = status ?? 'unknown'
  return <span className={`status-badge status-${tone ?? statusTone(value)}`}>{label ?? humanize(value)}</span>
}
