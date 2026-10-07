import { AlertTriangle, Inbox, LoaderCircle, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'

interface AsyncStateProps {
  kind: 'loading' | 'empty' | 'error' | 'disconnected'
  title: string
  detail?: ReactNode
  centered?: boolean
}

const icons = {
  loading: LoaderCircle,
  empty: Inbox,
  error: AlertTriangle,
  disconnected: WifiOff,
}

export function AsyncState({ kind, title, detail, centered = false }: AsyncStateProps) {
  const Icon = icons[kind]
  return (
    <div className={`async-state async-${kind}${centered ? ' centered' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" className={kind === 'loading' ? 'spin' : ''} size={15} />
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  )
}
