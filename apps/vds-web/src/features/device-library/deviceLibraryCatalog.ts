import micronMt25qlImage from '../../../../../device-models/examples/micron-mt25ql256aba8esf-0sit/assets/mt25ql256aba8esf-0sit.jpg'
import at24c128Image from '../../../../../device-models/examples/atmel-at24c128/assets/at24c128.svg'
import at24c256Image from '../../../../../device-models/examples/atmel-at24c256/assets/at24c256.svg'

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
  image?: { alt: string; src: string }
}

export const deviceLibraryCatalog: LibraryPackage[] = [
  {
    id: 'micron-mt25ql256aba8esf-0sit',
    name: 'Micron MT25QL256ABA8ESF-0SIT',
    acronym: 'MT25Q',
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: 'SPI',
    version: '0.1.0',
    source: 'device-models/examples/micron-mt25ql256aba8esf-0sit/model/device.yaml',
    description: 'Datasheet-derived 256 Mbit Micron serial NOR model with deterministic four-byte addressing, program, erase, reset and deep-power-down behavior.',
    capabilities: ['SPI Mode 0', '32 MiB NOR', '4-byte addressing', 'Page program', '4 KiB erase', 'Deep power-down'],
    statistics: [
      { label: 'Registers', value: '12' },
      { label: 'Commands', value: '21' },
      { label: 'States', value: '8' },
      { label: 'Scenarios', value: '4' },
    ],
    readme: [
      'Derived from the Micron MT25QL256ABA revision L datasheet.',
      'Includes JEDEC identification, WIP/WEL status and deterministic program/erase timing.',
      'The package documents protocol features that still require additional simulator runtime support.',
    ],
    image: {
      alt: 'Representative 16-pin SOIC package for the Micron MT25QL256ABA8ESF-0SIT',
      src: micronMt25qlImage,
    },
  },
  {
    id: 'generic-spidev',
    name: 'Generic SPI Device',
    acronym: 'SPI',
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: 'SPI',
    version: '1.0.0',
    source: 'device-models/examples/generic-spidev/model/device.yaml',
    description: 'Vendor-neutral spidev endpoint for validating Linux SPI transport and ioctl integration.',
    capabilities: ['SPI Mode 0', '8-bit transfers', 'PING', 'TX-only', 'Full duplex', 'RX pattern'],
    statistics: [
      { label: 'Registers', value: '0' },
      { label: 'Commands', value: '4' },
      { label: 'States', value: '0' },
      { label: 'Purpose', value: 'spidev_test' },
    ],
    readme: [
      'Runtime-ready transport test package with no flash or vendor semantics.',
      'Provides deterministic RX–TX shortcuts for standard spidev applications.',
      'Use a concrete device package such as the Micron model for flash behavior.',
    ],
  },
  {
    id: 'atmel-at24c128',
    name: 'Atmel AT24C128',
    acronym: '128',
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: 'I2C',
    version: '1.0.0',
    source: 'device-models/examples/atmel-at24c128/model/device.yaml',
    description: 'Datasheet-derived 128-Kbit Atmel serial EEPROM with real page-write, busy polling and sequential-read behavior.',
    capabilities: ['16 KiB EEPROM', 'Two-byte word address', '64-byte page write', 'ACK polling', 'Sequential read', 'Write protect'],
    statistics: [
      { label: 'Capacity', value: '16 KiB' },
      { label: 'Page', value: '64 B' },
      { label: 'Write cycle', value: '5 ms max' },
      { label: 'Addresses', value: '0x50–0x53' },
    ],
    readme: [
      'Derived from Atmel datasheet 0670T-SEEPR-3/07.',
      'Implements byte/page write, current/random/sequential read and address rollover.',
      'Rejects transfers during the self-timed write cycle so Linux ACK polling works.',
    ],
    image: { alt: 'Atmel AT24C128 eight-pin serial EEPROM', src: at24c128Image },
  },
  {
    id: 'atmel-at24c256',
    name: 'Atmel AT24C256',
    acronym: '256',
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: 'I2C',
    version: '1.0.0',
    source: 'device-models/examples/atmel-at24c256/model/device.yaml',
    description: 'Datasheet-derived 256-Kbit Atmel serial EEPROM with real page-write, busy polling and sequential-read behavior.',
    capabilities: ['32 KiB EEPROM', 'Two-byte word address', '64-byte page write', 'ACK polling', 'Sequential read', 'Write protect'],
    statistics: [
      { label: 'Capacity', value: '32 KiB' },
      { label: 'Page', value: '64 B' },
      { label: 'Write cycle', value: '5 ms max' },
      { label: 'Addresses', value: '0x50–0x53' },
    ],
    readme: [
      'Derived from Atmel datasheet 0670T-SEEPR-3/07.',
      'Implements byte/page write, current/random/sequential read and address rollover.',
      'Rejects transfers during the self-timed write cycle so Linux ACK polling works.',
    ],
    image: { alt: 'Atmel AT24C256 eight-pin serial EEPROM', src: at24c256Image },
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
