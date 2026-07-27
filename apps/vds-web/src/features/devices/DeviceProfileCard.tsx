import type { ReactNode } from 'react'
import { Microchip } from 'lucide-react'

import { StatusBadge } from '../../components/StatusBadge'
import type { Device } from '../../types/api'
import { deviceProductImage } from './deviceProductImage'

interface DeviceProfileCardProps {
  device: Device
  currentState: string | null
  actions: ReactNode
}

export function DeviceProfileCard({ device, currentState, actions }: DeviceProfileCardProps) {
  const productImage = deviceProductImage(device)
  return (
    <section className="glass-panel device-profile-card">
      {productImage ? (
        <img alt={productImage.alt} className="device-profile-product-image" src={productImage.src} />
      ) : (
        <div aria-label={`${device.id} device illustration`} className="device-profile-image" role="img">
          <Microchip aria-hidden="true" size={38} strokeWidth={1.4} />
        </div>
      )}
      <div className="device-profile-content">
        <header className="device-profile-header">
          <div className="device-profile-identity">
            <h2>{device.name ?? device.id}</h2>
          </div>
          {actions}
        </header>
        <dl className="device-profile-metadata">
          <div><dt>Bus name</dt><dd>{device.bus.toUpperCase()}</dd></div>
          <div><dt>Type</dt><dd>{device.type ?? 'Not reported'}</dd></div>
          <div><dt>Model</dt><dd>{device.model ?? 'Not reported'}</dd></div>
          <div><dt>Version</dt><dd>{device.version ?? 'Not reported'}</dd></div>
          <div><dt>Status</dt><dd><StatusBadge status={currentState} /></dd></div>
        </dl>
      </div>
    </section>
  )
}
