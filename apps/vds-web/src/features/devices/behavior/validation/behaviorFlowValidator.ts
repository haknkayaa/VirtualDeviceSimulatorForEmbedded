import type { DeviceRegister } from '../../../../types/api'
import type { FlowDocument, ValidationIssue } from '../../../flows/types/flow'
import { validateFlowDocument } from '../../../flows/validation/validator'
import { behaviorFlowRules } from './behaviorRules'
import {
  BEHAVIOR_TRANSITION_EDGE,
  parseInteger,
  stateActions,
  type BehaviorResourceSnapshot,
} from '../types/deviceBehaviorFlow'
import '../registry/deviceBehaviorRegistry'

function resourceIssue(ruleId: string, message: string, target: { nodeId?: string; edgeId?: string }): ValidationIssue {
  return { ruleId, severity: 'error', message, ...target }
}

function validateValue(value: unknown, register: DeviceRegister) {
  const parsed = parseInteger(value)
  if (parsed === null) return 'must be a non-negative decimal or hexadecimal integer'
  const maximum = (1n << BigInt(register.width_bits)) - 1n
  return parsed > maximum ? `does not fit ${register.width_bits}-bit register ${register.name}` : null
}

export function validateBehaviorFlow(document: FlowDocument, resources: BehaviorResourceSnapshot = {}): ValidationIssue[] {
  const issues = validateFlowDocument(document)
  behaviorFlowRules.flatMap((rule) => rule({
    document,
    nodeRegistry: { get: () => undefined, has: () => true, list: () => [] },
    edgeRegistry: { get: () => undefined, has: () => true, list: () => [] },
  })).forEach((issue) => {
    if (!issues.some((current) => current.ruleId === issue.ruleId && current.nodeId === issue.nodeId && current.edgeId === issue.edgeId && current.message === issue.message)) issues.push(issue)
  })

  const registers = resources.registers ? new Map(resources.registers.map((register) => [register.name, register])) : null
  document.nodes.forEach((node) => {
    for (const action of [...stateActions(node, 'entry_actions'), ...stateActions(node, 'exit_actions')]) {
      if (!['set_register', 'reset_register'].includes(action.kind)) {
        issues.push(resourceIssue('behavior-unsupported-action', `Action ${action.kind || '(empty)'} is not supported by the current device runtime.`, { nodeId: node.id }))
        continue
      }
      if (!action.register) {
        issues.push(resourceIssue('behavior-action-register', 'Register action requires a register.', { nodeId: node.id }))
        continue
      }
      const register = registers?.get(action.register)
      if (registers && !register) {
        issues.push(resourceIssue('behavior-missing-register-resource', `Register ${action.register} is not present in the current REST snapshot.`, { nodeId: node.id }))
        continue
      }
      const value = action.kind === 'reset_register' ? action.reset_value : action.value
      if (value === undefined || value === '') {
        issues.push(resourceIssue('behavior-action-value', `${action.kind === 'reset_register' ? 'Reset' : 'Register'} value is required.`, { nodeId: node.id }))
      } else if (register) {
        const reason = validateValue(value, register)
        if (reason) issues.push(resourceIssue('behavior-register-value-overflow', `Value ${reason}.`, { nodeId: node.id }))
      } else if (parseInteger(value) === null) {
        issues.push(resourceIssue('behavior-action-value', 'Register value must be a non-negative decimal or hexadecimal integer.', { nodeId: node.id }))
      }
      if (register?.access === 'ro' && action.allow_read_only_internal !== true) {
        issues.push(resourceIssue('behavior-read-only-register-action', `Register ${register.name} is read-only. Explicitly mark this as a device-internal hardware-owned action to compile it.`, { nodeId: node.id }))
      }
    }
  })
  document.edges.filter((edge) => edge.kind === BEHAVIOR_TRANSITION_EDGE && edge.data.guard_enabled === true).forEach((edge) => {
    const name = typeof edge.data.guard_register === 'string' ? edge.data.guard_register : ''
    const register = registers?.get(name)
    if (registers && name && !register) issues.push(resourceIssue('behavior-missing-guard-register', `Guard register ${name} is not present in the current REST snapshot.`, { edgeId: edge.id }))
    if (register) {
      for (const [field, value] of [['equals', edge.data.guard_equals], ['mask', edge.data.guard_mask]] as const) {
        if (field === 'mask' && (value === '' || value === null || value === undefined)) continue
        const reason = validateValue(value, register)
        if (reason) issues.push(resourceIssue('behavior-guard-value-overflow', `Guard ${field} ${reason}.`, { edgeId: edge.id }))
      }
    }
  })
  if (resources.devices) {
    const deviceId = document.metadata.behavior && typeof document.metadata.behavior === 'object' && !Array.isArray(document.metadata.behavior)
      ? document.metadata.behavior.device_id
      : ''
    if (typeof deviceId === 'string' && deviceId && !resources.devices.some((device) => device.id === deviceId)) {
      issues.push(resourceIssue('behavior-missing-device-resource', `Device ${deviceId} is not present in the current REST snapshot.`, {}))
    }
  }
  return issues
}
