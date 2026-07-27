import type { Device, DeviceRegister } from '../../../../types/api'
import type { FlowDocument, FlowEdgeDocument, FlowNodeDocument, ValidationIssue } from '../../../flows/types/flow'

export const BEHAVIOR_NODE_KINDS = {
  initialState: 'device_behavior.initial_state',
  state: 'device_behavior.state',
  commandTrigger: 'device_behavior.command_trigger',
  eventTrigger: 'device_behavior.event_trigger',
  guard: 'device_behavior.guard',
  delay: 'device_behavior.delay',
  setRegister: 'device_behavior.set_register',
  resetRegister: 'device_behavior.reset_register',
  emitEvent: 'device_behavior.emit_event',
  startOperation: 'device_behavior.start_operation',
  completeOperation: 'device_behavior.complete_operation',
  end: 'device_behavior.end',
  logicalNot: 'device_behavior.logical_not',
  logicalAnd: 'device_behavior.logical_and',
  logicalOr: 'device_behavior.logical_or',
  logicalNand: 'device_behavior.logical_nand',
  logicalNor: 'device_behavior.logical_nor',
  logicalXor: 'device_behavior.logical_xor',
  logicalXnor: 'device_behavior.logical_xnor',
  timer: 'device_behavior.timer',
  timeout: 'device_behavior.timeout',
  interval: 'device_behavior.interval',
  fileRead: 'device_behavior.file_read',
  fileWrite: 'device_behavior.file_write',
} as const

export const BEHAVIOR_TRANSITION_EDGE = 'device_behavior.transition'
export const BEHAVIOR_SIGNAL_EDGE = 'device_behavior.signal'
export const ACTIVE_BEHAVIOR_NODE_KINDS = new Set<string>([
  BEHAVIOR_NODE_KINDS.initialState,
  BEHAVIOR_NODE_KINDS.state,
])
export const DESIGN_BEHAVIOR_NODE_KINDS = new Set<string>([
  ...ACTIVE_BEHAVIOR_NODE_KINDS,
  BEHAVIOR_NODE_KINDS.logicalNot,
  BEHAVIOR_NODE_KINDS.logicalAnd,
  BEHAVIOR_NODE_KINDS.logicalOr,
  BEHAVIOR_NODE_KINDS.logicalNand,
  BEHAVIOR_NODE_KINDS.logicalNor,
  BEHAVIOR_NODE_KINDS.logicalXor,
  BEHAVIOR_NODE_KINDS.logicalXnor,
  BEHAVIOR_NODE_KINDS.timer,
  BEHAVIOR_NODE_KINDS.delay,
  BEHAVIOR_NODE_KINDS.timeout,
  BEHAVIOR_NODE_KINDS.interval,
  BEHAVIOR_NODE_KINDS.fileRead,
  BEHAVIOR_NODE_KINDS.fileWrite,
])
export const STATE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const TIME_UNITS = ['ns', 'us', 'ms', 's'] as const
export type TimeUnit = typeof TIME_UNITS[number]

export interface BehaviorSettings {
  device_id: string
  description: string
  revision: number
}

export interface BehaviorResourceSnapshot {
  devices?: Device[]
  registers?: DeviceRegister[]
}

export interface BehaviorStateAction {
  kind: string
  register: string
  value?: string | number
  mask?: string | number
  reset_value?: string | number
  allow_read_only_internal?: boolean
}

export interface CompilerIssue {
  code: string
  message: string
  node_id?: string
  edge_id?: string
}

export interface CompiledRegisterAction {
  set_register: {
    name: string
    value: number
    mask?: number
  }
}

export interface CompiledTransition {
  event: string
  target: string
  guard?: {
    register: {
      name: string
      equals: number
      mask?: number
    }
  }
}

export interface CompiledState {
  entry_actions?: CompiledRegisterAction[]
  exit_actions?: CompiledRegisterAction[]
  transitions?: CompiledTransition[]
  delayed_events?: { event: string; delay_us: number }[]
}

export interface CompiledDeviceBehavior {
  state_machine: {
    initial_state: string
    states: Record<string, CompiledState>
  }
  signal_graph?: {
    nodes: Record<string, Record<string, unknown>>
    edges: { source: string; target: string; target_port: string }[]
    state_roots: Record<string, { target: string; target_port: string }[]>
  }
}

export interface BehaviorCompileResult {
  document: CompiledDeviceBehavior | null
  errors: CompilerIssue[]
  warnings: CompilerIssue[]
  stateNodeMap: Record<string, string>
  transitionEdgeMap: Record<string, string>
}

export function behaviorSettings(document: FlowDocument): BehaviorSettings {
  const raw = document.metadata.behavior
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    device_id: typeof value.device_id === 'string' ? value.device_id : '',
    description: typeof value.description === 'string' ? value.description : '',
    revision: typeof value.revision === 'number' ? value.revision : document.flow.revision,
  }
}

export function stateName(node: FlowNodeDocument) {
  return typeof node.data.state_name === 'string' ? node.data.state_name.trim() : ''
}

export function transitionEvent(edge: FlowEdgeDocument) {
  return typeof edge.data.trigger === 'string' ? edge.data.trigger.trim() : ''
}

export function transitionKey(fromState: string, event: string, toState: string) {
  return `${fromState}\u0000${event}\u0000${toState}`
}

export function parseInteger(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim())) return null
  try {
    return BigInt(value.trim())
  } catch {
    return null
  }
}

export function durationToMicroseconds(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || !TIME_UNITS.includes(unit as TimeUnit)) return null
  const scale: Record<TimeUnit, bigint> = { ns: 1n, us: 1_000n, ms: 1_000_000n, s: 1_000_000_000n }
  const nanoseconds = BigInt(value) * scale[unit as TimeUnit]
  if (nanoseconds % 1_000n !== 0n) return null
  const microseconds = nanoseconds / 1_000n
  return microseconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(microseconds) : null
}

export function stateActions(node: FlowNodeDocument, field: 'entry_actions' | 'exit_actions'): BehaviorStateAction[] {
  const actions = node.data[field]
  if (!Array.isArray(actions)) return []
  return actions.flatMap((action) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return []
    const value = action as Record<string, unknown>
    return [{
      kind: typeof value.kind === 'string' ? value.kind : '',
      register: typeof value.register === 'string' ? value.register : '',
      ...(typeof value.value === 'string' || typeof value.value === 'number' ? { value: value.value } : {}),
      ...(typeof value.mask === 'string' || typeof value.mask === 'number' ? { mask: value.mask } : {}),
      ...(typeof value.reset_value === 'string' || typeof value.reset_value === 'number' ? { reset_value: value.reset_value } : {}),
      ...(typeof value.allow_read_only_internal === 'boolean' ? { allow_read_only_internal: value.allow_read_only_internal } : {}),
    }]
  })
}

export function compilerIssuesFromValidation(issues: ValidationIssue[]): CompilerIssue[] {
  return issues.map((issue) => ({
    code: issue.ruleId,
    message: issue.message,
    node_id: issue.nodeId,
    edge_id: issue.edgeId,
  }))
}
