export function supportsSignalScope(busType: string) {
  return ['spi', 'i2c', 'uart', 'gpio', 'can'].includes(busType.toLowerCase())
}
