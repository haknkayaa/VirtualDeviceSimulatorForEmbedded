import type { FlowRuntimeStatus } from '../../../flows/types/flow'
import type { DomainEvent } from '../../../../types/events'

export function mapScenarioEvent(event: DomainEvent, stepNodeMap: Record<string, string>): { nodeId: string; status: FlowRuntimeStatus } | null {
  if (event.payload.kind === 'scenario_step_started') {
    const nodeId = stepNodeMap[event.payload.step_id]
    return nodeId ? { nodeId, status: 'running' } : null
  }
  if (event.payload.kind === 'scenario_step_completed') {
    const nodeId = stepNodeMap[event.payload.step_id]
    const status = ['passed', 'failed', 'skipped'].includes(event.payload.status) ? event.payload.status as FlowRuntimeStatus : 'warning'
    return nodeId ? { nodeId, status } : null
  }
  return null
}
