import type { ImportedDevicePackage } from '../../types/api'

export interface LibraryPackage {
  id: string
  name: string
  /** Lower-case bus kind as reported by the package manifest (spi, i2c, gpio, uart). */
  bus: string
  version: string
  /** Default package-store location; VDS4E_DEVICE_STORE overrides it on the server. */
  storePath: string
  image?: { alt: string; src: string }
}

export function libraryPackageFromApi(devicePackage: ImportedDevicePackage): LibraryPackage {
  return {
    id: devicePackage.id,
    name: devicePackage.name,
    bus: devicePackage.bus.toLowerCase(),
    version: devicePackage.version,
    storePath: `~/vds4e/devices/${devicePackage.id}`,
    image: devicePackage.image_url
      ? { alt: `${devicePackage.name} package image`, src: devicePackage.image_url }
      : undefined,
  }
}

export function matchesPackage(item: LibraryPackage, query: string, bus: string) {
  if (bus !== 'all' && item.bus !== bus) return false
  if (!query) return true
  return `${item.name} ${item.id} ${item.bus} ${item.version}`.toLowerCase().includes(query)
}
