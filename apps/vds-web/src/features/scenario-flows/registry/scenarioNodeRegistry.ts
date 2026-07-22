import { nodeRegistry } from '../../flows/registry/nodeRegistry'
import { registerFlowValidationRules } from '../../flows/validation/validator'
import type { JsonObject, NodeRegistryEntry } from '../../flows/types/flow'
import { ScenarioNodeInspector } from '../inspectors/ScenarioNodeInspector'
import * as Nodes from '../nodes/ScenarioNodes'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'
import { scenarioFlowRules } from '../validation/scenarioRules'

const input = [{ id: 'in', label: 'Previous', required: true }]
const output = [{ id: 'out', label: 'Next', required: true }]
const entry = (kind: string, displayName: string, category: string, accentToken: string, component: NodeRegistryEntry['component'], defaultData: JsonObject, ports = { input, output }): NodeRegistryEntry => ({
  kind, displayName, description: `${displayName} scenario authoring node.`, category, iconIdentifier: 'workflow', accentToken,
  defaultData: { label: displayName, ...defaultData }, inputPorts: ports.input, outputPorts: ports.output,
  component, inspectorComponent: ScenarioNodeInspector, validationRules: [], flowKinds: ['scenario'],
})

const entries = [
  entry(SCENARIO_NODE_KINDS.start, 'Start Scenario', 'Control', 'muted', Nodes.StartScenarioNode, {}, { input: [], output }),
  entry(SCENARIO_NODE_KINDS.end, 'End Scenario', 'Control', 'muted', Nodes.EndScenarioNode, {}, { input, output: [] }),
  entry(SCENARIO_NODE_KINDS.resetDevice, 'Reset Device', 'Actions', 'cyan', Nodes.ResetDeviceNode, { device_id: '' }),
  entry(SCENARIO_NODE_KINDS.sendSpi, 'Send SPI', 'Actions', 'cyan', Nodes.SendSpiNode, { device_id: '', tx_hex: '' }),
  entry(SCENARIO_NODE_KINDS.advanceTime, 'Advance Time', 'Timing', 'violet', Nodes.AdvanceTimeNode, { duration: 1, unit: 'ms' }),
  entry(SCENARIO_NODE_KINDS.enableFault, 'Enable Fault', 'Faults', 'coral', Nodes.EnableFaultNode, { device_id: '', fault_id: '' }),
  entry(SCENARIO_NODE_KINDS.disableFault, 'Disable Fault', 'Faults', 'coral', Nodes.DisableFaultNode, { device_id: '', fault_id: '' }),
  entry(SCENARIO_NODE_KINDS.assertRegister, 'Assert Register', 'Assertions', 'green', Nodes.AssertRegisterNode, { device_id: '', register: '', expected: '' }),
  entry(SCENARIO_NODE_KINDS.assertState, 'Assert State', 'Assertions', 'green', Nodes.AssertStateNode, { device_id: '', expected_state: '' }),
  entry(SCENARIO_NODE_KINDS.assertResponse, 'Assert Response', 'Assertions', 'green', Nodes.AssertResponseNode, { source: '', expected_hex: '' }),
  entry(SCENARIO_NODE_KINDS.assertError, 'Assert Error', 'Assertions', 'green', Nodes.AssertErrorNode, { source: '', expected_code: '' }),
  entry(SCENARIO_NODE_KINDS.waitForEvent, 'Wait For Event', 'Events', 'amber', Nodes.WaitForEventNode, { device_id: '', event_type: '', timeout: 100, timeout_unit: 'ms' }),
]

export function registerScenarioNodes() {
  entries.forEach((definition) => { if (!nodeRegistry.has(definition.kind)) nodeRegistry.register(definition) })
  return entries
}

registerScenarioNodes()
registerFlowValidationRules('scenario', scenarioFlowRules)
