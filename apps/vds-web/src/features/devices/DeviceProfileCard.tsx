import type { ReactNode } from 'react'
import { Microchip } from 'lucide-react'

import { BusTag } from '../../components/BusTag'
import { StatusBadge } from '../../components/StatusBadge'
import type { Device } from '../../types/api'
import { formatEndpoint } from '../../utils/endpoints'
import { adapterStateTone, type AdapterAssignment } from './deviceModel'

interface DeviceProfileCardProps {
  device: Device
  currentState: string | null
  assignment?: AdapterAssignment
  actions: ReactNode
}

/** Compact identity + binding strip at the top of the device workbench. */
export function DeviceProfileCard({ device, currentState, assignment, actions }: DeviceProfileCardProps) {
  const adapter = assignment?.adapter
  const exposed = adapter?.state === 'loaded'
  return (
    <section aria-label="Device header" className="device-profile-card dv-head">
      <div className="dv-head-row">
        <span className="dv-head-thumb">
          {device.image_url
            ? <img alt="" decoding="async" height={28} loading="lazy" src={device.image_url} width={28} />
            : <Microchip aria-hidden="true" size={16} strokeWidth={1.5} />}
        </span>
        <div className="dv-head-identity">
          <h2 className="truncate" title={device.name ?? device.id}>{device.name ?? device.id}</h2>
          {device.name && device.name !== device.id && <code className="dv-head-id truncate">{device.id}</code>}
          <BusTag bus={device.bus} />
          <StatusBadge status={currentState} />
        </div>
        {actions}
      </div>
      <dl className="dv-head-meta">
        {device.type && <div><dt>Type</dt><dd>{device.type}</dd></div>}
        {device.model && <div><dt>Model</dt><dd className="mono">{device.model}</dd></div>}
        {device.version && <div><dt>Version</dt><dd className="mono">{device.version}</dd></div>}
        <div className="dv-head-binding">
          <dt>Node</dt>
          <dd>
            {assignment
              ? <code className={exposed ? 'dv-node' : 'dv-node down'} title={exposed ? 'Exposed to applications' : 'Not exposed: adapter is not loaded'}>{assignment.binding.device_path}</code>
              : <span className="faint">unbound</span>}
          </dd>
        </div>
        {assignment && adapter && (
          <>
            <div>
              <dt>Adapter</dt>
              <dd className="dv-head-adapter">
                <i aria-hidden="true" className={`status-dot ${adapterStateTone(adapter.state)}`} />
                <code>{adapter.id}</code>
                <span className="faint">{adapter.driver} · {adapter.state}</span>
              </dd>
            </div>
            <div><dt>Endpoint</dt><dd className="mono">{formatEndpoint(adapter.bus_type, assignment.binding.endpoint)}</dd></div>
          </>
        )}
      </dl>
    </section>
  )
}
