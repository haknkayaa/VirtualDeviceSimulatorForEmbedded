import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface FlowNoticeState {
  message: string
  error: boolean
}

/** Dismissible editor notice rendered under the page bar. */
export function FlowNotice({ notice, onDismiss }: { notice: FlowNoticeState | null; onDismiss: () => void }) {
  if (!notice) return null
  return (
    <div className={`inline-alert flow-notice ${notice.error ? 'error' : 'ok'}`} role="status">
      {notice.error ? <AlertTriangle aria-hidden="true" className="text-err" size={14} /> : <CheckCircle2 aria-hidden="true" className="text-ok" size={14} />}
      <span>{notice.message}</span>
      <button aria-label="Dismiss message" className="icon-button sm" onClick={onDismiss} type="button"><X size={13} /></button>
    </div>
  )
}

/** Devices / <device> / <section>: where the open document lives. */
export function FlowBreadcrumb({ deviceId, section, sectionPath }: { deviceId?: string; section: string; sectionPath: 'flows' | 'scenarios' }) {
  const device = encodeURIComponent(deviceId ?? '')
  return (
    <nav aria-label="Breadcrumb" className="flow-crumbs">
      <Link to="/devices">Devices</Link>
      <span aria-hidden="true">/</span>
      {deviceId && <><Link className="mono" to={`/devices/${device}`}>{deviceId}</Link><span aria-hidden="true">/</span></>}
      <Link to={`/devices/${device}/${sectionPath}`}>{section}</Link>
    </nav>
  )
}
