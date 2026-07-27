export interface SpiInterfaceConfiguration {
  maxClockHz: number
  cpol: 0 | 1
  cpha: 0 | 1
  bitsPerWord: 8 | 16 | 32
  lsbFirst: boolean
}

const defaultInterface: SpiInterfaceConfiguration = {
  maxClockHz: 10_000_000,
  cpol: 0,
  cpha: 0,
  bitsPerWord: 8,
  lsbFirst: false,
}

export function readSpiInterfaceConfiguration(deviceId: string): SpiInterfaceConfiguration {
  try {
    return {
      ...defaultInterface,
      ...JSON.parse(localStorage.getItem(`vds4e.spi.${deviceId}`) ?? '{}') as Partial<SpiInterfaceConfiguration>,
    }
  } catch {
    return defaultInterface
  }
}
