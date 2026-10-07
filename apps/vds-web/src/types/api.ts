export interface ApiErrorBody {
  code: string
  message: string
}

export interface Health {
  status: 'ok' | string
  system?: SystemMetrics
}

export interface ClockSnapshot {
  virtual_time_ns: number
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
  image_url?: string | null
}

export interface DeviceTemplate {
  id: string
  name: string
  bus: string
  model: string
  image_url?: string | null
}

export interface ImportDevicePackageFile {
  path: string
  content_base64: string
}

export interface ImportedDevicePackage {
  id: string
  name: string
  version: string
  bus: string
  image_url?: string | null
}

export interface CreateDeviceInput {
  template_id: string
  device_id: string
}

export type AdapterState = 'unloaded' | 'loading' | 'loaded' | 'unloading' | 'error'
export type AdapterReadiness = 'ready' | 'authorization_required' | 'unavailable'

export interface AdapterBinding {
  device_id: string
  endpoint: number
  device_path: string
  line_names?: string[]
}

export interface Adapter {
  id: string
  name: string
  bus_type: string
  driver: string
  state: AdapterState
  readiness: AdapterReadiness
  bus_number: number
  line_count?: number | null
  max_frequency_hz?: number | null
  device_path?: string | null
  bindings: AdapterBinding[]
  daemon_pids: number[]
  error?: string
}

export interface CreateAdapterInput {
  id: string
  name: string
  bus_type: string
  bus_number?: number
  line_count?: number
  max_frequency_hz?: number
}

export interface AttachAdapterDeviceInput {
  adapterId: string
  device_id: string
  endpoint: number
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
  bitfields?: DeviceRegisterBitField[]
}

export interface WriteDeviceRegisterInput {
  deviceId: string
  address: number
  value: number
}

export interface DeviceRegisterBitField {
  name: string
  lsb: number
  width: number
  access: string
  description?: string
}

export type SpiLaneWidth = 'single' | 'dual' | 'quad'
export type SpiTransferRate = 'str' | 'dtr'

export interface DeviceCommand {
  name: string
  opcode: number
  response?: number[]
  operation?: 'register_read' | 'register_write' | 'memory_read' | 'page_program' | 'sector_erase' | 'chip_erase'
  address_bytes?: number
  register?: string
  event?: string
  event_delay_us?: number
  timing?: { latency_us: number; busy_during_operation: boolean }
  allowed_states: string[]
  shortcut?: {
    tx: number[]
    rx_length: number
    description?: string
  }
  wire?: {
    command_width: SpiLaneWidth
    address_width: SpiLaneWidth
    data_width: SpiLaneWidth
    rate: SpiTransferRate
    dummy_cycles: number
  }
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

export interface TopologyPendingDelivery {
  due_ns: number
  value: boolean
}

export interface TopologyConnection {
  /** `<device>.<signal>` */
  from: string
  /** `<device>.<line>` */
  to: string
  source_device: string
  source_signal: string
  target_device: string
  target_line: string
  delay_ns: number
  /** Last sampled source level; null until first sampled. */
  level: boolean | null
  pending: TopologyPendingDelivery[]
}

export interface Topology {
  attached: boolean
  path: string | null
  connections: TopologyConnection[]
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
  device_ids: string[]
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

export interface CoverageMetric {
  covered: number
  total: number
  /** Declared items the run did not exercise. */
  missed: string[]
}

export type CoverageMetricName = 'commands' | 'registers' | 'states' | 'transitions' | 'faults'

export type DeviceCoverage = { device_id: string } & Record<CoverageMetricName, CoverageMetric>

export interface ScenarioCoverage {
  devices: DeviceCoverage[]
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
  /** Declared device behavior the run exercised (ADR 0013). */
  coverage?: ScenarioCoverage
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
