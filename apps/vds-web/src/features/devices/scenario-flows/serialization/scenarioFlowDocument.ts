import { createFlowDocument } from '../../../flows/serialization/flowDocument'
import type { FlowDocument } from '../../../flows/types/flow'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'

export function createScenarioFlowDocument(options: { id?: string; name?: string; now?: string; deviceId?: string } = {}): FlowDocument {
  const document = createFlowDocument(options)
  document.flow.kind = 'scenario'
  document.metadata = { scenario: { device_id: options.deviceId ?? '', description: '', timeout_ms: 1000, continue_on_failure: false, tags: [], revision: 1 } }
  document.nodes = [
    { id: 'start', kind: SCENARIO_NODE_KINDS.start, position: { x: 80, y: 180 }, data: { label: 'Start Scenario' }, ui: {} },
    { id: 'end', kind: SCENARIO_NODE_KINDS.end, position: { x: 520, y: 180 }, data: { label: 'End Scenario' }, ui: {} },
  ]
  document.edges = [{ id: 'edge-start-end', kind: 'default', source: 'start', sourceHandle: 'out', target: 'end', targetHandle: 'in', data: {}, ui: {} }]
  return document
}
