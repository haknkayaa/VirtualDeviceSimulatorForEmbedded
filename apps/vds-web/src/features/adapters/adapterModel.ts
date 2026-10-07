import { formatEndpoint } from '../../utils/endpoints'
import type { Adapter, AdapterBinding } from '../../types/api'

export type AdapterBus = 'spi' | 'i2c' | 'gpio' | 'uart'

export interface AdapterBusSpec {
  bus: AdapterBus
  label: string
  driver: string
  nodePattern: string
  /** Kernel module the driver needs, when one exists. */
  kernelModule?: string
  defaultMaxFrequencyHz?: number
}

export const adapterBusSpecs: Record<AdapterBus, AdapterBusSpec> = {
  spi: { bus: 'spi', label: 'SPI', driver: 'CUSE', nodePattern: '/dev/spidevB.C', kernelModule: 'cuse', defaultMaxFrequencyHz: 10_000_000 },
  i2c: { bus: 'i2c', label: 'I2C', driver: 'CUSE', nodePattern: '/dev/i2c-N', kernelModule: 'cuse', defaultMaxFrequencyHz: 400_000 },
  gpio: { bus: 'gpio', label: 'GPIO', driver: 'gpio-sim', nodePattern: '/dev/gpiochipN', kernelModule: 'gpio-sim' },
  uart: { bus: 'uart', label: 'UART', driver: 'PTY', nodePattern: '/dev/pts/N' },
}

export const adapterBuses = Object.keys(adapterBusSpecs) as AdapterBus[]

export function busLabel(busType: string) {
  return busType === 'i2c' ? 'I²C' : busType.toUpperCase()
}

/** Kernel module required by an adapter driver, if any (`cuse`, `gpio-sim`). */
export function kernelModuleFor(adapter: Pick<Adapter, 'driver' | 'bus_type'>) {
  const driver = adapter.driver.toLowerCase()
  if (driver === 'cuse') return 'cuse'
  if (driver === 'gpio-sim') return 'gpio-sim'
  return adapterBusSpecs[adapter.bus_type as AdapterBus]?.kernelModule
}

/** Endpoint column text for a binding; GPIO shows the exposed line count. */
export function bindingEndpointLabel(adapter: Adapter, binding: AdapterBinding) {
  if (adapter.bus_type === 'gpio') return `${binding.line_names?.length ?? adapter.line_count ?? 0} lines`
  return formatEndpoint(adapter.bus_type, binding.endpoint)
}

/** The Linux node a binding is reachable at. GPIO chips are numbered by the kernel at load. */
export function bindingNodePath(adapter: Adapter, binding: AdapterBinding) {
  if (adapter.bus_type === 'gpio' || adapter.bus_type === 'uart') return adapter.device_path ?? binding.device_path
  return binding.device_path
}

/** Node path or pattern for the adapter itself (before any binding exists). */
export function adapterNodePath(adapter: Adapter) {
  if (adapter.device_path) return adapter.device_path
  if (adapter.bus_type === 'gpio') return '/dev/gpiochipX'
  if (adapter.bus_type === 'i2c') return `/dev/i2c-${adapter.bus_number}`
  if (adapter.bus_type === 'uart') return '/dev/pts/X'
  return `/dev/spidev${adapter.bus_number}.*`
}

/** Expected node for a not-yet-attached endpoint. */
export function expectedNodePath(adapter: Adapter, endpoint: number | null) {
  if (adapter.bus_type === 'spi') return `/dev/spidev${adapter.bus_number}.${endpoint ?? 'C'}`
  if (adapter.bus_type === 'i2c') return `/dev/i2c-${adapter.bus_number}`
  if (adapter.bus_type === 'uart') return adapter.device_path ?? '/dev/pts/N after load'
  return adapter.device_path ?? '/dev/gpiochipX'
}

/**
 * Parse an endpoint field. I2C addresses accept `0x` hex or decimal, SPI
 * chip selects decimal. Returns null for anything that is not a valid endpoint.
 */
export function parseEndpoint(busType: string, raw: string): number | null {
  const value = raw.trim()
  if (!value) return null
  const parsed = /^0x[0-9a-f]+$/i.test(value) ? Number.parseInt(value.slice(2), 16) : /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 0) return null
  if (busType === 'i2c' && parsed > 0x7f) return null
  return parsed
}

export function adapterStateTone(state: string) {
  if (state === 'loaded') return 'ok'
  if (state === 'error') return 'err'
  if (state === 'loading' || state === 'unloading') return 'warn'
  return ''
}

export function formatFrequency(hz: number | null | undefined) {
  if (!hz) return '—'
  if (hz >= 1_000_000) return `${Number((hz / 1_000_000).toFixed(3))} MHz`
  if (hz >= 1_000) return `${Number((hz / 1_000).toFixed(3))} kHz`
  return `${hz} Hz`
}

/** First free adapter number for a bus, so new ids and bus numbers do not collide. */
export function suggestAdapter(bus: AdapterBus, adapters: Adapter[]) {
  const ids = new Set(adapters.map((adapter) => adapter.id))
  const numbers = new Set(adapters.filter((adapter) => adapter.bus_type === bus).map((adapter) => adapter.bus_number))
  let index = 0
  while (ids.has(`${bus}${index}`) || (bus !== 'gpio' && numbers.has(index))) index += 1
  return { id: `${bus}${index}`, name: `${adapterBusSpecs[bus].label} ${index}`, busNumber: index }
}
