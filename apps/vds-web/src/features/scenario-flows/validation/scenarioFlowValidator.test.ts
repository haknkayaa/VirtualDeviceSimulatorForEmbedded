import { describe, expect, it } from 'vitest'
import { createScenarioFlowDocument } from '../serialization/scenarioFlowDocument'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'
import { validateScenarioFlow } from './scenarioFlowValidator'

describe('scenario flow validation', () => {
  it('reports missing boundaries, branches, cycles and disconnected executable nodes', () => {
    const missing = createScenarioFlowDocument(); missing.nodes = []; missing.edges = []
    expect(validateScenarioFlow(missing).map((item) => item.ruleId)).toEqual(expect.arrayContaining(['scenario-missing-start', 'scenario-missing-end']))
    const graph = createScenarioFlowDocument(); graph.nodes.splice(1, 0,
      { id: 'a', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 0, y: 0 }, data: { label: 'A', device_id: 'd' }, ui: {} },
      { id: 'b', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 0, y: 0 }, data: { label: 'B', device_id: 'd' }, ui: {} },
      { id: 'orphan', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 0, y: 0 }, data: { label: 'Orphan', device_id: 'd' }, ui: {} })
    graph.edges = [
      { id: 'sa', kind: 'default', source: 'start', sourceHandle: 'out', target: 'a', targetHandle: 'in', data: {}, ui: {} },
      { id: 'sb', kind: 'default', source: 'start', sourceHandle: 'out', target: 'b', targetHandle: 'in', data: {}, ui: {} },
      { id: 'ae', kind: 'default', source: 'a', sourceHandle: 'out', target: 'end', targetHandle: 'in', data: {}, ui: {} },
    ]
    expect(validateScenarioFlow(graph).map((item) => item.ruleId)).toEqual(expect.arrayContaining(['start-outgoing', 'disconnected-executable']))
  })

  it('validates parameters and REST resource snapshots without clearing values', () => {
    const document = createScenarioFlowDocument(); document.nodes.splice(1, 0, { id: 'spi', kind: SCENARIO_NODE_KINDS.sendSpi, position: { x: 0, y: 0 }, data: { label: 'SPI', device_id: 'gone', tx_hex: '9' }, ui: {} }); document.edges = [
      { id: 'a', kind: 'default', source: 'start', sourceHandle: 'out', target: 'spi', targetHandle: 'in', data: {}, ui: {} },
      { id: 'b', kind: 'default', source: 'spi', sourceHandle: 'out', target: 'end', targetHandle: 'in', data: {}, ui: {} },
    ]
    const rules = validateScenarioFlow(document, { devices: [] }).map((item) => item.ruleId)
    expect(rules).toEqual(expect.arrayContaining(['scenario-invalid-spi-hex', 'scenario-missing-device-resource']))
    expect(document.nodes[1].data.device_id).toBe('gone')
  })

  it('reports executable cycles as blocking scenario errors', () => {
    const graph = createScenarioFlowDocument(); graph.nodes.splice(1, 0,
      { id: 'a', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 0, y: 0 }, data: { label: 'A', device_id: 'd' }, ui: {} },
      { id: 'b', kind: SCENARIO_NODE_KINDS.resetDevice, position: { x: 0, y: 0 }, data: { label: 'B', device_id: 'd' }, ui: {} })
    graph.edges = [
      { id: 'sa', kind: 'default', source: 'start', sourceHandle: 'out', target: 'a', targetHandle: 'in', data: {}, ui: {} },
      { id: 'ab', kind: 'default', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in', data: {}, ui: {} },
      { id: 'ba', kind: 'default', source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in', data: {}, ui: {} },
    ]
    expect(validateScenarioFlow(graph).map((item) => item.ruleId)).toContain('scenario-cycle')
  })
})
