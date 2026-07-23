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

const flashStateNames = ['powered_off', 'resetting', 'ready', 'write_enabled', 'programming', 'erasing', 'deep_power_down', 'error']
const flashStatePositions: Record<string, { x: number; y: number }> = {
  powered_off: { x: 20, y: 40 }, resetting: { x: 300, y: 40 }, ready: { x: 600, y: 220 },
  write_enabled: { x: 900, y: 220 }, programming: { x: 1200, y: 80 }, erasing: { x: 1200, y: 360 },
  deep_power_down: { x: 600, y: 500 }, error: { x: 900, y: 500 },
}
const flashActions: Record<string, JsonValue[]> = {
  resetting: [{ kind: 'set_register', register: 'STATUS1', value: '0x01', mask: '0x03', allow_read_only_internal: true }],
  ready: [{ kind: 'set_register', register: 'STATUS1', value: '0x00', mask: '0x03', allow_read_only_internal: true }],
  write_enabled: [{ kind: 'set_register', register: 'STATUS1', value: '0x02', mask: '0x03', allow_read_only_internal: true }],
  programming: [{ kind: 'set_register', register: 'STATUS1', value: '0x01', mask: '0x03', allow_read_only_internal: true }],
  erasing: [{ kind: 'set_register', register: 'STATUS1', value: '0x01', mask: '0x03', allow_read_only_internal: true }],
  deep_power_down: [{ kind: 'set_register', register: 'STATUS1', value: '0x00', mask: '0x03', allow_read_only_internal: true }],
  error: [{ kind: 'set_register', register: 'STATUS1', value: '0x01', mask: '0x01', allow_read_only_internal: true }],
}
const flashTransitions = [
  ['powered_off', 'resetting', 'power_on', 'event'],
  ['resetting', 'ready', 'reset_complete', 'event'],
  ['ready', 'write_enabled', 'write_enable', 'command'],
  ['write_enabled', 'ready', 'write_disable', 'command'],
  ['write_enabled', 'programming', 'page_program', 'command'],
  ['programming', 'ready', 'operation_completed', 'event'],
  ['write_enabled', 'erasing', 'sector_erase', 'command'],
  ['erasing', 'ready', 'operation_completed', 'event'],
  ['ready', 'deep_power_down', 'deep_power_down', 'command'],
  ['deep_power_down', 'ready', 'release_power_down', 'command'],
  ...['resetting', 'ready', 'write_enabled', 'programming', 'erasing', 'deep_power_down', 'error'].map((source) => [source, 'resetting', 'reset', 'command']),
] as string[][]

export const genericSpiFlashBehaviorFlow: FlowDocument = {
  schema_version: 1,
  flow: { id: 'generic-spi-flash-128m-behavior', name: 'Generic SPI Flash 128 Mbit', kind: 'device_behavior', revision: 1, created_at: now, updated_at: now },
  nodes: flashStateNames.map((name) => ({
    id: `state-${name.replaceAll('_', '-')}`,
    kind: name === 'resetting' ? BEHAVIOR_NODE_KINDS.initialState : BEHAVIOR_NODE_KINDS.state,
    position: flashStatePositions[name],
    data: { label: name.replaceAll('_', ' '), state_name: name, description: '', terminal: false, entry_actions: flashActions[name] ?? [], exit_actions: [] },
    ui: {},
  })),
  edges: flashTransitions.map(([source, target, trigger, triggerType], index) => transition(
    `transition-${index.toString().padStart(2, '0')}-${source}-${target}`,
    `state-${source.replaceAll('_', '-')}`,
    `state-${target.replaceAll('_', '-')}`,
    trigger,
    {
      trigger_type: triggerType,
      ...(source === 'resetting' && target === 'ready' ? { delay_value: 5, delay_unit: 'ms' } : {}),
    },
  )),
  viewport: { x: 0, y: 0, zoom: .62 },
  metadata: {
    allow_cycles: true,
    default_edge_kind: BEHAVIOR_TRANSITION_EDGE,
    example: true,
    source_model: 'device-models/examples/generic-spi-flash/model.yaml',
    behavior: { device_id: 'generic-spi-flash-128m', description: 'Public-safe 128 Mbit SPI flash reference behavior.', revision: 1 },
  },
}
