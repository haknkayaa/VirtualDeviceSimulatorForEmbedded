import { nodeRegistry } from '../../../flows/registry/nodeRegistry'
import { registerFlowValidationRules } from '../../../flows/validation/validator'
import type { JsonObject, NodeRegistryEntry } from '../../../flows/types/flow'
import { ScenarioNodeInspector } from '../inspectors/ScenarioNodeInspector'
import * as Nodes from '../nodes/ScenarioNodes'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'
import { scenarioFlowRules } from '../validation/scenarioRules'

const str = (data: JsonObject, key: string) => {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}
const join = (...parts: string[]) => parts.filter(Boolean).join(' ') || undefined

/** Canvas icon and one-line technical summary per scenario step kind. */
const appearance: Record<string, { icon: string; summary?: (data: JsonObject) => string | undefined }> = {
  [SCENARIO_NODE_KINDS.start]: { icon: 'play' },
  [SCENARIO_NODE_KINDS.end]: { icon: 'end' },
  [SCENARIO_NODE_KINDS.resetDevice]: { icon: 'reset', summary: (data) => str(data, 'device_id') || undefined },
  [SCENARIO_NODE_KINDS.sendSpi]: { icon: 'spi', summary: (data) => join(str(data, 'tx_hex') ? `TX ${str(data, 'tx_hex')}` : '', str(data, 'save_as') ? `→ ${str(data, 'save_as')}` : '') },
  [SCENARIO_NODE_KINDS.advanceTime]: { icon: 'timer', summary: (data) => str(data, 'duration') ? `+${str(data, 'duration')} ${str(data, 'unit')}` : undefined },
  [SCENARIO_NODE_KINDS.enableFault]: { icon: 'fault', summary: (data) => str(data, 'fault_id') || undefined },
  [SCENARIO_NODE_KINDS.disableFault]: { icon: 'fault-off', summary: (data) => str(data, 'fault_id') || undefined },
  [SCENARIO_NODE_KINDS.assertRegister]: { icon: 'assert', summary: (data) => str(data, 'register') ? `${str(data, 'register')} == ${str(data, 'expected') || '?'}` : undefined },
  [SCENARIO_NODE_KINDS.assertState]: { icon: 'assert', summary: (data) => str(data, 'expected_state') ? `state == ${str(data, 'expected_state')}` : undefined },
  [SCENARIO_NODE_KINDS.assertResponse]: { icon: 'assert', summary: (data) => str(data, 'expected_hex') ? `${str(data, 'source') || '?'} == ${str(data, 'expected_hex')}` : undefined },
  [SCENARIO_NODE_KINDS.assertError]: { icon: 'assert', summary: (data) => str(data, 'expected_code') ? `${str(data, 'source') || '?'} ⇒ ${str(data, 'expected_code')}` : undefined },
  [SCENARIO_NODE_KINDS.waitForEvent]: { icon: 'wait', summary: (data) => str(data, 'event_type') ? `${str(data, 'event_type')} ≤ ${str(data, 'timeout')} ${str(data, 'timeout_unit')}` : undefined },
}

const input = [{ id: 'in', label: 'Previous', required: true }]
const output = [{ id: 'out', label: 'Next', required: true }]
const entry = (kind: string, displayName: string, category: string, accentToken: string, component: NodeRegistryEntry['component'], defaultData: JsonObject, ports = { input, output }): NodeRegistryEntry => ({
  kind, displayName, description: `${displayName} scenario authoring node.`, category, iconIdentifier: appearance[kind]?.icon ?? 'workflow', accentToken, summary: appearance[kind]?.summary,
  defaultData: { label: displayName, ...defaultData }, inputPorts: ports.input, outputPorts: ports.output,
  component, inspectorComponent: ScenarioNodeInspector, validationRules: [], flowKinds: ['scenario'],
})

const entries = [
  entry(SCENARIO_NODE_KINDS.start, 'Start Scenario', 'Control', 'trigger', Nodes.StartScenarioNode, {}, { input: [], output }),
  entry(SCENARIO_NODE_KINDS.end, 'End Scenario', 'Control', 'end', Nodes.EndScenarioNode, {}, { input, output: [] }),
  entry(SCENARIO_NODE_KINDS.resetDevice, 'Reset Device', 'Actions', 'action', Nodes.ResetDeviceNode, { device_id: '' }),
  entry(SCENARIO_NODE_KINDS.sendSpi, 'Send SPI', 'Actions', 'action', Nodes.SendSpiNode, { device_id: '', tx_hex: '' }),
  entry(SCENARIO_NODE_KINDS.advanceTime, 'Advance Time', 'Timing', 'timing', Nodes.AdvanceTimeNode, { duration: 1, unit: 'ms' }),
  entry(SCENARIO_NODE_KINDS.enableFault, 'Enable Fault', 'Faults', 'action', Nodes.EnableFaultNode, { device_id: '', fault_id: '' }),
  entry(SCENARIO_NODE_KINDS.disableFault, 'Disable Fault', 'Faults', 'action', Nodes.DisableFaultNode, { device_id: '', fault_id: '' }),
  entry(SCENARIO_NODE_KINDS.assertRegister, 'Assert Register', 'Assertions', 'guard', Nodes.AssertRegisterNode, { device_id: '', register: '', expected: '' }),
  entry(SCENARIO_NODE_KINDS.assertState, 'Assert State', 'Assertions', 'guard', Nodes.AssertStateNode, { device_id: '', expected_state: '' }),
  entry(SCENARIO_NODE_KINDS.assertResponse, 'Assert Response', 'Assertions', 'guard', Nodes.AssertResponseNode, { source: '', expected_hex: '' }),
  entry(SCENARIO_NODE_KINDS.assertError, 'Assert Error', 'Assertions', 'guard', Nodes.AssertErrorNode, { source: '', expected_code: '' }),
  entry(SCENARIO_NODE_KINDS.waitForEvent, 'Wait For Event', 'Events', 'timing', Nodes.WaitForEventNode, { device_id: '', event_type: '', timeout: 100, timeout_unit: 'ms' }),
]

export function registerScenarioNodes() {
  entries.forEach((definition) => { if (!nodeRegistry.has(definition.kind)) nodeRegistry.register(definition) })
  return entries
}

registerScenarioNodes()
registerFlowValidationRules('scenario', scenarioFlowRules)
