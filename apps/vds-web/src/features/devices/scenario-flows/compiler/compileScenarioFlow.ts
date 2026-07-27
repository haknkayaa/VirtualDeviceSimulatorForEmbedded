import type { ScenarioStep } from '../../../../types/api'
import type { FlowDocument, FlowNodeDocument } from '../../../flows/types/flow'
import '../registry/scenarioNodeRegistry'
import { orderedScenarioNodes } from './topologicalOrder'
import { validateScenarioFlow, parseInteger } from '../validation/scenarioFlowValidator'
import { compilerIssuesFromValidation, RESULT_NAME_PATTERN, scenarioSettings, SCENARIO_NODE_KINDS, STEP_ID_PATTERN, type CompilerIssue, type ScenarioCompileResult, type ScenarioResourceSnapshot, type TimeUnit } from '../types/scenarioFlow'

const text = (node: FlowNodeDocument, key: string) => typeof node.data[key] === 'string' ? node.data[key].trim() : ''
const normalizeHex = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ')

function stableId(node: FlowNodeDocument, used: Set<string>) {
  const authored = text(node, 'step_id')
  let base = authored || node.id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+/, '') || 'step'
  if (!STEP_ID_PATTERN.test(base)) base = `step-${base.replace(/[^A-Za-z0-9_-]+/g, '-')}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}-${suffix++}`
  used.add(candidate)
  return candidate
}

function toMilliseconds(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || !['ns', 'us', 'ms', 's'].includes(String(unit))) return null
  const scale: Record<TimeUnit, bigint> = { ns: 1n, us: 1_000n, ms: 1_000_000n, s: 1_000_000_000n }
  const nanoseconds = BigInt(value) * scale[unit as TimeUnit]
  if (nanoseconds % 1_000_000n !== 0n) return null
  const milliseconds = nanoseconds / 1_000_000n
  return milliseconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(milliseconds) : null
}

function compileStep(node: FlowNodeDocument, id: string, continueOnFailure: boolean, generatedResults: Map<string, string>, errors: CompilerIssue[], warnings: CompilerIssue[]): ScenarioStep | null {
  const base = { id, continue_on_failure: typeof node.data.continue_on_failure === 'boolean' ? node.data.continue_on_failure : continueOnFailure }
  switch (node.kind) {
    case SCENARIO_NODE_KINDS.resetDevice: return { ...base, action: 'reset_device', device: text(node, 'device_id') }
    case SCENARIO_NODE_KINDS.sendSpi: {
      let saveAs = text(node, 'save_as')
      if (!Object.hasOwn(node.data, 'save_as')) { saveAs = `result_${id.replace(/-/g, '_')}`; warnings.push({ code: 'generated-result-name', message: `Generated result name ${saveAs}.`, node_id: node.id }) }
      if (!RESULT_NAME_PATTERN.test(saveAs)) return null
      generatedResults.set(node.id, saveAs)
      if (node.data.response_capacity != null) warnings.push({ code: 'unsupported-response-capacity', message: 'The current scenario runtime does not expose response capacity; the authoring value is preserved but omitted.', node_id: node.id })
      if (node.data.transport_timeout_ms != null) warnings.push({ code: 'unsupported-transport-timeout', message: 'The current scenario runtime does not expose per-transport timeout; the authoring value is preserved but omitted.', node_id: node.id })
      return { ...base, action: 'send_spi', device: text(node, 'device_id'), tx: normalizeHex(text(node, 'tx_hex')), save_as: saveAs }
    }
    case SCENARIO_NODE_KINDS.advanceTime: {
      const duration_ms = toMilliseconds(node.data.duration, node.data.unit)
      if (duration_ms === null) { errors.push({ code: 'time-not-representable', message: 'Duration must convert exactly to positive whole milliseconds for the current runtime.', node_id: node.id }); return null }
      return { ...base, action: 'advance_time', duration_ms }
    }
    case SCENARIO_NODE_KINDS.enableFault: return { ...base, action: 'enable_fault', fault: text(node, 'fault_id') }
    case SCENARIO_NODE_KINDS.disableFault: return { ...base, action: 'disable_fault', fault: text(node, 'fault_id') }
    case SCENARIO_NODE_KINDS.assertRegister: {
      const expected = parseInteger(node.data.expected)
      if (expected === null || expected < 0n || expected > BigInt(Number.MAX_SAFE_INTEGER)) { errors.push({ code: 'invalid-register-value', message: 'Expected register value must be a non-negative safe integer.', node_id: node.id }); return null }
      return { ...base, action: 'assert_register', device: text(node, 'device_id'), register: text(node, 'register'), expected: Number(expected) }
    }
    case SCENARIO_NODE_KINDS.assertState: return { ...base, action: 'assert_state', device: text(node, 'device_id'), expected: text(node, 'expected_state') }
    case SCENARIO_NODE_KINDS.assertResponse: return { ...base, action: 'assert_response', source: text(node, 'source'), expected: normalizeHex(text(node, 'expected_hex')) }
    case SCENARIO_NODE_KINDS.assertError: return { ...base, action: 'assert_error', source: text(node, 'source'), expected_code: text(node, 'expected_code') }
    case SCENARIO_NODE_KINDS.waitForEvent: {
      const timeout_ms = toMilliseconds(node.data.timeout, node.data.timeout_unit)
      if (timeout_ms === null) { errors.push({ code: 'time-not-representable', message: 'Event timeout must convert exactly to positive whole milliseconds for the current runtime.', node_id: node.id }); return null }
      const device = text(node, 'device_id')
      return { ...base, action: 'wait_for_event', ...(device ? { device } : {}), event: text(node, 'event_type'), timeout_ms }
    }
    default: errors.push({ code: 'unsupported-node', message: `No compiler adapter exists for ${node.kind}.`, node_id: node.id }); return null
  }
}

