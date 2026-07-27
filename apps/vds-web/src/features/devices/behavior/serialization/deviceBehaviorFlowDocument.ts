import { createFlowDocument } from '../../../flows/serialization/flowDocument'
import type { FlowDocument } from '../../../flows/types/flow'
import { BEHAVIOR_NODE_KINDS, BEHAVIOR_TRANSITION_EDGE } from '../types/deviceBehaviorFlow'

export function createDeviceBehaviorFlowDocument(options: { id?: string; name?: string; now?: string; deviceId?: string } = {}): FlowDocument {
  const document = createFlowDocument(options)
  document.flow.kind = 'device_behavior'
  document.metadata = {
    allow_cycles: true,
    default_edge_kind: BEHAVIOR_TRANSITION_EDGE,
    behavior: { device_id: options.deviceId ?? '', description: '', revision: 1 },
  }
  document.nodes = [
    {
      id: 'initial-resetting',
      kind: BEHAVIOR_NODE_KINDS.initialState,
      position: { x: 80, y: 180 },
      data: { label: 'resetting', state_name: 'resetting', description: '', terminal: false, entry_actions: [], exit_actions: [] },
      ui: {},
    },
    {
      id: 'state-ready',
      kind: BEHAVIOR_NODE_KINDS.state,
      position: { x: 420, y: 180 },
      data: { label: 'ready', state_name: 'ready', description: '', terminal: false, entry_actions: [], exit_actions: [] },
      ui: {},
    },
  ]
  document.edges = [{
    id: 'transition-reset-complete',
    kind: BEHAVIOR_TRANSITION_EDGE,
    source: 'initial-resetting',
    sourceHandle: 'out',
    target: 'state-ready',
    targetHandle: 'in',
    data: { trigger_type: 'event', trigger: 'reset_complete', priority: 0, guard_enabled: false, delay_value: null, delay_unit: 'ms' },
    ui: {},
  }]
  return document
}
