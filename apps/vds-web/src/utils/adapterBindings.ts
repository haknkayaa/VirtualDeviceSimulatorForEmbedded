import type { Adapter, Device } from '../types/api'

export function attachedDevices(
  devices: Device[] | undefined,
  adapters: Adapter[] | undefined,
): Device[] {
  if (!devices?.length || !adapters?.length) {
    return []
  }

  const attachedIds = new Set(
    adapters.flatMap((adapter) => adapter.bindings.map((binding) => binding.device_id)),
  )
  return devices.filter((device) => attachedIds.has(device.id))
}
