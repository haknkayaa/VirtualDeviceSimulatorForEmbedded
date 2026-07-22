import type {
  ApiErrorBody,
  Device,
  DeviceRegister,
  DeviceState,
  Fault,
  Health,
  RunRecord,
  ScenarioDocument,
  ScenarioResult,
  ScenarioSummary,
} from '../types/api'

const API_ROOT = import.meta.env.VITE_API_ROOT ?? '/api/v1'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    let body: ApiErrorBody = { code: 'http_error', message: response.statusText }
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      // Preserve the transport fallback when an intermediary returns non-JSON.
    }
    throw new ApiError(response.status, body.code, body.message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/health'),
  devices: () => request<Device[]>('/devices'),
  device: (id: string) => request<Device>(`/devices/${encodeURIComponent(id)}`),
  registers: (id: string) =>
    request<DeviceRegister[]>(`/devices/${encodeURIComponent(id)}/registers`),
  state: (id: string) => request<DeviceState>(`/devices/${encodeURIComponent(id)}/state`),
  reset: (id: string) =>
    request<DeviceState>(`/devices/${encodeURIComponent(id)}/reset`, { method: 'POST' }),
  faults: () => request<Fault[]>('/faults'),
  setFault: (id: string, enabled: boolean) =>
    request<void>(`/faults/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
    }),
  scenarios: () => request<ScenarioSummary[]>('/scenarios'),
  scenario: (id: string) => request<ScenarioDocument>(`/scenarios/${encodeURIComponent(id)}`),
  runScenario: (id: string) =>
    request<RunRecord>(`/scenarios/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  runScenarioDefinition: (document: ScenarioDocument) =>
    request<RunRecord>(`/scenarios/${encodeURIComponent(document.scenario.id)}/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document),
    }),
  run: (id: string) => request<RunRecord>(`/runs/${encodeURIComponent(id)}`),
  runResult: (id: string) => request<ScenarioResult>(`/runs/${encodeURIComponent(id)}/result`),
}
