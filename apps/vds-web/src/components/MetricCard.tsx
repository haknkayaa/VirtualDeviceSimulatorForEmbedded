import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: string | number
  detail: string
  icon: LucideIcon
  accent?: 'cyan' | 'violet' | 'amber'
}

export function MetricCard({ label, value, detail, icon: Icon, accent = 'cyan' }: MetricCardProps) {
  return (
    <article className={`metric-card accent-${accent}`}>
      <div className="metric-icon"><Icon aria-hidden="true" size={19} /></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  )
}
