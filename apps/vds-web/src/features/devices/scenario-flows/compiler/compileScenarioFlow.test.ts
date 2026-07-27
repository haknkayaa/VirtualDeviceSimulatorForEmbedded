import { describe, expect, it } from 'vitest'

import type { FlowDocument, FlowNodeDocument } from '../../../flows/types/flow'
import { compileScenarioFlow, serializeCompiledScenario } from './compileScenarioFlow'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'

const data = (kind: string): Record<string, string | number> => ({
  [SCENARIO_NODE_KINDS.resetDevice]: { label: 'Reset', device_id: 'dev' },
  [SCENARIO_NODE_KINDS.sendSpi]: { label: 'SPI', device_id: 'dev', tx_hex: '9f', save_as: 'read_id' },
  [SCENARIO_NODE_KINDS.advanceTime]: { label: 'Time', duration: 5, unit: 'ms' },
  [SCENARIO_NODE_KINDS.enableFault]: { label: 'Enable', fault_id: 'fault' },
  [SCENARIO_NODE_KINDS.disableFault]: { label: 'Disable', fault_id: 'fault' },
  [SCENARIO_NODE_KINDS.assertRegister]: { label: 'Register', device_id: 'dev', register: 'STATUS', expected: '0x1' },
  [SCENARIO_NODE_KINDS.assertState]: { label: 'State', device_id: 'dev', expected_state: 'ready' },
  [SCENARIO_NODE_KINDS.assertResponse]: { label: 'Response', source: 'read_id', expected_hex: 'EF 40 18' },
  [SCENARIO_NODE_KINDS.assertError]: { label: 'Error', source: 'read_id', expected_code: 'fault_timeout' },
  [SCENARIO_NODE_KINDS.waitForEvent]: { label: 'Event', event_type: 'state_transition', timeout: 10, timeout_unit: 'ms' },
} as Record<string, Record<string, string | number>>)[kind]

function flow(kinds: string[] = [SCENARIO_NODE_KINDS.resetDevice, SCENARIO_NODE_KINDS.advanceTime, SCENARIO_NODE_KINDS.sendSpi, SCENARIO_NODE_KINDS.assertResponse]): FlowDocument {
  const nodes: FlowNodeDocument[] = [{ id: 'start', kind: SCENARIO_NODE_KINDS.start, position: { x: 0, y: 0 }, data: { label: 'Start' }, ui: {} }]
  kinds.forEach((kind, index) => nodes.push({ id: `node-${index}`, kind, position: { x: index * 100, y: index * 30 }, data: { ...data(kind), step_id: `step-${index}` }, ui: {} }))
  nodes.push({ id: 'end', kind: SCENARIO_NODE_KINDS.end, position: { x: 900, y: 0 }, data: { label: 'End' }, ui: {} })
  return { schema_version: 1, flow: { id: 'visual_scenario', name: 'Visual Scenario', kind: 'scenario', revision: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }, nodes, edges: nodes.slice(0, -1).map((node, index) => ({ id: `edge-${index}`, kind: 'default', source: node.id, sourceHandle: 'out', target: nodes[index + 1].id, targetHandle: 'in', data: {}, ui: {} })), viewport: { x: 0, y: 0, zoom: 1 }, metadata: { scenario: { timeout_ms: 1000, continue_on_failure: false, description: '', tags: [], revision: 1 } } }
}

describe('scenario flow compiler', () => {
  it('compiles deterministically and ignores positions and edge insertion order', () => {
    const source = flow(); const before = structuredClone(source)
    const first = compileScenarioFlow(source)
    const changed = structuredClone(source); changed.nodes.forEach((node) => { node.position.x += 999 }); changed.edges.reverse()
    const second = compileScenarioFlow(changed)
    expect(first.errors).toEqual([])
    expect(serializeCompiledScenario(first.document!)).toBe(serializeCompiledScenario(second.document!))
    expect(source).toEqual(before)
    expect(first.document?.steps.map((step) => step.action)).toEqual(['reset_device', 'advance_time', 'send_spi', 'assert_response'])
    expect(first.document?.steps.some((step) => step.action === 'scenario.start' || step.action === 'scenario.end')).toBe(false)
  })

  it('maps all ten runtime step types', () => {
    const result = compileScenarioFlow(flow([
      SCENARIO_NODE_KINDS.resetDevice, SCENARIO_NODE_KINDS.sendSpi, SCENARIO_NODE_KINDS.advanceTime,
      SCENARIO_NODE_KINDS.enableFault, SCENARIO_NODE_KINDS.disableFault, SCENARIO_NODE_KINDS.assertRegister,
      SCENARIO_NODE_KINDS.assertState, SCENARIO_NODE_KINDS.assertResponse, SCENARIO_NODE_KINDS.assertError,
      SCENARIO_NODE_KINDS.waitForEvent,
    ]))
    expect(result.errors).toEqual([])
    expect(result.document?.steps.map((step) => step.action)).toEqual(['reset_device', 'send_spi', 'advance_time', 'enable_fault', 'disable_fault', 'assert_register', 'assert_state', 'assert_response', 'assert_error', 'wait_for_event'])
    expect(Object.keys(result.stepNodeMap)).toHaveLength(10)
  })

  it('rejects forward result references and non-representable time', () => {
    const forward = flow([SCENARIO_NODE_KINDS.assertResponse, SCENARIO_NODE_KINDS.sendSpi])
    expect(compileScenarioFlow(forward).errors.map((item) => item.code)).toContain('unknown-or-forward-result')
    const time = flow([SCENARIO_NODE_KINDS.advanceTime]); time.nodes[1].data = { label: 'tiny', duration: 1, unit: 'us' }
    expect(compileScenarioFlow(time).errors.map((item) => item.code)).toContain('time-not-representable')
  })

  it('generates stable result and step identifiers when absent', () => {
    const source = flow([SCENARIO_NODE_KINDS.sendSpi]); delete source.nodes[1].data.step_id; delete source.nodes[1].data.save_as
    const result = compileScenarioFlow(source)
    expect(result.document?.steps[0]).toMatchObject({ id: 'node-0', save_as: 'result_node_0' })
    expect(result.warnings.map((item) => item.code)).toContain('generated-result-name')
  })
})
