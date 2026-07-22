import { AlertTriangle, Inbox, LoaderCircle, WifiOff } from 'lucide-react'

interface AsyncStateProps {
  kind: 'loading' | 'empty' | 'error' | 'disconnected'
  title: string
  detail?: string
}

const icons = {
  loading: LoaderCircle,
  empty: Inbox,
  error: AlertTriangle,
  disconnected: WifiOff,
}

export function AsyncState({ kind, title, detail }: AsyncStateProps) {
  const Icon = icons[kind]
  return (
    <div className={`async-state async-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" className={kind === 'loading' ? 'spin' : ''} size={22} />
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  )
}
