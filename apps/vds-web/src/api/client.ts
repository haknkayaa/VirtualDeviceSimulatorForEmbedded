import type {
  Adapter,
  ApiErrorBody,
  AttachAdapterDeviceInput,
  BusTelemetryResponse,
  ClockSnapshot,
  CreateAdapterInput,
  CreateDeviceInput,
  Device,
  DeviceCommand,
  DeviceRegister,
  DeviceState,
  DeviceTemplate,
  ExecuteDeviceCommandInput,
  ExecuteDeviceCommandResult,
  DownloadArtifact,
  Fault,
  Health,
  ImportedDevicePackage,
  ImportDevicePackageFile,
  RunRecord,
  ScenarioDocument,
  ScenarioResult,
  ScenarioSummary,
  WriteDeviceRegisterInput,
} from '../types/api'
import type { FlowDocument } from '../features/flows/types/flow'

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

async function requestArtifact(path: string): Promise<DownloadArtifact> {
  const response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: 'application/xml' } })
  if (!response.ok) {
    let body: ApiErrorBody = { code: 'http_error', message: response.statusText }
    try { body = (await response.json()) as ApiErrorBody } catch { /* Preserve transport fallback. */ }
    throw new ApiError(response.status, body.code, body.message)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'scenario-result.junit.xml'
  return { blob: await response.blob(), filename }
}

export const api = {
  health: () => request<Health>('/health'),
  clock: () => request<ClockSnapshot>('/clock'),
  busTelemetry: () => request<BusTelemetryResponse>('/telemetry/buses'),
  devices: () => request<Device[]>('/devices'),
  adapters: () => request<Adapter[]>('/adapters'),
  createAdapter: (input: CreateAdapterInput) =>
    request<Adapter>('/adapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  loadAdapter: (id: string) =>
    request<Adapter>(`/adapters/${encodeURIComponent(id)}/load`, { method: 'POST' }),
  unloadAdapter: (id: string) =>
    request<Adapter>(`/adapters/${encodeURIComponent(id)}/unload`, { method: 'POST' }),
  attachAdapterDevice: ({ adapterId, ...input }: AttachAdapterDeviceInput) =>
    request<Adapter>(`/adapters/${encodeURIComponent(adapterId)}/bindings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  detachAdapterDevice: ({ adapterId, deviceId }: { adapterId: string; deviceId: string }) =>
    request<Adapter>(`/adapters/${encodeURIComponent(adapterId)}/bindings/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    }),
  deviceTemplates: () => request<DeviceTemplate[]>('/device-models'),
  devicePackages: () => request<ImportedDevicePackage[]>('/device-packages'),
  importDevicePackage: (files: ImportDevicePackageFile[]) =>
    request<ImportedDevicePackage>('/device-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    }),
  createDevice: (input: CreateDeviceInput) =>
    request<Device>('/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  device: (id: string) => request<Device>(`/devices/${encodeURIComponent(id)}`),
  deviceCommands: (id: string) =>
    request<DeviceCommand[]>(`/devices/${encodeURIComponent(id)}/commands`),
  executeDeviceCommand: ({ deviceId, ...input }: ExecuteDeviceCommandInput) =>
    request<ExecuteDeviceCommandResult>(`/devices/${encodeURIComponent(deviceId)}/commands/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  deviceFlow: (id: string) => request<FlowDocument>(`/devices/${encodeURIComponent(id)}/flow`),
  registers: (id: string) =>
    request<DeviceRegister[]>(`/devices/${encodeURIComponent(id)}/registers`),
  writeRegister: ({ deviceId, address, value }: WriteDeviceRegisterInput) =>
    request<DeviceRegister>(`/devices/${encodeURIComponent(deviceId)}/registers/${address}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
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
  runScenarioDefinition: ({ document, revision }: { document: ScenarioDocument; revision: number }) =>
    request<RunRecord>(`/scenarios/${encodeURIComponent(document.scenario.id)}/run?revision=${encodeURIComponent(revision)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document),
    }),
  run: (id: string) => request<RunRecord>(`/runs/${encodeURIComponent(id)}`),
  runResult: (id: string) => request<ScenarioResult>(`/runs/${encodeURIComponent(id)}/result`),
  runResultJunit: (id: string) => requestArtifact(`/runs/${encodeURIComponent(id)}/result/junit`),
}
