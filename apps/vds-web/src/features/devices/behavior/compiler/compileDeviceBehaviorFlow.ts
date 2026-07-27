import type { FlowDocument, FlowNodeDocument } from '../../../flows/types/flow'
import { stableStates, stableTransitions } from './stableOrdering'
import { validateBehaviorFlow } from '../validation/behaviorFlowValidator'
import {
  BEHAVIOR_NODE_KINDS,
  BEHAVIOR_SIGNAL_EDGE,
  compilerIssuesFromValidation,
  durationToMicroseconds,
  parseInteger,
  stateActions,
  stateName,
  transitionEvent,
  transitionKey,
  type BehaviorCompileResult,
  type BehaviorResourceSnapshot,
  type CompiledRegisterAction,
  type CompilerIssue,
} from '../types/deviceBehaviorFlow'

const signalKinds = new Set<string>([
  BEHAVIOR_NODE_KINDS.logicalNot, BEHAVIOR_NODE_KINDS.logicalAnd, BEHAVIOR_NODE_KINDS.logicalOr,
  BEHAVIOR_NODE_KINDS.logicalNand, BEHAVIOR_NODE_KINDS.logicalNor, BEHAVIOR_NODE_KINDS.logicalXor,
  BEHAVIOR_NODE_KINDS.logicalXnor, BEHAVIOR_NODE_KINDS.timer, BEHAVIOR_NODE_KINDS.delay,
  BEHAVIOR_NODE_KINDS.timeout, BEHAVIOR_NODE_KINDS.interval, BEHAVIOR_NODE_KINDS.fileRead,
  BEHAVIOR_NODE_KINDS.fileWrite,
])

function compileSignalGraph(document: FlowDocument, stateNames: Map<string, string>) {
  const nodes = Object.fromEntries(document.nodes.filter((node) => signalKinds.has(node.kind)).map((node) => {
    const kind = node.kind.replace('device_behavior.', '')
    const data = node.data
    if (['timer', 'delay', 'timeout', 'interval'].includes(kind)) {
      const microseconds = durationToMicroseconds(data.duration, data.unit)
      return [node.id, { kind, duration_ns: (microseconds ?? 0) * 1_000 }]
    }
    if (kind === 'file_read') return [node.id, { kind, path: data.path, format: data.format, offset: data.offset ?? 0, length: data.length ?? null }]
    if (kind === 'file_write') return [node.id, { kind, path: data.path, format: data.format, mode: data.mode, create: data.create !== false }]
    return [node.id, { kind }]
  }))
  const signalEdges = document.edges.filter((edge) => edge.kind === BEHAVIOR_SIGNAL_EDGE)
  const stateRoots: Record<string, { target: string; target_port: string }[]> = {}
  const edges: { source: string; target: string; target_port: string }[] = []
  signalEdges.forEach((edge) => {
    const state = stateNames.get(edge.source)
    const targetPort = edge.targetHandle ?? 'in'
    if (state) (stateRoots[state] ??= []).push({ target: edge.target, target_port: targetPort })
    else edges.push({ source: edge.source, target: edge.target, target_port: targetPort })
  })
  return Object.keys(nodes).length ? { nodes, edges, state_roots: stateRoots } : undefined
}

function safeNumber(value: unknown): number | null {
  const parsed = parseInteger(value)
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null
}

function compileActions(
  node: FlowNodeDocument,
  field: 'entry_actions' | 'exit_actions',
  errors: CompilerIssue[],
): CompiledRegisterAction[] {
  return stateActions(node, field).flatMap((action) => {
    if (!['set_register', 'reset_register'].includes(action.kind)) return []
    const value = safeNumber(action.kind === 'reset_register' ? action.reset_value : action.value)
    const mask = action.mask === undefined || action.mask === '' ? undefined : safeNumber(action.mask)
    if (!action.register || value === null || (action.mask !== undefined && action.mask !== '' && mask === null)) {
      errors.push({ code: 'unrepresentable-register-action', message: `State ${stateName(node) || node.id} has a register action that cannot be represented safely.`, node_id: node.id })
      return []
    }
    return [{ set_register: { name: action.register, value, ...(typeof mask === 'number' ? { mask } : {}) } }]
  })
}

