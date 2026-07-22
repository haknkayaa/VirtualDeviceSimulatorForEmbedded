import type { FlowDocument, ValidationIssue } from '../../flows/types/flow'
import { validateFlowDocument } from '../../flows/validation/validator'
import type { ScenarioResourceSnapshot } from '../types/scenarioFlow'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'
import { scenarioFlowRules } from './scenarioRules'
import '../registry/scenarioNodeRegistry'

export function validateScenarioFlow(document: FlowDocument, resources: ScenarioResourceSnapshot = {}): ValidationIssue[] {
  const issues = validateFlowDocument(document)
  scenarioFlowRules.flatMap((rule) => rule({ document, nodeRegistry: { get: () => undefined, has: () => true, list: () => [] }, edgeRegistry: { get: () => undefined, has: () => true, list: () => [] } })).forEach((issue) => {
    if (!issues.some((current) => current.ruleId === issue.ruleId && current.nodeId === issue.nodeId && current.message === issue.message)) issues.push(issue)
  })
  const devices = resources.devices ? new Set(resources.devices.map((device) => device.id)) : null
  const faults = resources.faults ? new Set(resources.faults.map((fault) => fault.id)) : null
  document.nodes.forEach((node) => {
    const deviceId = typeof node.data.device_id === 'string' ? node.data.device_id : ''
    if (devices && deviceId && !devices.has(deviceId)) issues.push({ ruleId: 'scenario-missing-device-resource', severity: 'error', message: `Device ${deviceId} is not present in the current REST snapshot.`, nodeId: node.id })
    if ([SCENARIO_NODE_KINDS.enableFault, SCENARIO_NODE_KINDS.disableFault].includes(node.kind as never)) {
      const faultId = typeof node.data.fault_id === 'string' ? node.data.fault_id : ''
      if (faults && faultId && !faults.has(faultId)) issues.push({ ruleId: 'scenario-missing-fault-resource', severity: 'error', message: `Fault ${faultId} is not present in the current REST snapshot.`, nodeId: node.id })
    }
    if (node.kind === SCENARIO_NODE_KINDS.assertRegister && resources.registersByDevice?.[deviceId]) {
      const selected = resources.registersByDevice[deviceId].find((register) => register.name === node.data.register)
      if (node.data.register && !selected) issues.push({ ruleId: 'scenario-missing-register-resource', severity: 'error', message: `Register ${String(node.data.register)} is not present in the current REST snapshot for ${deviceId}.`, nodeId: node.id })
      if (selected) {
        const expected = parseInteger(node.data.expected)
        const max = (1n << BigInt(selected.width_bits)) - 1n
        if (expected !== null && (expected < 0n || expected > max)) issues.push({ ruleId: 'scenario-register-value-width', severity: 'error', message: `Expected value does not fit ${selected.width_bits}-bit register ${selected.name}.`, nodeId: node.id })
      }
    }
  })
  return issues
}

export function parseInteger(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim())) return null
  try { return BigInt(value.trim()) } catch { return null }
}
