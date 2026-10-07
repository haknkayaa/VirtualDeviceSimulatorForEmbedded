import type { Adapter, AdapterBinding } from '../../types/api'

export interface AdapterAssignment {
  adapter: Adapter
  binding: AdapterBinding
}

/** Map adapter bindings by device id so lists and headers resolve the /dev node in O(1). */
export function indexAdapterAssignments(adapters: Adapter[] | undefined) {
  const assignments = new Map<string, AdapterAssignment>()
  for (const adapter of adapters ?? []) {
    for (const binding of adapter.bindings) assignments.set(binding.device_id, { adapter, binding })
  }
  return assignments
}

/** Status-dot tone for a runtime device state. */
export function deviceStateTone(state: string | null | undefined) {
  if (!state) return ''
  if (state === 'ready' || state === 'idle') return 'ok'
  if (/error|fault|fail/.test(state)) return 'err'
  return 'warn'
}

/** Status-dot tone for an adapter lifecycle state. */
export function adapterStateTone(state: string | undefined) {
  if (state === 'loaded') return 'ok'
  if (state === 'error') return 'err'
  if (state === 'loading' || state === 'unloading') return 'warn'
  return ''
}

export function accessLabel(access: string) {
  const normalized = access.toLowerCase()
  if (normalized === 'rw') return 'R/W'
  if (normalized === 'ro') return 'R'
  if (normalized === 'wo') return 'W'
  return access.toUpperCase()
}

export function canWrite(access: string) {
  return access.toLowerCase().includes('w')
}

/** Read a persisted per-viewer UI preference; storage may be unavailable. */
export function readPreference(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

export function writePreference(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Preferences are a convenience; ignore blocked storage.
  }
}