export function compileDeviceBehaviorFlow(
  document: FlowDocument,
  resources: BehaviorResourceSnapshot = {},
): BehaviorCompileResult {
  const source = structuredClone(document)
  const validation = validateBehaviorFlow(source, resources)
  const errors = compilerIssuesFromValidation(validation.filter((issue) => issue.severity === 'error'))
  const warnings = compilerIssuesFromValidation(validation.filter((issue) => issue.severity === 'warning'))
  if (source.flow.kind !== 'device_behavior') errors.push({ code: 'wrong-flow-kind', message: 'Only flow.kind=device_behavior can be compiled.' })

  const states = stableStates(source)
  const initial = states.filter((node) => node.kind === BEHAVIOR_NODE_KINDS.initialState)
  const stateNames = new Map(states.map((node) => [node.id, stateName(node)]))
  const transitions = stableTransitions(source, stateNames)
  const stateNodeMap = Object.fromEntries(states.filter((node) => stateName(node)).map((node) => [stateName(node), node.id]))
  const transitionEdgeMap: Record<string, string> = {}
  const compiledStates: NonNullable<BehaviorCompileResult['document']>['state_machine']['states'] = {}
  const signalGraph = compileSignalGraph(source, stateNames)

  for (const node of states) {
    const name = stateName(node)
    if (!name) continue
    const entryActions = compileActions(node, 'entry_actions', errors)
    const exitActions = compileActions(node, 'exit_actions', errors)
    const compiledTransitions = []
    const delayedEvents = []
    for (const edge of transitions.filter((candidate) => candidate.source === node.id)) {
      const event = transitionEvent(edge)
      const target = stateNames.get(edge.target) ?? ''
      if (!event || !target) continue
      const transition: {
        event: string
        target: string
        guard?: { register: { name: string; equals: number; mask?: number } }
      } = { event, target }
      if (edge.data.guard_enabled === true) {
        const register = typeof edge.data.guard_register === 'string' ? edge.data.guard_register.trim() : ''
        const equals = safeNumber(edge.data.guard_equals)
        const mask = edge.data.guard_mask === '' || edge.data.guard_mask === null || edge.data.guard_mask === undefined
          ? undefined
          : safeNumber(edge.data.guard_mask)
        if (register && equals !== null && mask !== null) {
          transition.guard = { register: { name: register, equals, ...(mask === undefined ? {} : { mask }) } }
        }
      }
      compiledTransitions.push(transition)
      transitionEdgeMap[transitionKey(name, event, target)] = edge.id

      if (typeof edge.data.delay_value === 'number' && edge.data.delay_value > 0) {
        const delayUs = durationToMicroseconds(edge.data.delay_value, edge.data.delay_unit)
        if (delayUs !== null) delayedEvents.push({ event, delay_us: delayUs })
      }
      if (edge.data.trigger_type === 'command') {
        warnings.push({
          code: 'command-event-contract',
          message: `Command trigger ${event} compiles to the existing runtime event field; the command handler must already dispatch that event.`,
          edge_id: edge.id,
        })
      }
    }
    compiledStates[name] = {
      ...(entryActions.length ? { entry_actions: entryActions } : {}),
      ...(exitActions.length ? { exit_actions: exitActions } : {}),
      ...(compiledTransitions.length ? { transitions: compiledTransitions } : {}),
      ...(delayedEvents.length ? { delayed_events: delayedEvents } : {}),
    }
  }

  if (errors.length || initial.length !== 1) return { document: null, errors, warnings, stateNodeMap, transitionEdgeMap }
  return {
    document: {
      state_machine: {
        initial_state: stateName(initial[0]),
        states: compiledStates,
      },
      ...(signalGraph ? { signal_graph: signalGraph } : {}),
    },
    errors,
    warnings,
    stateNodeMap,
    transitionEdgeMap,
  }
}

export function serializeCompiledDeviceBehavior(document: NonNullable<BehaviorCompileResult['document']>) {
  return `${JSON.stringify(document, null, 2)}\n`
}
