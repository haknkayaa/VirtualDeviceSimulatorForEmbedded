import type { FlowDocument, FlowEdgeDocument } from '../../../flows/types/flow'
import { stateName, transitionEvent } from '../types/deviceBehaviorFlow'

function number(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

export function stableStates(document: FlowDocument) {
  return document.nodes
    .filter((node) => node.kind === 'device_behavior.initial_state' || node.kind === 'device_behavior.state')
    .slice()
    .sort((left, right) => stateName(left).localeCompare(stateName(right)) || left.id.localeCompare(right.id))
}

export function stableTransitions(document: FlowDocument, stateNames: Map<string, string>) {
  return document.edges
    .filter((edge) => edge.kind === 'device_behavior.transition')
    .slice()
    .sort((left, right) => compareTransition(left, right, stateNames))
}

function compareTransition(left: FlowEdgeDocument, right: FlowEdgeDocument, stateNames: Map<string, string>) {
  const source = (stateNames.get(left.source) ?? '').localeCompare(stateNames.get(right.source) ?? '')
  if (source) return source
  const priority = number(right.data.priority) - number(left.data.priority)
  if (priority) return priority
  const event = transitionEvent(left).localeCompare(transitionEvent(right))
  if (event) return event
  const target = (stateNames.get(left.target) ?? '').localeCompare(stateNames.get(right.target) ?? '')
  return target || left.id.localeCompare(right.id)
}
