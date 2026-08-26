import { createFlowDocument } from '../../../flows/serialization/flowDocument'
import type { FlowDocument, FlowNodeDocument, JsonObject } from '../../../flows/types/flow'
import type { ScenarioDocument, ScenarioStep } from '../../../../types/api'
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

const actionNodes: Record<string, { kind: string; label: string }> = {
  reset_device: { kind: SCENARIO_NODE_KINDS.resetDevice, label: 'Reset Device' },
  send_spi: { kind: SCENARIO_NODE_KINDS.sendSpi, label: 'Send SPI' },
  advance_time: { kind: SCENARIO_NODE_KINDS.advanceTime, label: 'Advance Time' },
  enable_fault: { kind: SCENARIO_NODE_KINDS.enableFault, label: 'Enable Fault' },
  disable_fault: { kind: SCENARIO_NODE_KINDS.disableFault, label: 'Disable Fault' },
  assert_register: { kind: SCENARIO_NODE_KINDS.assertRegister, label: 'Assert Register' },
  assert_state: { kind: SCENARIO_NODE_KINDS.assertState, label: 'Assert State' },
  assert_response: { kind: SCENARIO_NODE_KINDS.assertResponse, label: 'Assert Response' },
  assert_error: { kind: SCENARIO_NODE_KINDS.assertError, label: 'Assert Error' },
  wait_for_event: { kind: SCENARIO_NODE_KINDS.waitForEvent, label: 'Wait For Event' },
}

function stepData(step: ScenarioStep, label: string): JsonObject {
  const common: JsonObject = { label, step_id: step.id }
  if (typeof step.continue_on_failure === 'boolean') common.continue_on_failure = step.continue_on_failure
  switch (step.action) {
    case 'reset_device': return { ...common, device_id: String(step.device ?? '') }
    case 'send_spi': return { ...common, device_id: String(step.device ?? ''), tx_hex: String(step.tx ?? ''), save_as: String(step.save_as ?? '') }
    case 'advance_time': return { ...common, duration: Number(step.duration_ms ?? 0), unit: 'ms' }
    case 'enable_fault':
    case 'disable_fault': return { ...common, fault_id: String(step.fault ?? '') }
    case 'assert_register': return { ...common, device_id: String(step.device ?? ''), register: String(step.register ?? ''), expected: Number(step.expected ?? 0) }
    case 'assert_state': return { ...common, device_id: String(step.device ?? ''), expected_state: String(step.expected ?? '') }
    case 'assert_response': return { ...common, source: String(step.source ?? ''), expected_hex: String(step.expected ?? '') }
    case 'assert_error': return { ...common, source: String(step.source ?? ''), expected_code: String(step.expected_code ?? '') }
    case 'wait_for_event': return { ...common, device_id: String(step.device ?? ''), event_type: String(step.event ?? ''), timeout: Number(step.timeout_ms ?? 0), timeout_unit: 'ms' }
    default: return common
  }
}

export function scenarioDocumentToFlow(source: ScenarioDocument, options: { deviceId?: string; now?: string } = {}): FlowDocument {
  const document = createScenarioFlowDocument({ id: source.scenario.id, name: source.scenario.name, deviceId: options.deviceId, now: options.now })
  const stepNodes: FlowNodeDocument[] = source.steps.map((step, index) => {
    const definition = actionNodes[step.action]
    if (!definition) throw new Error(`Unsupported packaged scenario action: ${step.action}`)
    return {
      id: `step-${index + 1}-${step.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
      kind: definition.kind,
      position: { x: 300 + index * 260, y: 180 },
      data: stepData(step, definition.label),
      ui: {},
    }
  })
  const endX = 300 + stepNodes.length * 260
  document.nodes = [
    { id: 'start', kind: SCENARIO_NODE_KINDS.start, position: { x: 40, y: 180 }, data: { label: 'Start Scenario' }, ui: {} },
    ...stepNodes,
    { id: 'end', kind: SCENARIO_NODE_KINDS.end, position: { x: endX, y: 180 }, data: { label: 'End Scenario' }, ui: {} },
  ]
  document.edges = document.nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index + 1}`,
    kind: 'default',
    source: node.id,
    sourceHandle: 'out',
    target: document.nodes[index + 1].id,
    targetHandle: 'in',
    data: {},
    ui: {},
  }))
  document.metadata = {
    scenario: {
      device_id: options.deviceId ?? '',
      description: '',
      timeout_ms: source.scenario.timeout_ms,
      continue_on_failure: false,
      tags: [],
      revision: 1,
    },
    source: 'package',
  }
  return document
}
