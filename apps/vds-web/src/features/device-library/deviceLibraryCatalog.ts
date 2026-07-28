import type { ImportedDevicePackage } from '../../types/api'

export type LibraryPackageKind = 'device_model'

export interface LibraryPackage {
  id: string
  name: string
  acronym: string
  kind: LibraryPackageKind
  bus: string
  version: string
  source: string
  description: string
  capabilities: string[]
  statistics: Array<{ label: string; value: string }>
  readme: string[]
  image?: { alt: string; src: string }
}

export function libraryPackageFromApi(devicePackage: ImportedDevicePackage): LibraryPackage {
  const bus = devicePackage.bus.toUpperCase()
  return {
    id: devicePackage.id,
    name: devicePackage.name,
    acronym: devicePackage.name.slice(0, 4).toUpperCase(),
    kind: 'device_model',
    bus,
    version: devicePackage.version,
    source: `~/vds4e/devices/${devicePackage.id}`,
    description: `${bus} device package installed in the local VDS4E package store.`,
    capabilities: [`${bus} runtime`, 'Package-local model, flows, scenarios and documentation'],
    statistics: [
      { label: 'Status', value: 'Installed' },
      { label: 'Bus', value: bus },
      { label: 'Version', value: devicePackage.version },
    ],
    readme: ['Package metadata is loaded from the local package service.'],
    image: devicePackage.image_url
      ? { alt: `${devicePackage.name} package image`, src: devicePackage.image_url }
      : undefined,
  }
}

export function libraryKindLabel() {
  return 'Device Model'
}
