import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createEventStream } from '../api/eventSocket'
import { queryKeys } from '../api/queries'
import { useEventStore } from '../stores/eventStore'
import { useRunStore } from '../stores/runStore'
import type { DomainEvent } from '../types/events'

export function useEventStream() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let eventBatch: DomainEvent[] = []
    let storeTimer: ReturnType<typeof setTimeout> | undefined
    let invalidationTimer: ReturnType<typeof setTimeout> | undefined
    const stateDevices = new Set<string>()
    const registerDevices = new Set<string>()
    const runIds = new Set<string>()
    let invalidateDevices = false

    const flushInvalidations = () => {
      invalidationTimer = undefined
      if (invalidateDevices) void queryClient.invalidateQueries({ queryKey: queryKeys.devices })
      for (const deviceId of stateDevices) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.device(deviceId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.state(deviceId) })
      }
      for (const deviceId of registerDevices) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.registers(deviceId) })
      }
      for (const runId of runIds) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) })
      }
      stateDevices.clear()
      registerDevices.clear()
      runIds.clear()
      invalidateDevices = false
    }

    const stageInvalidations = (events: DomainEvent[]) => {
      for (const event of events) {
        const deviceId = event.device_id
        if (deviceId && (event.event_type === 'state_transition' || event.event_type === 'device_reset')) {
          invalidateDevices = true
          stateDevices.add(deviceId)
        }
        if (deviceId && ['register_read', 'register_write', 'device_reset'].includes(event.event_type)) {
          registerDevices.add(deviceId)
        }
        if (event.event_type === 'scenario_step_completed' || event.event_type === 'scenario_completed') {
          const runId = event.scenario_run_id ?? useRunStore.getState().activeRunId
          if (runId) runIds.add(runId)
        }
      }
      invalidationTimer ??= setTimeout(flushInvalidations, 250)
    }

    const flushEvents = () => {
      storeTimer = undefined
      if (eventBatch.length === 0) return
      const batch = eventBatch
      eventBatch = []
      useEventStore.getState().acceptEvents(batch)
      stageInvalidations(batch)
    }

    const controller = createEventStream({
      getCursor: () => useEventStore.getState().lastEventId,
      onEvent: (event) => {
        eventBatch.push(event)
        storeTimer ??= setTimeout(flushEvents, 50)
      },
      onStatus: (status, attempt) => useEventStore.getState().setConnection(status, attempt),
    })
    controller.start()
    return () => {
      controller.stop()
      if (storeTimer) clearTimeout(storeTimer)
      if (invalidationTimer) clearTimeout(invalidationTimer)
      flushEvents()
      if (invalidationTimer) clearTimeout(invalidationTimer)
      flushInvalidations()
    }
  }, [queryClient])
}
