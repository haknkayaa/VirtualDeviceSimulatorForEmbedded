import type { FlowEdgeDocument, FlowValidationRule, ValidationIssue } from '../../flows/types/flow'
import {
  ACTIVE_BEHAVIOR_NODE_KINDS,
  BEHAVIOR_NODE_KINDS,
  BEHAVIOR_TRANSITION_EDGE,
  STATE_NAME_PATTERN,
  durationToMicroseconds,
  parseInteger,
  stateName,
  transitionEvent,
} from '../types/deviceBehaviorFlow'

const error = (ruleId: string, message: string, target: { nodeId?: string; edgeId?: string } = {}): ValidationIssue => ({
  ruleId,
  severity: 'error',
  message,
  ...target,
})
const warning = (ruleId: string, message: string, target: { nodeId?: string; edgeId?: string } = {}): ValidationIssue => ({
  ruleId,
  severity: 'warning',
  message,
  ...target,
})
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

function guardSignature(edge: FlowEdgeDocument) {
  return [
    text(edge.data.guard_register),
    String(edge.data.guard_equals ?? ''),
    String(edge.data.guard_mask ?? ''),
  ].join(':')
}

export const behaviorGraphRule: FlowValidationRule = ({ document }) => {
  if (document.flow.kind !== 'device_behavior') return []
  const issues: ValidationIssue[] = []
  const initial = document.nodes.filter((node) => node.kind === BEHAVIOR_NODE_KINDS.initialState)
  if (initial.length === 0) issues.push(error('behavior-missing-initial', 'Device behavior requires exactly one Initial State.'))
  if (initial.length > 1) issues.push(error('behavior-multiple-initial', 'Device behavior has multiple Initial State nodes.'))

  const states = document.nodes.filter((node) => ACTIVE_BEHAVIOR_NODE_KINDS.has(node.kind))
  const names = new Map<string, string>()
  states.forEach((node) => {
    const name = stateName(node)
    if (!name) issues.push(error('behavior-empty-state-name', 'State name is required.', { nodeId: node.id }))
    else if (!STATE_NAME_PATTERN.test(name)) issues.push(error('behavior-invalid-state-name', 'State names must match [A-Za-z_][A-Za-z0-9_]*.', { nodeId: node.id }))
    else if (names.has(name)) issues.push(error('behavior-duplicate-state-name', `State name ${name} is already used by ${names.get(name)}.`, { nodeId: node.id }))
    else names.set(name, node.id)
  })
  document.nodes
    .filter((node) => node.kind.startsWith('device_behavior.') && !ACTIVE_BEHAVIOR_NODE_KINDS.has(node.kind))
    .forEach((node) => issues.push(error('behavior-mixed-graph-model', `${node.kind} is reserved metadata in edge-centric v1; configure trigger, guard, delay, and actions in state/transition inspectors.`, { nodeId: node.id })))

  const stateIds = new Set(states.map((node) => node.id))
  const transitions = document.edges.filter((edge) => edge.kind === BEHAVIOR_TRANSITION_EDGE)
  transitions.forEach((edge) => {
    if (!stateIds.has(edge.source) || !stateIds.has(edge.target)) {
      issues.push(error('behavior-transition-endpoint', 'Behavior transitions must connect State or Initial State nodes.', { edgeId: edge.id }))
    }
    const trigger = transitionEvent(edge)
    if (!trigger) issues.push(error('behavior-empty-trigger', 'Transition trigger is required.', { edgeId: edge.id }))
    const triggerType = text(edge.data.trigger_type)
    if (!['event', 'command'].includes(triggerType)) issues.push(error('behavior-invalid-trigger-type', 'Trigger type must be event or command.', { edgeId: edge.id }))
    const delay = edge.data.delay_value
    if (delay !== null && delay !== undefined && durationToMicroseconds(delay, edge.data.delay_unit) === null) {
      issues.push(error('behavior-invalid-delay', 'Delay must be a positive integer exactly representable in runtime microseconds.', { edgeId: edge.id }))
    }
    if (triggerType === 'command' && typeof delay === 'number' && delay > 0) {
      issues.push(error('behavior-command-delay-unsupported', 'Current runtime delayed events are state-entry events and cannot delay a command trigger.', { edgeId: edge.id }))
    }
    if (edge.data.guard_enabled === true) {
      if (!text(edge.data.guard_register)) issues.push(error('behavior-guard-register', 'Register guard requires a register.', { edgeId: edge.id }))
      if (parseInteger(edge.data.guard_equals) === null) issues.push(error('behavior-unsupported-guard', 'Current runtime guard requires a non-negative register equals value.', { edgeId: edge.id }))
      if (edge.data.guard_mask !== '' && edge.data.guard_mask !== null && edge.data.guard_mask !== undefined && parseInteger(edge.data.guard_mask) === null) {
        issues.push(error('behavior-unsupported-guard', 'Guard mask must be a non-negative integer.', { edgeId: edge.id }))
      }
    }
    if (typeof edge.data.priority !== 'number' || !Number.isSafeInteger(edge.data.priority)) {
      issues.push(error('behavior-invalid-priority', 'Transition priority must be an integer.', { edgeId: edge.id }))
    }
  })

  states.filter((node) => node.data.terminal === true).forEach((node) => {
    if (transitions.some((edge) => edge.source === node.id)) {
      issues.push(error('behavior-terminal-outgoing', `Terminal state ${stateName(node)} cannot have outgoing transitions.`, { nodeId: node.id }))
    }
  })

  const incoming = new Set(transitions.map((edge) => edge.target))
  states.filter((node) => node.kind !== BEHAVIOR_NODE_KINDS.initialState && !incoming.has(node.id))
    .forEach((node) => issues.push(warning('behavior-no-incoming', `State ${stateName(node) || node.id} has no incoming transition.`, { nodeId: node.id })))

  if (initial.length === 1) {
    const adjacency = new Map(states.map((node) => [node.id, [] as string[]]))
    transitions.forEach((edge) => adjacency.get(edge.source)?.push(edge.target))
    const reachable = new Set<string>()
    const visit = (id: string) => {
      if (reachable.has(id)) return
      reachable.add(id)
      adjacency.get(id)?.forEach(visit)
    }
    visit(initial[0].id)
    states.filter((node) => !reachable.has(node.id))
      .forEach((node) => issues.push(warning('behavior-unreachable-state', `State ${stateName(node) || node.id} is unreachable from the initial state.`, { nodeId: node.id })))
  }

  const conflicts = new Map<string, FlowEdgeDocument>()
  transitions.forEach((edge) => {
    const priority = typeof edge.data.priority === 'number' ? edge.data.priority : 0
    const signature = `${edge.source}\u0000${transitionEvent(edge)}\u0000${guardSignature(edge)}\u0000${priority}`
    const previous = conflicts.get(signature)
    if (previous && previous.target !== edge.target) {
      issues.push(error('behavior-conflicting-transition', `Transitions ${previous.id} and ${edge.id} have the same trigger, guard, and priority but different targets.`, { edgeId: edge.id }))
    } else {
      conflicts.set(signature, edge)
    }
  })
  return issues
}

export const behaviorFlowRules: FlowValidationRule[] = [behaviorGraphRule]
