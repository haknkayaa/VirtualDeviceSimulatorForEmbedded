import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createEventStream } from '../api/eventSocket'
import { queryKeys } from '../api/queries'
import { useEventStore } from '../stores/eventStore'
import { useRunStore } from '../stores/runStore'
import type { DomainEvent } from '../types/events'

function invalidateSnapshots(queryClient: ReturnType<typeof useQueryClient>, event: DomainEvent) {
  const deviceId = event.device_id
  if (deviceId && (event.event_type === 'state_transition' || event.event_type === 'device_reset')) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    void queryClient.invalidateQueries({ queryKey: queryKeys.device(deviceId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.state(deviceId) })
  }
  if (deviceId && ['register_read', 'register_write', 'device_reset'].includes(event.event_type)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.registers(deviceId) })
  }
  if (event.event_type === 'scenario_step_completed' || event.event_type === 'scenario_completed') {
    const runId = event.scenario_run_id ?? useRunStore.getState().activeRunId
    if (runId) void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) })
  }
}

export function useEventStream() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const controller = createEventStream({
      getCursor: () => useEventStore.getState().lastEventId,
      onEvent: (event) => {
        useEventStore.getState().acceptEvent(event)
        invalidateSnapshots(queryClient, event)
      },
      onStatus: (status, attempt) => useEventStore.getState().setConnection(status, attempt),
    })
    controller.start()
    return controller.stop
  }, [queryClient])
}
