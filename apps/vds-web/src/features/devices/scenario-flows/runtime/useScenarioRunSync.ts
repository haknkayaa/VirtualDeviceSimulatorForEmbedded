import { useEffect } from 'react'

import { useRun, useRunResult } from '../../../../api/queries'
import { useEventStore } from '../../../../stores/eventStore'
import { useFlowStore } from '../../../flows/store/flowStore'
import { useScenarioRunStore } from './scenarioRunStore'

/**
 * Keeps the active scenario run (polled run record, result and replayed
 * domain events) projected onto the canvas, independent of which bottom-panel
 * tab is visible.
 */
export function useScenarioRunSync() {
  const activeRunId = useScenarioRunStore((state) => state.activeRunId)
  const statuses = useScenarioRunStore((state) => state.statuses)
  const events = useEventStore((state) => state.events)
  const run = useRun(activeRunId)
  const result = useRunResult(activeRunId, run.data?.status)
  useEffect(() => useScenarioRunStore.getState().applyEvents(events), [events])
  useEffect(() => useScenarioRunStore.getState().hydrate(run.data, result.data ?? run.data?.result), [result.data, run.data])
  useEffect(() => useFlowStore.getState().setRuntimeStatuses(statuses), [statuses])
  return { activeRunId, run }
}
