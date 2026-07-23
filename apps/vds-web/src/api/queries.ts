import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client'
import type { CreateDeviceInput, RunStatus } from '../types/api'

export const queryKeys = {
  health: ['health'] as const,
  devices: ['devices'] as const,
  deviceTemplates: ['device-models'] as const,
  device: (id: string) => ['devices', id] as const,
  registers: (id: string) => ['devices', id, 'registers'] as const,
  state: (id: string) => ['devices', id, 'state'] as const,
  faults: ['faults'] as const,
  scenarios: ['scenarios'] as const,
  scenario: (id: string) => ['scenarios', id] as const,
  run: (id: string) => ['runs', id] as const,
  runResult: (id: string) => ['runs', id, 'result'] as const,
}

const terminalRunStatuses = new Set<RunStatus>(['passed', 'failed', 'cancelled', 'timed_out'])

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 5_000, retry: 1 })
}

export function useDevices() {
  return useQuery({ queryKey: queryKeys.devices, queryFn: api.devices })
}

export function useDeviceTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.deviceTemplates,
    queryFn: api.deviceTemplates,
    enabled,
  })
}

export function useCreateDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDeviceInput) => api.createDevice(input),
    onSuccess: (device) => {
      queryClient.setQueryData(queryKeys.device(device.id), device)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.faults }),
      ])
    },
  })
}

export function useDevice(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.device(id ?? ''),
    queryFn: () => api.device(id as string),
    enabled: Boolean(id),
  })
}

export function useRegisters(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.registers(id ?? ''),
    queryFn: () => api.registers(id as string),
    enabled: Boolean(id),
  })
}

export function useDeviceState(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.state(id ?? ''),
    queryFn: () => api.state(id as string),
    enabled: Boolean(id),
  })
}

export function useFaults() {
  return useQuery({ queryKey: queryKeys.faults, queryFn: api.faults })
}

export function useResetDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.reset,
    onSuccess: (_, deviceId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.device(deviceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.state(deviceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.registers(deviceId) }),
      ]),
  })
}

export function useSetFault() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.setFault(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.faults }),
  })
}

export function useScenarios() {
  return useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios })
}

export function useScenario(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenario(id ?? ''),
    queryFn: () => api.scenario(id as string),
    enabled: Boolean(id),
  })
}

export function useStartScenario() {
  return useMutation({ mutationFn: api.runScenario })
}

export function useStartScenarioDefinition() {
  return useMutation({ mutationFn: api.runScenarioDefinition })
}

export function useRun(id: string | null) {
  return useQuery({
    queryKey: queryKeys.run(id ?? ''),
    queryFn: () => api.run(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && terminalRunStatuses.has(status) ? false : 500
    },
  })
}

export function useRunResult(id: string | null, status: RunStatus | undefined) {
  return useQuery({
    queryKey: queryKeys.runResult(id ?? ''),
    queryFn: () => api.runResult(id as string),
    enabled: Boolean(id && status && terminalRunStatuses.has(status)),
    retry: false,
  })
}

export function useDownloadRunJunit() {
  return useMutation({ mutationFn: api.runResultJunit })
}
