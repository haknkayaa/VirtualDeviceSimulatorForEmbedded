import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client'
import type { AttachAdapterDeviceInput, CreateAdapterInput, CreateDeviceInput, DeviceRegister, ExecuteDeviceCommandInput, RunStatus, WriteDeviceRegisterInput } from '../types/api'

export const queryKeys = {
  health: ['health'] as const,
  clock: ['clock'] as const,
  busTelemetry: ['telemetry', 'buses'] as const,
  devices: ['devices'] as const,
  adapters: ['adapters'] as const,
  deviceTemplates: ['device-models'] as const,
  device: (id: string) => ['devices', id] as const,
  deviceFlow: (id: string) => ['devices', id, 'flow'] as const,
  deviceCommands: (id: string) => ['devices', id, 'commands'] as const,
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

export function useClock() {
  return useQuery({
    queryKey: queryKeys.clock,
    queryFn: api.clock,
    refetchInterval: 1_000,
    retry: 1,
  })
}

export function useBusTelemetry() {
  return useQuery({
    queryKey: queryKeys.busTelemetry,
    queryFn: api.busTelemetry,
    refetchInterval: 2_000,
  })
}

export function useDevices() {
  return useQuery({ queryKey: queryKeys.devices, queryFn: api.devices })
}

export function useAdapters() {
  return useQuery({ queryKey: queryKeys.adapters, queryFn: api.adapters, refetchInterval: 2_000 })
}

function useAdapterMutation<T>(mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adapters }),
  })
}

export function useCreateAdapter() {
  return useAdapterMutation<CreateAdapterInput>(api.createAdapter)
}

export function useLoadAdapter() {
  return useAdapterMutation<string>(api.loadAdapter)
}

export function useUnloadAdapter() {
  return useAdapterMutation<string>(api.unloadAdapter)
}

export function useAttachAdapterDevice() {
  return useAdapterMutation<AttachAdapterDeviceInput>(api.attachAdapterDevice)
}

export function useDetachAdapterDevice() {
  return useAdapterMutation<{ adapterId: string; deviceId: string }>(api.detachAdapterDevice)
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

export function useDeviceFlow(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deviceFlow(id ?? ''),
    queryFn: () => api.deviceFlow(id as string),
    enabled: Boolean(id),
    retry: false,
  })
}

export function useDeviceCommands(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deviceCommands(id ?? ''),
    queryFn: () => api.deviceCommands(id as string),
    enabled: Boolean(id),
  })
}

export function useExecuteDeviceCommand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ExecuteDeviceCommandInput) => api.executeDeviceCommand(input),
    onSuccess: (result, input) => {
      queryClient.setQueryData(queryKeys.registers(input.deviceId), result.registers)
      queryClient.setQueryData(queryKeys.state(input.deviceId), {
        device_id: input.deviceId,
        state: result.state,
      })
    },
  })
}

export function useRegisters(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.registers(id ?? ''),
    queryFn: () => api.registers(id as string),
    enabled: Boolean(id),
  })
}

export function useWriteRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: WriteDeviceRegisterInput) => api.writeRegister(input),
    onSuccess: (updated, input) => {
      queryClient.setQueryData<DeviceRegister[]>(queryKeys.registers(input.deviceId), (current) =>
        current?.map((register) => register.address === updated.address ? updated : register) ?? [updated],
      )
    },
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
