export function formatFrequency(deltaNs: number): string {
  if (deltaNs <= 0) return '—'
  const freqHz = 1e9 / deltaNs

  if (freqHz >= 1e9 - 1e-3) return `${(freqHz / 1e9).toFixed(2)} GHz`
  if (freqHz >= 1e6 - 1e-3) return `${(freqHz / 1e6).toFixed(2)} MHz`
  if (freqHz >= 1e3 - 1e-3) return `${(freqHz / 1e3).toFixed(2)} kHz`
  return `${freqHz.toFixed(1)} Hz`
}
