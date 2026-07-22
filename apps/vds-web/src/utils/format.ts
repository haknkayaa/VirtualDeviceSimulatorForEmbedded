export function formatHex(value: number, widthBits = 8) {
  return `0x${value.toString(16).toUpperCase().padStart(Math.ceil(widthBits / 4), '0')}`
}

export function formatBytes(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

export function formatVirtualTime(nanoseconds: number) {
  if (nanoseconds >= 1_000_000_000) return `${(nanoseconds / 1_000_000_000).toFixed(3)} s`
  if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(3)} ms`
  if (nanoseconds >= 1_000) return `${(nanoseconds / 1_000).toFixed(3)} µs`
  return `${nanoseconds} ns`
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ')
}
