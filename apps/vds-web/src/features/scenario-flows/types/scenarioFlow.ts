import type { FlowDocument, FlowNodeDocument, ValidationIssue } from '../../flows/types/flow'
import type { Device, DeviceRegister, Fault, ScenarioDocument } from '../../../types/api'

export const SCENARIO_NODE_KINDS = {
  start: 'scenario.start', end: 'scenario.end', resetDevice: 'scenario.reset_device', sendSpi: 'scenario.send_spi',
  advanceTime: 'scenario.advance_time', enableFault: 'scenario.enable_fault', disableFault: 'scenario.disable_fault',
  assertRegister: 'scenario.assert_register', assertState: 'scenario.assert_state', assertResponse: 'scenario.assert_response',
  assertError: 'scenario.assert_error', waitForEvent: 'scenario.wait_for_event',
} as const

export type ScenarioNodeKind = typeof SCENARIO_NODE_KINDS[keyof typeof SCENARIO_NODE_KINDS]
export const EXECUTABLE_SCENARIO_KINDS = new Set<ScenarioNodeKind>(Object.values(SCENARIO_NODE_KINDS).filter((kind) => kind !== SCENARIO_NODE_KINDS.start && kind !== SCENARIO_NODE_KINDS.end))
export const RESULT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
export const TIME_UNITS = ['ns', 'us', 'ms', 's'] as const
export type TimeUnit = typeof TIME_UNITS[number]

export interface ScenarioFlowSettings {
  description: string
  timeout_ms: number
  continue_on_failure: boolean
  tags: string[]
  revision: number
}

export interface ScenarioResourceSnapshot {
  devices?: Device[]
  registersByDevice?: Record<string, DeviceRegister[]>
  faults?: Fault[]
}

export interface CompilerIssue {
  code: string
  message: string
  node_id?: string
  edge_id?: string
}

export interface ScenarioCompileResult {
  document: ScenarioDocument | null
  errors: CompilerIssue[]
  warnings: CompilerIssue[]
  stepNodeMap: Record<string, string>
}

export interface OrderedScenarioGraph {
  nodes: FlowNodeDocument[]
  errors: CompilerIssue[]
}

export function scenarioSettings(document: FlowDocument): ScenarioFlowSettings {
  const raw = document.metadata.scenario
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    description: typeof value.description === 'string' ? value.description : '',
    timeout_ms: typeof value.timeout_ms === 'number' ? value.timeout_ms : 1_000,
    continue_on_failure: typeof value.continue_on_failure === 'boolean' ? value.continue_on_failure : false,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    revision: typeof value.revision === 'number' ? value.revision : document.flow.revision,
  }
}

export function compilerIssuesFromValidation(issues: ValidationIssue[]): CompilerIssue[] {
  return issues.map((issue) => ({ code: issue.ruleId, message: issue.message, node_id: issue.nodeId, edge_id: issue.edgeId }))
}
