import { createFlowDocument } from '../../flows/serialization/flowDocument'
import type { FlowDocument } from '../../flows/types/flow'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'

export function createScenarioFlowDocument(options: { id?: string; name?: string; now?: string } = {}): FlowDocument {
  const document = createFlowDocument(options)
  document.flow.kind = 'scenario'
  document.metadata = { scenario: { description: '', timeout_ms: 1000, continue_on_failure: false, tags: [], revision: 1 } }
  document.nodes = [
    { id: 'start', kind: SCENARIO_NODE_KINDS.start, position: { x: 80, y: 180 }, data: { label: 'Start Scenario' }, ui: {} },
    { id: 'end', kind: SCENARIO_NODE_KINDS.end, position: { x: 520, y: 180 }, data: { label: 'End Scenario' }, ui: {} },
  ]
  document.edges = [{ id: 'edge-start-end', kind: 'default', source: 'start', sourceHandle: 'out', target: 'end', targetHandle: 'in', data: {}, ui: {} }]
  return document
}

const now = '2026-01-01T00:00:00.000Z'
export const exampleScenarioFlow: FlowDocument = {
  schema_version: 1,
  flow: { id: 'example-read-id-scenario', name: 'Safe READ ID Scenario', kind: 'scenario', revision: 1, created_at: now, updated_at: now },
  nodes: [
    { id: 'start', kind: SCENARIO_NODE_KINDS.start, position: { x: 20, y: 140 }, data: { label: 'Start' }, ui: {} },
    { id: 'reset', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 280, y: 140 }, data: { label: 'Reset Device', device_id: 'spi-flash-0', step_id: 'reset' }, ui: {} },
    { id: 'settle', kind: SCENARIO_NODE_KINDS.advanceTime, position: { x: 540, y: 140 }, data: { label: 'Advance 5 ms', duration: 5, unit: 'ms', step_id: 'complete_reset' }, ui: {} },
    { id: 'read-id', kind: SCENARIO_NODE_KINDS.sendSpi, position: { x: 800, y: 140 }, data: { label: 'Read Device ID', device_id: 'spi-flash-0', tx_hex: '9F', save_as: 'read_id_result', step_id: 'read_id' }, ui: {} },
    { id: 'assert-id', kind: SCENARIO_NODE_KINDS.assertResponse, position: { x: 1060, y: 140 }, data: { label: 'Assert Device ID', source: 'read_id_result', expected_hex: 'EF 40 18', step_id: 'assert_read_id' }, ui: {} },
    { id: 'end', kind: SCENARIO_NODE_KINDS.end, position: { x: 1320, y: 140 }, data: { label: 'End' }, ui: {} },
  ],
  edges: ['start:reset', 'reset:settle', 'settle:read-id', 'read-id:assert-id', 'assert-id:end'].map((pair) => {
    const [source, target] = pair.split(':')
    return { id: `edge-${source}-${target}`, kind: 'default', source, sourceHandle: 'out', target, targetHandle: 'in', data: {}, ui: {} }
  }),
  viewport: { x: 0, y: 0, zoom: .8 },
  metadata: { example: true, scenario: { description: 'Uses the public example SPI flash model.', timeout_ms: 1000, continue_on_failure: false, tags: ['example'], revision: 1 } },
}
