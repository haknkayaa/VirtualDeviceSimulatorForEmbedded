export interface ApiErrorBody {
  code: string
  message: string
}

export interface Health {
  status: 'ok' | string
}

export interface Device {
  id: string
  bus: string
  state: string | null
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
