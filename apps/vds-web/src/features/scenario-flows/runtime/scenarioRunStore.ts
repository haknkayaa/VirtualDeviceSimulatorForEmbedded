import { create } from 'zustand'

import type { FlowRuntimeStatus } from '../../flows/types/flow'
import type { RunRecord, ScenarioDocument, ScenarioResult } from '../../../types/api'
import type { DomainEvent } from '../../../types/events'
import { mapScenarioEvent } from './scenarioEventMapper'

interface ScenarioRunState {
  activeRunId: string | null
  compiled: ScenarioDocument | null
  stepNodeMap: Record<string, string>
  statuses: Record<string, FlowRuntimeStatus>
  result: ScenarioResult | null
  lastProcessedEventId: number
  begin: (runId: string, compiled: ScenarioDocument, stepNodeMap: Record<string, string>) => void
  applyEvents: (events: DomainEvent[]) => void
  hydrate: (run: RunRecord | undefined, result: ScenarioResult | undefined) => void
  clear: () => void
}

const initial = { activeRunId: null, compiled: null, stepNodeMap: {}, statuses: {}, result: null, lastProcessedEventId: 0 }

export const useScenarioRunStore = create<ScenarioRunState>((set, get) => ({
  ...initial,
  begin: (activeRunId, compiled, stepNodeMap) => set({ activeRunId, compiled, stepNodeMap, result: null, lastProcessedEventId: 0, statuses: Object.fromEntries(Object.values(stepNodeMap).map((nodeId) => [nodeId, 'queued'])) }),
  applyEvents: (events) => {
    const state = get()
    if (!state.activeRunId) return
    const statuses = { ...state.statuses }
    let cursor = state.lastProcessedEventId
    events.filter((event) => event.event_id > cursor && event.scenario_run_id === state.activeRunId).sort((a, b) => a.event_id - b.event_id).forEach((event) => {
      const update = mapScenarioEvent(event, state.stepNodeMap)
      if (update) statuses[update.nodeId] = update.status
      cursor = Math.max(cursor, event.event_id)
    })
    if (cursor !== state.lastProcessedEventId) set({ statuses, lastProcessedEventId: cursor })
  },
  hydrate: (run, result) => {
    if (!run || run.run_id !== get().activeRunId) return
    if (!result) return
    const statuses = { ...get().statuses }
    result.steps.forEach((step) => { const nodeId = get().stepNodeMap[step.step_id]; if (nodeId) statuses[nodeId] = step.status })
    set({ result, statuses })
  },
  clear: () => set(initial),
}))
