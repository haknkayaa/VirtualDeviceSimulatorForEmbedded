import { humanize } from '../utils/format'

interface StatusBadgeProps {
  status: string | null | undefined
}

const positive = new Set(['ok', 'ready', 'passed', 'connected', 'success'])
const warning = new Set(['queued', 'running', 'busy', 'resetting', 'reconnecting', 'connecting'])
const negative = new Set(['failed', 'timed_out', 'cancelled', 'disconnected', 'error'])

export function StatusBadge({ status }: StatusBadgeProps) {
  const value = status ?? 'unknown'
  const tone = positive.has(value)
    ? 'positive'
    : warning.has(value)
      ? 'warning'
      : negative.has(value)
        ? 'negative'
        : 'neutral'
  return <span className={`status-badge status-${tone}`}>{humanize(value)}</span>
}