export function compileScenarioFlow(document: FlowDocument, resources: ScenarioResourceSnapshot = {}): ScenarioCompileResult {
  const source = structuredClone(document)
  const validation = validateScenarioFlow(source, resources)
  const errors = compilerIssuesFromValidation(validation.filter((issue) => issue.severity === 'error'))
  const warnings = compilerIssuesFromValidation(validation.filter((issue) => issue.severity === 'warning'))
  if (source.flow.kind !== 'scenario') errors.push({ code: 'wrong-flow-kind', message: 'Only flow.kind=scenario can be compiled.' })
  const ordered = orderedScenarioNodes(source)
  ordered.errors.forEach((issue) => { if (!errors.some((current) => current.code === issue.code && current.node_id === issue.node_id)) errors.push(issue) })
  const settings = scenarioSettings(source)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(source.flow.id)) errors.push({ code: 'invalid-scenario-id', message: 'Scenario ID must use lowercase letters, digits, underscore, or hyphen and begin with an alphanumeric character.' })
  if (!Number.isSafeInteger(settings.timeout_ms) || settings.timeout_ms <= 0) errors.push({ code: 'invalid-scenario-timeout', message: 'Scenario timeout must be a positive integer in milliseconds.' })
  const usedIds = new Set<string>()
  const stepNodeMap: Record<string, string> = {}
  const generatedResults = new Map<string, string>()
  const produced = new Set<string>()
  const steps: ScenarioStep[] = []
  ordered.nodes.forEach((node) => {
    const authoredId = text(node, 'step_id')
    if (Object.hasOwn(node.data, 'step_id') && (!authoredId || !STEP_ID_PATTERN.test(authoredId))) errors.push({ code: 'invalid-step-id', message: 'Step ID is empty or invalid.', node_id: node.id })
    const id = stableId(node, usedIds)
    const step = compileStep(node, id, settings.continue_on_failure, generatedResults, errors, warnings)
    if (!step) return
    if (step.action === 'send_spi') produced.add(String(step.save_as))
    if (step.action === 'assert_response' || step.action === 'assert_error') {
      const sourceName = String(step.source)
      if (!produced.has(sourceName)) errors.push({ code: 'unknown-or-forward-result', message: `Result ${sourceName} must be produced by an earlier Send SPI step.`, node_id: node.id })
    }
    steps.push(step)
    stepNodeMap[id] = node.id
  })
  if (errors.length) return { document: null, errors, warnings, stepNodeMap }
  return { document: { schema_version: 1, scenario: { id: source.flow.id, name: source.flow.name, timeout_ms: settings.timeout_ms }, steps }, errors, warnings, stepNodeMap }
}

export function serializeCompiledScenario(document: NonNullable<ScenarioCompileResult['document']>) {
  return `${JSON.stringify(document, null, 2)}\n`
}
