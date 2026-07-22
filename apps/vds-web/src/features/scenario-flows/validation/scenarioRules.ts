import type { FlowValidationRule, ValidationIssue } from '../../flows/types/flow'
import { orderedScenarioNodes } from '../compiler/topologicalOrder'
import { EXECUTABLE_SCENARIO_KINDS, RESULT_NAME_PATTERN, SCENARIO_NODE_KINDS, TIME_UNITS } from '../types/scenarioFlow'

const text = (data: Record<string, unknown>, key: string) => typeof data[key] === 'string' ? data[key].trim() : ''
const error = (ruleId: string, message: string, nodeId?: string): ValidationIssue => ({ ruleId, severity: 'error', message, nodeId })
export function validHex(value: string) { return /^(?:[0-9a-fA-F]{2})(?:\s+[0-9a-fA-F]{2})*$/.test(value.trim()) }

export const scenarioGraphRule: FlowValidationRule = ({ document }) => {
  if (document.flow.kind !== 'scenario') return []
  const issues: ValidationIssue[] = []
  const starts = document.nodes.filter((node) => node.kind === SCENARIO_NODE_KINDS.start)
  const ends = document.nodes.filter((node) => node.kind === SCENARIO_NODE_KINDS.end)
  if (!starts.length) issues.push(error('scenario-missing-start', 'Scenario requires exactly one Start Scenario node.'))
  if (starts.length > 1) issues.push(error('scenario-multiple-starts', 'Scenario has multiple Start Scenario nodes.'))
  if (!ends.length) issues.push(error('scenario-missing-end', 'Scenario requires at least one End Scenario node.'))
  if (!document.nodes.some((node) => EXECUTABLE_SCENARIO_KINDS.has(node.kind as never))) issues.push(error('scenario-empty-execution', 'Scenario requires at least one executable node.'))
  document.nodes.filter((node) => node.kind.startsWith('scenario.') && !Object.values(SCENARIO_NODE_KINDS).includes(node.kind as never)).forEach((node) => issues.push(error('unknown-scenario-node', `Unsupported scenario node kind: ${node.kind}`, node.id)))
  const connected = new Set(document.edges.flatMap((edge) => [edge.source, edge.target]))
  document.nodes.filter((node) => EXECUTABLE_SCENARIO_KINDS.has(node.kind as never) && !connected.has(node.id)).forEach((node) => issues.push(error('disconnected-executable', `${node.id} is disconnected from the execution graph.`, node.id)))
  const adjacency = new Map(document.nodes.map((node) => [node.id, [] as string[]]))
  document.edges.forEach((edge) => adjacency.get(edge.source)?.push(edge.target))
  const visiting = new Set<string>(); const visited = new Set<string>(); let cycle = false
  const visit = (id: string) => { if (visiting.has(id)) { cycle = true; return }; if (visited.has(id)) return; visiting.add(id); adjacency.get(id)?.forEach(visit); visiting.delete(id); visited.add(id) }
  document.nodes.forEach((node) => visit(node.id))
  if (cycle) issues.push(error('scenario-cycle', 'Scenario execution graphs cannot contain cycles.'))
  orderedScenarioNodes(document).errors.forEach((item) => issues.push(error(item.code, item.message, item.node_id)))
  return issues
}

export const scenarioParameterRule: FlowValidationRule = ({ document }) => {
  if (document.flow.kind !== 'scenario') return []
  const issues: ValidationIssue[] = []
  const resultNames = new Map<string, string>()
  document.nodes.forEach((node) => {
    const data = node.data
    if (!text(data, 'label')) issues.push(error('scenario-empty-label', 'Node label is required.', node.id))
    switch (node.kind) {
      case SCENARIO_NODE_KINDS.resetDevice:
      case SCENARIO_NODE_KINDS.sendSpi:
      case SCENARIO_NODE_KINDS.assertRegister:
      case SCENARIO_NODE_KINDS.assertState:
        if (!text(data, 'device_id')) issues.push(error('scenario-missing-device', 'Device is required.', node.id)); break
    }
    if (node.kind === SCENARIO_NODE_KINDS.sendSpi) {
      if (!validHex(text(data, 'tx_hex'))) issues.push(error('scenario-invalid-spi-hex', 'TX must contain complete hexadecimal bytes separated by spaces.', node.id))
      if (Object.hasOwn(data, 'save_as')) {
        const name = text(data, 'save_as')
        if (!name) issues.push(error('scenario-empty-result-name', 'Result name cannot be empty when provided.', node.id))
        else if (!RESULT_NAME_PATTERN.test(name)) issues.push(error('scenario-invalid-result-name', 'Result names must match [A-Za-z_][A-Za-z0-9_]*.', node.id))
        else if (resultNames.has(name)) issues.push(error('scenario-duplicate-result-name', `Result name ${name} is already produced by ${resultNames.get(name)}.`, node.id))
        else resultNames.set(name, node.id)
      }
      const capacity = data.response_capacity
      if (capacity != null && (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity <= 0)) issues.push(error('scenario-invalid-response-capacity', 'Response capacity must be a positive integer.', node.id))
    }
    if (node.kind === SCENARIO_NODE_KINDS.advanceTime) {
      if (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration <= 0) issues.push(error('scenario-invalid-duration', 'Duration must be positive.', node.id))
      if (!TIME_UNITS.includes(data.unit as never)) issues.push(error('scenario-invalid-time-unit', 'Time unit must be ns, us, ms, or s.', node.id))
    }
    if ([SCENARIO_NODE_KINDS.enableFault, SCENARIO_NODE_KINDS.disableFault].includes(node.kind as never) && !text(data, 'fault_id')) issues.push(error('scenario-missing-fault', 'Fault is required.', node.id))
    if (node.kind === SCENARIO_NODE_KINDS.assertRegister) {
      if (!text(data, 'register')) issues.push(error('scenario-missing-register', 'Register is required.', node.id))
      if (data.expected === '' || data.expected === undefined) issues.push(error('scenario-missing-expected', 'Expected register value is required.', node.id))
    }
    if (node.kind === SCENARIO_NODE_KINDS.assertState && !text(data, 'expected_state')) issues.push(error('scenario-missing-state', 'Expected state is required.', node.id))
    if (node.kind === SCENARIO_NODE_KINDS.assertResponse) {
      if (!text(data, 'source')) issues.push(error('scenario-missing-result-reference', 'Source result is required.', node.id))
      if (!validHex(text(data, 'expected_hex'))) issues.push(error('scenario-invalid-response-hex', 'Expected response must contain complete hexadecimal bytes.', node.id))
    }
    if (node.kind === SCENARIO_NODE_KINDS.assertError) {
      if (!text(data, 'source')) issues.push(error('scenario-missing-result-reference', 'Source result is required.', node.id))
      if (!text(data, 'expected_code')) issues.push(error('scenario-missing-error-code', 'Structured error code is required.', node.id))
    }
    if (node.kind === SCENARIO_NODE_KINDS.waitForEvent) {
      if (!text(data, 'event_type')) issues.push(error('scenario-missing-event', 'Event type is required.', node.id))
      if (typeof data.timeout !== 'number' || !Number.isFinite(data.timeout) || data.timeout <= 0) issues.push(error('scenario-invalid-timeout', 'Wait timeout must be positive.', node.id))
      if (!TIME_UNITS.includes(data.timeout_unit as never)) issues.push(error('scenario-invalid-time-unit', 'Timeout unit must be ns, us, ms, or s.', node.id))
    }
  })
  return issues
}

export const scenarioFlowRules: FlowValidationRule[] = [scenarioGraphRule, scenarioParameterRule]
