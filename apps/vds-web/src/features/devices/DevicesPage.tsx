import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cable, Orbit, Plus, Power, PowerOff, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import {
  useCreateDevice,
  useAdapters,
  useDeviceCommands,
  useDevice,
  useDeviceTemplates,
  useDevices,
  useDeviceState,
  useFaults,
  useRegisters,
  useResetDevice,
  useScenarios,
  useSetFault,
  useLoadAdapter,
  useUnloadAdapter,
  useWriteRegister,
} from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { SignalConnectionsPanel } from '../../components/SignalConnectionsPanel'
import { useEventStore } from '../../stores/eventStore'
import { AddDeviceDialog } from './AddDeviceDialog'
import { BitfieldInspector } from './BitfieldInspector'
import { DeviceConfiguration } from './DeviceConfiguration'
import { DeviceCommandConsole, DeviceCommandInspector } from './DeviceCommandConsole'
import { DeviceEventBreakdown, DeviceEvents, type DeviceEventFilter } from './DeviceEvents'
import { DeviceFaultInspector, DeviceFaults } from './DeviceFaults'
import { DeviceFooterPanels } from './DeviceFooterPanels'
import { DeviceFlows } from './DeviceFlows'
import { DeviceInstanceList } from './DeviceInstanceList'
import { DeviceProfileCard } from './DeviceProfileCard'
import { DeviceScenarios } from './DeviceScenarios'
import { formatEndpoint } from '../../utils/endpoints'
import { indexAdapterAssignments } from './deviceModel'
import { RegisterMap } from './RegisterMap'
import { RegisterMapOverview } from './RegisterMapOverview'
import './devices.css'

const deviceTabs = [
  { id: 'registers', label: 'Registers' },
  { id: 'commands', label: 'Commands' },
  { id: 'flows', label: 'Behavior' },
  { id: 'scenarios', label: 'Test Scenarios', short: 'Scenarios' },
  { id: 'faults', label: 'Faults' },
  { id: 'events', label: 'Events' },
  { id: 'configuration', label: 'Configuration' },
] as const

type DeviceTab = (typeof deviceTabs)[number]['id']

/** Event kinds after which the runtime's register snapshot may have changed. */
const registerAffectingEvents = new Set(['register_write', 'transaction_completed', 'operation_completed', 'device_reset', 'state_transition'])

function nextDeviceId(ids: string[], selectedId?: string) {
  const source = selectedId ?? ids[0] ?? 'device-0'
  const match = /^(.*?)(\d+)$/.exec(source)
  const prefix = match?.[1] ?? `${source}-`
  let sequence = match ? Number(match[2]) + 1 : 1
  while (ids.includes(`${prefix}${sequence}`)) sequence += 1
  return `${prefix}${sequence}`
}

