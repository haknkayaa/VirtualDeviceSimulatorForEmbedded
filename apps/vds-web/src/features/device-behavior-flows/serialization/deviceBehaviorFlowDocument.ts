import { createFlowDocument } from '../../flows/serialization/flowDocument'
import type { FlowDocument, FlowEdgeDocument, FlowNodeDocument, JsonValue } from '../../flows/types/flow'
import { BEHAVIOR_NODE_KINDS, BEHAVIOR_TRANSITION_EDGE } from '../types/deviceBehaviorFlow'

const state = (id: string, stateName: string, x: number, initial = false, entryActions: JsonValue[] = []): FlowNodeDocument => ({
  id,
  kind: initial ? BEHAVIOR_NODE_KINDS.initialState : BEHAVIOR_NODE_KINDS.state,
  position: { x, y: 180 },
  data: { label: stateName, state_name: stateName, description: '', terminal: false, entry_actions: entryActions, exit_actions: [] },
  ui: {},
})

const transition = (id: string, source: string, target: string, trigger: string, extra: Record<string, unknown> = {}): FlowEdgeDocument => ({
  id,
  kind: BEHAVIOR_TRANSITION_EDGE,
  source,
  sourceHandle: 'out',
  target,
  targetHandle: 'in',
  data: { trigger_type: 'event', trigger, priority: 0, guard_enabled: false, delay_value: null, delay_unit: 'ms', ...extra },
  ui: {},
})

export function createDeviceBehaviorFlowDocument(options: { id?: string; name?: string; now?: string } = {}): FlowDocument {
  const document = createFlowDocument(options)
  document.flow.kind = 'device_behavior'
  document.metadata = {
    allow_cycles: true,
    default_edge_kind: BEHAVIOR_TRANSITION_EDGE,
    behavior: { device_id: '', description: '', revision: 1 },
  }
  document.nodes = [state('initial-resetting', 'resetting', 80, true), state('state-ready', 'ready', 420)]
  document.edges = [transition('transition-reset-complete', 'initial-resetting', 'state-ready', 'reset_complete')]
  return document
}

const now = '2026-01-01T00:00:00.000Z'
export const exampleDeviceBehaviorFlow: FlowDocument = {
  ...createDeviceBehaviorFlowDocument({ id: 'example-generic-device-behavior', name: 'Generic Busy Device', now }),
  nodes: [
    state('initial-resetting', 'resetting', 40, true, [{ kind: 'set_register', register: 'STATUS', value: '0x1', mask: '0x1', allow_read_only_internal: true }]),
    state('state-ready', 'ready', 380, false, [{ kind: 'set_register', register: 'STATUS', value: '0x0', mask: '0x1', allow_read_only_internal: true }]),
    state('state-busy', 'busy', 720, false, [{ kind: 'set_register', register: 'STATUS', value: '0x1', mask: '0x1', allow_read_only_internal: true }]),
  ],
  edges: [
    transition('transition-reset-ready', 'initial-resetting', 'state-ready', 'reset_complete', { delay_value: 5, delay_unit: 'ms' }),
    transition('transition-ready-busy', 'state-ready', 'state-busy', 'write_started'),
    transition('transition-busy-ready', 'state-busy', 'state-ready', 'operation_completed'),
  ],
  viewport: { x: 0, y: 0, zoom: .85 },
  metadata: {
    allow_cycles: true,
    default_edge_kind: BEHAVIOR_TRANSITION_EDGE,
    example: true,
    behavior: { device_id: '', description: 'Safe generic reset/ready/busy state-machine example.', revision: 1 },
  },
}
