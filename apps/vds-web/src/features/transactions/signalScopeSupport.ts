export function supportsSignalScope(busType: string) {
  return ['spi', 'i2c', 'uart', 'gpio'].includes(busType.toLowerCase())
}
