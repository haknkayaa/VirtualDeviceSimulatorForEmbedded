export interface ApiErrorBody {
  code: string
  message: string
}

export interface Health {
  status: 'ok' | string
  system?: SystemMetrics
}

export interface SystemMetrics {
  cpu_percent?: number
  memory_used_bytes?: number
  memory_total_bytes?: number
  disk_used_bytes?: number
  disk_total_bytes?: number
  network_rx_bytes_per_sec?: number
  network_tx_bytes_per_sec?: number
}

export interface Device {
  id: string
  bus: string
  state: string | null
  name?: string
  type?: string
  model?: string
  version?: string
}

export interface DeviceTemplate {
  id: string
  name: string
  bus: string
  model: string
}

export interface CreateDeviceInput {
  template_id: string
  device_id: string
}

export interface DeviceState {
  device_id: string
  state: string | null
}

export interface DeviceRegister {
  name: string
  address: number
  width_bits: number
  access: string
  value: number
  reset_value?: number
  description?: string
}

export type BusHealth = 'idle' | 'healthy' | 'degraded' | 'unhealthy'

export interface BusTelemetry {
  device_id: string
  bus_type: string
  health: BusHealth
  transactions_total: number
  in_flight: number
  throughput: {
    tx_bytes_per_second: number
    rx_bytes_per_second: number
  }
  latency: {
    wall_avg_us: number
    wall_p95_us: number
    wall_max_us: number
    virtual_avg_ns: number
    virtual_p95_ns: number
    virtual_max_ns: number
  }
  errors: {
    count: number
    rate: number
    last_code?: string
  }
  retries: {
    count: number
  }
}

export interface BusTelemetryResponse {
  generated_at_wall_ns: number
  window_seconds: number
  buses: BusTelemetry[]
}

export interface Fault {
  id: string
  device_id: string
  enabled: boolean
  priority: number
  persistent: boolean
  trigger: string
  action: string
}

export interface ScenarioSummary {
  id: string
  name: string
  timeout_ms: number
  steps: number
}

export type ScenarioAction = Record<string, unknown> & { action: string }

export interface ScenarioStep {
  id: string
  continue_on_failure: boolean
  action: string
  [key: string]: unknown
}

export interface ScenarioDocument {
  schema_version: number
  scenario: {
    id: string
    name: string
    timeout_ms: number
  }
  steps: ScenarioStep[]
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult {
  step_id: string
  action: string
  status: StepStatus
  started_virtual_ns: number
  completed_virtual_ns: number
  error?: string
}

export interface ScenarioResult {
  scenario_id: string
  status: StepStatus
  started_virtual_ns: number
  completed_virtual_ns: number
  duration_virtual_ns: number
  steps_total: number
  steps_passed: number
  steps_failed: number
  steps_skipped: number
  steps: StepResult[]
}

export interface RunRecord {
  run_id: string
  scenario_id: string
  status: RunStatus
  result?: ScenarioResult
  error?: string
}

export interface DownloadArtifact {
  blob: Blob
  filename: string
}