export function DevicesPage() {
  const { deviceId: routeDeviceId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeTab: DeviceTab = location.pathname.endsWith('/scenarios')
    ? 'scenarios'
    : location.pathname.endsWith('/flows')
      ? 'flows'
      : 'registers'
  const [selectedTab, setActiveTab] = useState<DeviceTab>(routeTab)
  const activeTab = routeTab === 'registers' ? selectedTab : routeTab
  const [showAddDevice, setShowAddDevice] = useState(false)
  const addRequested = searchParams.get('add') === '1'
  const addDialogOpen = showAddDevice || addRequested
  const [selectedRegisterAddress, setSelectedRegisterAddress] = useState<number | null>(null)
  const [scenarioInspectorTarget, setScenarioInspectorTarget] = useState<HTMLDivElement | null>(null)
  const [selectedCommandName, setSelectedCommandName] = useState<string>()
  const [selectedFaultId, setSelectedFaultId] = useState<string>()
  const [eventFilter, setEventFilter] = useState<DeviceEventFilter>({ type: 'all', problemsOnly: false })
  const [configurationDirty, setConfigurationDirty] = useState(false)
  const [configurationBusy, setConfigurationBusy] = useState(false)
  const [configurationSummary, setConfigurationSummary] = useState<{
    devicePath: string
    adapterId: string
    endpoint: number
    driver: string
  }>()
  const configurationSave = useRef<() => void>(() => undefined)
  const updateConfigurationAction = useCallback((next: {
    dirty: boolean
    busy: boolean
    save: () => void
    summary?: { devicePath: string; adapterId: string; endpoint: number; driver: string }
  }) => {
    configurationSave.current = next.save
    setConfigurationDirty((current) => current === next.dirty ? current : next.dirty)
    setConfigurationBusy((current) => current === next.busy ? current : next.busy)
    setConfigurationSummary((current) => JSON.stringify(current) === JSON.stringify(next.summary) ? current : next.summary)
  }, [])
  const devices = useDevices()
  const adapters = useAdapters()
  const deviceTemplates = useDeviceTemplates(addDialogOpen)
  const createDevice = useCreateDevice()
  const deviceId = routeDeviceId ?? devices.data?.[0]?.id
  const device = useDevice(deviceId)
  const commands = useDeviceCommands(activeTab === 'commands' ? deviceId : undefined)
  const state = useDeviceState(deviceId)
  const registers = useRegisters(deviceId)
  const faults = useFaults()
  const scenarios = useScenarios()
  const reset = useResetDevice()
  const loadAdapter = useLoadAdapter()
  const unloadAdapter = useUnloadAdapter()
  const writeRegister = useWriteRegister()
  const faultToggle = useSetFault()
  const events = useEventStore((store) => store.events)
  const deviceFaults = useMemo(() => faults.data?.filter((fault) => fault.device_id === deviceId) ?? [], [deviceId, faults.data])
  const refetchRegisters = registers.refetch
  /** Device-scoped events in chronological order. */
  const deviceEventLog = useMemo(() => events.filter((event) => event.device_id === deviceId), [deviceId, events])
  const deviceEventsNewestFirst = useMemo(() => [...deviceEventLog].reverse(), [deviceEventLog])
  const assignments = useMemo(() => indexAdapterAssignments(adapters.data), [adapters.data])
  const registerList = registers.data ?? []
  const selectedRegister = registerList.find((register) => register.address === selectedRegisterAddress) ?? registerList[0]
  const effectiveSelectedAddress = selectedRegister?.address ?? null
  const selectedCommand = commands.data?.find((command) => command.name === selectedCommandName) ?? commands.data?.[0]
  const selectedFault = deviceFaults.find((fault) => fault.id === selectedFaultId) ?? deviceFaults[0]
  const adapterAssignment = deviceId ? assignments.get(deviceId) : undefined
  const scenarioCount = scenarios.data?.filter((item) => deviceId && item.device_ids.includes(deviceId)).length

  // Keep the register snapshot live: re-read after runtime activity that can change it.
  const lastRegisterEvent = useMemo(() => {
    for (let index = deviceEventLog.length - 1; index >= 0; index -= 1) {
      if (registerAffectingEvents.has(deviceEventLog[index].payload.kind)) return deviceEventLog[index].event_id
    }
    return null
  }, [deviceEventLog])
  const seenRegisterEvent = useRef(lastRegisterEvent)
  useEffect(() => {
    if (lastRegisterEvent === null || lastRegisterEvent === seenRegisterEvent.current) return
    seenRegisterEvent.current = lastRegisterEvent
    const timer = window.setTimeout(() => void refetchRegisters(), 150)
    return () => window.clearTimeout(timer)
  }, [lastRegisterEvent, refetchRegisters])

  const selectTab = (tab: DeviceTab) => {
    setActiveTab(tab)
    if (!deviceId) return
    const base = `/devices/${encodeURIComponent(deviceId)}`
    const target = tab === 'scenarios' ? `${base}/scenarios` : tab === 'flows' ? `${base}/flows` : base
    navigate(target, { replace: true })
  }

  const openAddDevice = () => {
    createDevice.reset()
    setShowAddDevice(true)
  }
  const closeAddDevice = () => {
    setShowAddDevice(false)
    if (addRequested) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('add')
        return next
      }, { replace: true })
    }
  }

  // Registers and commands show their totals in the panel header; tabs only count what is otherwise hidden.
  const tabCounts: Partial<Record<DeviceTab, number | undefined>> = {
    scenarios: scenarioCount,
    faults: faults.data ? deviceFaults.length : undefined,
    events: deviceEventLog.length,
  }

  const renderTabContent = () => {
    if (activeTab === 'registers') {
      if (registers.isPending) return <AsyncState kind="loading" title="Reading registers" />
      if (registers.isError) return <AsyncState detail={registers.error.message} kind="error" title="Registers unavailable" />
      if (registerList.length === 0) return <AsyncState kind="empty" title="No registers exposed" />
      return (
        <RegisterMap
          isRefreshing={registers.isFetching}
          onRefresh={() => void refetchRegisters()}
          onSelect={setSelectedRegisterAddress}
          registers={registerList}
          selectedAddress={effectiveSelectedAddress}
        />
      )
    }

    if (activeTab === 'faults') {
      return (
        <DeviceFaults
          errorMessage={faults.error?.message}
          faults={deviceFaults}
          isLoading={faults.isPending}
          isToggling={faultToggle.isPending}
          onSelect={setSelectedFaultId}
          onToggle={(fault) => faultToggle.mutate({ id: fault.id, enabled: !fault.enabled })}
          selectedId={selectedFault?.id}
          toggleErrorMessage={faultToggle.error?.message}
        />
      )
    }

    if (activeTab === 'flows') return deviceId ? <DeviceFlows deviceId={deviceId} /> : null

    if (activeTab === 'commands') {
      return <DeviceCommandConsole commands={commands.data} errorMessage={commands.error?.message} isLoading={commands.isPending} onSelect={setSelectedCommandName} selectedName={selectedCommand?.name} />
    }

    if (activeTab === 'scenarios') {
      return deviceId ? <DeviceScenarios deviceId={deviceId} inspectorTarget={scenarioInspectorTarget} /> : null
    }

    if (activeTab === 'events') {
      return <DeviceEvents events={deviceEventsNewestFirst} filter={eventFilter} onFilterChange={setEventFilter} />
    }

    if (activeTab === 'configuration') {
      return device.data
        ? (
          <>
            <DeviceConfiguration adapter={adapterAssignment?.adapter} adapters={adapters.data ?? []} binding={adapterAssignment?.binding} device={device.data} onSaveStateChange={updateConfigurationAction} />
            <SignalConnectionsPanel deviceId={device.data.id} />
          </>
        )
        : <AsyncState kind="loading" title="Loading device configuration" />
    }

    return null
  }

  const renderInspectorContent = () => {
    if (activeTab === 'configuration') {
      const summary = configurationSummary ?? (adapterAssignment ? {
        devicePath: adapterAssignment.binding.device_path,
        adapterId: adapterAssignment.adapter.id,
        endpoint: adapterAssignment.binding.endpoint,
        driver: adapterAssignment.adapter.driver,
      } : undefined)
      return (
        <Panel icon={SlidersHorizontal} meta={configurationDirty ? 'unsaved topology' : 'SPI topology'} title="Configuration Inspector">
          {summary
            ? (
              <dl className="kv-grid">
                <div><dt>Device path</dt><dd><code>{summary.devicePath}</code></dd></div>
                <div><dt>Adapter</dt><dd className="mono">{summary.adapterId}</dd></div>
                <div><dt>Chip select</dt><dd className="mono">{formatEndpoint('spi', summary.endpoint)}</dd></div>
                <div><dt>Driver</dt><dd className="mono">{summary.driver}</dd></div>
                {adapterAssignment && <div><dt>Adapter state</dt><dd>{adapterAssignment.adapter.state} · {adapterAssignment.adapter.readiness.replaceAll('_', ' ')}</dd></div>}
              </dl>
            )
            : <AsyncState detail="Save an adapter and chip-select assignment to populate this summary." kind="empty" title="No adapter assigned" />}
        </Panel>
      )
    }

    if (activeTab === 'registers') {
      return (
        <>
          <BitfieldInspector
            errorMessage={writeRegister.error?.message}
            isApplying={writeRegister.isPending}
            key={selectedRegister?.address ?? 'none'}
            onApply={deviceId && selectedRegister
              ? (value) => writeRegister.mutate({ deviceId, address: selectedRegister.address, value })
              : undefined}
            register={selectedRegister}
          />
          {registerList.length > 0 && (
            <RegisterMapOverview
              onSelect={setSelectedRegisterAddress}
              registers={registerList}
              selectedAddress={effectiveSelectedAddress}
            />
          )}
        </>
      )
    }

    if (activeTab === 'flows') {
      return (
        <Panel icon={Orbit} title="Behavior Overview">
          <p className="dv-inspector-note">The behavior model describes how this device reacts whenever the virtual runtime is active.</p>
          <dl className="kv-grid dv-kv-wrap">
            <div><dt>States</dt><dd>Operating modes the device can occupy.</dd></div>
            <div><dt>Transitions</dt><dd>Events and conditions that move it between states.</dd></div>
            <div><dt>Responses</dt><dd>Register, memory and event effects of each interaction.</dd></div>
          </dl>
        </Panel>
      )
    }

    if (activeTab === 'commands') return <DeviceCommandInspector command={selectedCommand} />
    if (activeTab === 'scenarios') return <div className="dv-portal-host" ref={setScenarioInspectorTarget} />
    if (activeTab === 'faults') return <DeviceFaultInspector fault={selectedFault} />
    if (activeTab === 'events') return <DeviceEventBreakdown events={deviceEventLog} filter={eventFilter} onFilterChange={setEventFilter} />
    return null
  }

  const adapterLifecyclePending = loadAdapter.isPending || unloadAdapter.isPending
  const adapterUnloadable = adapterAssignment?.adapter.state === 'loaded' || adapterAssignment?.adapter.state === 'error'
  const adapterNotReady = adapterAssignment ? !adapterUnloadable && adapterAssignment.adapter.readiness !== 'ready' : false
  const managementError = reset.error ?? loadAdapter.error ?? unloadAdapter.error
  const deviceActions = (
    <div aria-label="Device actions" className="dv-head-actions" role="group">
      {activeTab === 'configuration' && (
        <button className={`button button-sm configuration-save${configurationDirty ? ' configuration-save-dirty button-primary' : ''}`} disabled={!configurationDirty || configurationBusy} onClick={() => configurationSave.current()} type="button">
          <Save aria-hidden="true" size={12} /> {configurationBusy ? 'Saving…' : 'Save'}
        </button>
      )}
      {adapterAssignment
        ? (
          <button
            className={`button button-sm${adapterUnloadable ? ' button-danger' : ''}`}
            disabled={adapterLifecyclePending || adapterAssignment.adapter.state === 'loading' || adapterAssignment.adapter.state === 'unloading' || adapterNotReady}
            onClick={() => adapterUnloadable ? unloadAdapter.mutate(adapterAssignment.adapter.id) : loadAdapter.mutate(adapterAssignment.adapter.id)}
            title={adapterNotReady
              ? `${adapterAssignment.adapter.id} cannot load: ${adapterAssignment.adapter.readiness.replaceAll('_', ' ')}`
              : `${adapterAssignment.adapter.id} serves ${adapterAssignment.adapter.bindings.length} attached device${adapterAssignment.adapter.bindings.length === 1 ? '' : 's'}.`}
            type="button"
          >
            {adapterUnloadable ? <PowerOff aria-hidden="true" size={12} /> : <Power aria-hidden="true" size={12} />}
            {adapterLifecyclePending ? 'Working…' : adapterUnloadable ? 'Unload adapter' : 'Load adapter'}
          </button>
        )
        : (
          <button className="button button-sm" disabled={!deviceId} onClick={() => selectTab('configuration')} type="button">
            <Cable aria-hidden="true" size={12} /> Assign adapter
          </button>
        )}
      <button className="button button-sm" disabled={!deviceId || reset.isPending} onClick={() => deviceId && reset.mutate(deviceId)} type="button">
        <RotateCcw aria-hidden="true" size={12} /> {reset.isPending ? 'Resetting…' : 'Reset device'}
      </button>
    </div>
  )

  return (
    <div className="page devices-page">
      <PageHeader
        actions={(
          <button className="button button-primary button-sm" onClick={openAddDevice} type="button">
            <Plus aria-hidden="true" size={12} /> Add Device
          </button>
        )}
        context={devices.data ? `${devices.data.length} instance${devices.data.length === 1 ? '' : 's'}` : undefined}
        title="Devices"
      />

      <div className="page-body fill flush">
        <div className={`dv-workbench${deviceId ? '' : ' no-device'}`}>
          <DeviceInstanceList
            assignments={assignments}
            devices={devices.data ?? []}
            errorMessage={devices.error?.message}
            isLoading={devices.isPending}
            selectedId={deviceId}
          />

          <section aria-label="Device workbench" className="dv-center">
            {devices.isError && <AsyncState detail={devices.error.message} kind="error" title="Registry unavailable" />}
            {!deviceId && !devices.isError && !devices.isPending && <AsyncState centered kind="empty" title="Select a device" detail="Pick an instance on the left, or add one from a configured model." />}
            {deviceId && (
              <>
                {device.isPending && <AsyncState kind="loading" title="Loading device profile" />}
                {device.isError && <AsyncState detail={device.error.message} kind="error" title="Device unavailable" />}
                {device.data && <DeviceProfileCard actions={deviceActions} assignment={adapterAssignment} currentState={state.data?.state ?? device.data.state} device={device.data} />}
                {managementError && <div className="inline-alert error" role="alert"><strong>Device management failed</strong>&nbsp;{managementError.message}</div>}

                <nav aria-label="Device detail sections" className="tabs dv-tabs" role="tablist">
                  {deviceTabs.map((tab) => {
                    const count = tabCounts[tab.id]
                    return (
                      <button
                        aria-controls="device-tab-panel"
                        aria-label={tab.label}
                        aria-selected={activeTab === tab.id}
                        id={`device-tab-${tab.id}`}
                        key={tab.id}
                        onClick={() => selectTab(tab.id)}
                        role="tab"
                        type="button"
                      >
                        {'short' in tab ? tab.short : tab.label}
                        {count !== undefined && <span className="tab-count">{count}</span>}
                      </button>
                    )
                  })}
                </nav>
                <section aria-labelledby={`device-tab-${activeTab}`} className={`dv-tab-body dv-tab-${activeTab}`} id="device-tab-panel" role="tabpanel">
                  {renderTabContent()}
                </section>
                {activeTab !== 'events' && (
                  <DeviceFooterPanels
                    device={device.data}
                    events={deviceEventLog}
                    onSelectRegister={(address) => {
                      setSelectedRegisterAddress(address)
                      if (activeTab !== 'registers') selectTab('registers')
                    }}
                  />
                )}
              </>
            )}
          </section>

          <aside aria-label="Device detail inspector" className="dv-inspector">
            {deviceId && renderInspectorContent()}
          </aside>
        </div>
      </div>

      {addDialogOpen && (
        <AddDeviceDialog
          defaultDeviceId={nextDeviceId((devices.data ?? []).map((item) => item.id), deviceId)}
          errorMessage={createDevice.error?.message}
          isCreating={createDevice.isPending}
          isLoadingTemplates={deviceTemplates.isPending}
          onClose={closeAddDevice}
          onSubmit={(input) => createDevice.mutate(input, {
            onSuccess: (created) => {
              setShowAddDevice(false)
              void navigate(`/devices/${encodeURIComponent(created.id)}`)
            },
          })}
          templates={deviceTemplates.data ?? []}
        />
      )}
    </div>
  )
}
