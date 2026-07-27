import micronMt25qlImage from '../../../../../device-models/examples/micron-mt25ql256aba8esf-0sit/assets/mt25ql256aba8esf-0sit.jpg'

import type { Device } from '../../types/api'

export interface DeviceProductImage {
  alt: string
  src: string
}

export function deviceProductImage(device: Device): DeviceProductImage | undefined {
  const identity = [device.id, device.name, device.model, device.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (identity.includes('micron') || identity.includes('mt25ql256') || identity.includes('mt25q')) {
    return {
      alt: 'Micron MT25QL256ABA8ESF-0SIT flash memory package',
      src: micronMt25qlImage,
    }
  }
  return undefined
}
