import type { FlowDocument, FlowNodeDocument } from '../../flows/types/flow'
import { stableStates, stableTransitions } from './stableOrdering'
import { validateBehaviorFlow } from '../validation/behaviorFlowValidator'
import {
  BEHAVIOR_NODE_KINDS,
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
