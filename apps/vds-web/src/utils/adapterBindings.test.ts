import { describe, expect, it } from 'vitest'

import type { Adapter, Device } from '../types/api'
import { attachedDevices } from './adapterBindings'

const devices = [
  { id: 'flash', bus: 'spi', state: 'ready' },
  { id: 'sensor', bus: 'i2c', state: 'ready' },
  { id: 'unused', bus: 'gpio', state: 'ready' },
] satisfies Device[]

const adapter = {
  id: 'spi0',
  name: 'SPI 0',
  bus_type: 'spi',
  driver: 'cuse',
  state: 'loaded',
  readiness: 'ready',
  bus_number: 0,
  bindings: [
    { device_id: 'flash', endpoint: 0, device_path: '/dev/spidev0.0' },
    { device_id: 'missing', endpoint: 1, device_path: '/dev/spidev0.1' },
  ],
  daemon_pids: [],
} satisfies Adapter

describe('attachedDevices', () => {
  it('returns only registered runtime devices referenced by adapter bindings', () => {
    expect(attachedDevices(devices, [adapter]).map((device) => device.id)).toEqual(['flash'])
  })

  it('returns an empty list while either inventory is unavailable', () => {
    expect(attachedDevices(devices, undefined)).toEqual([])
    expect(attachedDevices(undefined, [adapter])).toEqual([])
  })
})
