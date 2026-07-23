export type LibraryPackageKind = 'device_model'
export type LibraryPackageReadiness = 'runtime_ready' | 'starter_template'

export interface LibraryPackage {
  id: string
  name: string
  acronym: string
  kind: LibraryPackageKind
  readiness: LibraryPackageReadiness
  bus: 'SPI' | 'I2C' | 'Ethernet'
  version: string
  source: string
  description: string
  capabilities: string[]
  statistics: Array<{ label: string; value: string }>
  readme: string[]
  editorPath?: string
}

export const deviceLibraryCatalog: LibraryPackage[] = [
  {
    id: 'generic-spi-device',
    name: 'Generic SPI Device',
    acronym: 'SPI',
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: 'SPI',
    version: '1.0.0',
    source: 'device-models/examples/generic-spi-flash/model.yaml',
    description: 'Vendor-neutral SPI device library backed by the complete deterministic 128 Mbit flash reference model.',
    capabilities: ['SPI Mode 0', '8-bit transfers', 'Register map', 'State machine', 'Fault profiles'],
    statistics: [
      { label: 'Registers', value: '3' },
      { label: 'Commands', value: '12' },
      { label: 'States', value: '8' },
      { label: 'Scenarios', value: '10' },
    ],
    readme: [
      'Runtime-ready public-safe SPI reference package.',
      'Includes deterministic reset, program, erase and power-down timing.',
      'Uses the existing device runtime, virtual scheduler and fault engine.',
    ],
    editorPath: '/flows/devices/generic-spi-flash-128m-behavior',
  },
  {
    id: 'generic-i2c-device',
    name: 'Generic I2C Device',
    acronym: 'I2C',
    kind: 'device_model',
    readiness: 'starter_template',
    bus: 'I2C',
    version: '0.1.0',
    source: 'VDS4E local starter catalog',
    description: 'Public-safe I2C authoring starter for future register-oriented device packages.',
    capabilities: ['7-bit addressing', 'Register-oriented design', 'Local authoring', 'Public-safe metadata'],
    statistics: [
      { label: 'Status', value: 'Template' },
      { label: 'Bus', value: 'I2C' },
      { label: 'Runtime', value: 'Pending' },
      { label: 'Schema', value: 'Draft' },
    ],
    readme: [
      'Starter metadata for a future generic I2C device package.',
      'A runtime adapter and reviewed device-model schema are still required.',
      'This entry does not claim executable simulator behavior.',
    ],
  },
  {
    id: 'generic-ethernet-device',
    name: 'Generic Ethernet Device',
    acronym: 'ETH',
    kind: 'device_model',
    readiness: 'starter_template',
    bus: 'Ethernet',
    version: '0.1.0',
    source: 'VDS4E local starter catalog',
    description: 'Public-safe Ethernet authoring starter for future network-capable device packages.',
    capabilities: ['Ethernet metadata', 'Local authoring', 'Public-safe template', 'Adapter-ready design'],
    statistics: [
      { label: 'Status', value: 'Template' },
      { label: 'Bus', value: 'Ethernet' },
      { label: 'Runtime', value: 'Pending' },
      { label: 'Schema', value: 'Draft' },
    ],
    readme: [
      'Starter metadata for a future generic Ethernet device package.',
      'Network transport and runtime behavior are intentionally not implemented.',
      'This entry does not add a network transaction path.',
    ],
  },
]

export function libraryKindLabel() {
  return 'Device Model'
}
