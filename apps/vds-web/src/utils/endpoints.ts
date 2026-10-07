/**
 * Bus-native endpoint notation, matching how Linux tools address a device:
 * SPI chip select (`spidevB.CS`), 7-bit I2C address (`i2cget -y N 0x50`),
 * UART pseudo-terminal, otherwise the raw endpoint index.
 */
export function formatEndpoint(busType: string, endpoint: number) {
  const bus = busType.toLowerCase()
  if (bus === 'spi' || bus === 'qspi') return `CS${endpoint}`
  if (bus === 'i2c') return `0x${endpoint.toString(16).toUpperCase().padStart(2, '0')}`
  if (bus === 'uart') return 'PTY'
  return `#${endpoint}`
}
