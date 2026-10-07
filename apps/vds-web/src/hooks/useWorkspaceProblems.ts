import { useMemo } from 'react'

import { useAdapters, useBusTelemetry, useDevices, useFaults, useHealth } from '../api/queries'
import { useEventStore } from '../stores/eventStore'
import { collectProblems } from '../utils/problems'

/** Shared problem list for the status bar and the Overview problems panel. */
export function useWorkspaceProblems() {
  const health = useHealth()
  const adapters = useAdapters()
  const devices = useDevices()
  const faults = useFaults()
  const telemetry = useBusTelemetry()
  const connectionStatus = useEventStore((state) => state.connectionStatus)
  const reconnectAttempt = useEventStore((state) => state.reconnectAttempt)
  const events = useEventStore((state) => state.events)
  const controlApiError = health.isError
  return useMemo(() => collectProblems({
    controlApiError,
    connectionStatus,
    reconnectAttempt,
    adapters: adapters.data,
    devices: devices.data,
    faults: faults.data,
    telemetry: telemetry.data?.buses,
    events,
  }), [adapters.data, connectionStatus, controlApiError, devices.data, events, faults.data, reconnectAttempt, telemetry.data?.buses])
}
