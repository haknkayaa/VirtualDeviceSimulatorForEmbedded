import type { Adapter, AdapterBinding, Device } from '../../types/api'

export interface PackageInstance {
  device?: Device
  adapter?: Adapter
  binding?: AdapterBinding
  /** Linux node the instance is reachable at, when bound to an adapter. */
  nodePath?: string
  /** True when the owning adapter is loaded and the node really exists. */
  exposed: boolean
}

/**
 * Packages are instantiated as runtime devices that carry the package id.
 * Join them with adapter bindings so the library can show where a package
 * is actually reachable from Linux.
 */
export function buildPackageInstances(packageIds: string[], devices: Device[] = [], adapters: Adapter[] = []) {
  const devicesById = new Map(devices.map((device) => [device.id, device]))
  const bindings = new Map<string, { adapter: Adapter; binding: AdapterBinding }>()
  for (const adapter of adapters) {
    for (const binding of adapter.bindings) bindings.set(binding.device_id, { adapter, binding })
  }
  const instances = new Map<string, PackageInstance>()
  for (const id of packageIds) {
    const device = devicesById.get(id)
    const bound = bindings.get(id)
    if (!device && !bound) continue
    const nodePath = bound
      ? (bound.adapter.bus_type === 'gpio' || bound.adapter.bus_type === 'uart') && bound.adapter.device_path
        ? bound.adapter.device_path
        : bound.binding.device_path
      : undefined
    instances.set(id, {
      device,
      adapter: bound?.adapter,
      binding: bound?.binding,
      nodePath,
      exposed: bound?.adapter.state === 'loaded',
    })
  }
  return instances
}
