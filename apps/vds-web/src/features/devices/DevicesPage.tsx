import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cable, Plus, Power, PowerOff, RotateCcw, Save } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

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
  useSetFault,
  useLoadAdapter,
  useUnloadAdapter,
  useWriteRegister,
} from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'
import { VirtualEventList } from '../../components/VirtualEventList'
import { useEventStore } from '../../stores/eventStore'
import { humanize } from '../../utils/format'
import { AddDeviceDialog } from './AddDeviceDialog'
import { BitfieldInspector } from './BitfieldInspector'
import { DeviceConfiguration } from './DeviceConfiguration'
import { DeviceCommandConsole, DeviceCommandInspector } from './DeviceCommandConsole'
import { DeviceFooterPanels } from './DeviceFooterPanels'
import { DeviceFlows } from './DeviceFlows'
import { DeviceInstanceList } from './DeviceInstanceList'
import { DeviceProfileCard } from './DeviceProfileCard'
import { DeviceScenarios } from './DeviceScenarios'
import { RegisterMap } from './RegisterMap'
import { RegisterMapOverview } from './RegisterMapOverview'

const deviceTabs = [
  { id: 'registers', label: 'Registers' },
  { id: 'commands', label: 'Commands' },
  { id: 'flows', label: 'Device Behavior' },
  { id: 'scenarios', label: 'Test Scenarios' },
  { id: 'faults', label: 'Faults' },
  { id: 'events', label: 'Events' },
  { id: 'configuration', label: 'Configuration' },
] as const

type DeviceTab = (typeof deviceTabs)[number]['id']

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
  const routeTab: DeviceTab = location.pathname.endsWith('/scenarios')
    ? 'scenarios'
    : location.pathname.endsWith('/flows')
      ? 'flows'
      : 'registers'
  const [selectedTab, setActiveTab] = useState<DeviceTab>(routeTab)
  const activeTab = routeTab === 'registers' ? selectedTab : routeTab
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [selectedRegisterAddress, setSelectedRegisterAddress] = useState<number | null>(null)
  const [scenarioInspectorTarget, setScenarioInspectorTarget] = useState<HTMLDivElement | null>(null)
  const [selectedCommandName, setSelectedCommandName] = useState<string>()
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
  const deviceTemplates = useDeviceTemplates(showAddDevice)
  const createDevice = useCreateDevice()
  const deviceId = routeDeviceId ?? devices.data?.[0]?.id
  const device = useDevice(deviceId)
  const commands = useDeviceCommands(activeTab === 'commands' ? deviceId : undefined)
  const state = useDeviceState(deviceId)
  const registers = useRegisters(deviceId)
  const faults = useFaults()
  const reset = useResetDevice()
  const loadAdapter = useLoadAdapter()
  const unloadAdapter = useUnloadAdapter()
  const writeRegister = useWriteRegister()
  const faultToggle = useSetFault()
  const events = useEventStore((store) => store.events)
  const deviceFaults = faults.data?.filter((fault) => fault.device_id === deviceId) ?? []
  const refetchRegisters = registers.refetch
  const deviceEvents = useMemo(
    () => events.filter((event) => event.device_id === deviceId).slice(-100).reverse(),
    [deviceId, events],
  )
  const registerList = registers.data ?? []
  const selectedRegister = registerList.find((register) => register.address === selectedRegisterAddress) ?? registerList[0]
  const effectiveSelectedAddress = selectedRegister?.address ?? null
  const selectedCommand = commands.data?.find((command) => command.name === selectedCommandName) ?? commands.data?.[0]
  const adapterAssignment = adapters.data
    ?.flatMap((adapter) => adapter.bindings.map((binding) => ({ adapter, binding })))
    .find(({ binding }) => binding.device_id === deviceId)

  const renderTabContent = () => {
    if (activeTab === 'registers') {
      return (
        <>
          {registers.isPending && deviceId && <AsyncState kind="loading" title="Reading registers" />}
          {registers.isError && <AsyncState detail={registers.error.message} kind="error" title="Registers unavailable" />}
          {registers.data?.length === 0 && <AsyncState kind="empty" title="No registers exposed" />}
          {registers.data && registers.data.length > 0 && (
            <RegisterMap
              onSelect={setSelectedRegisterAddress}
              registers={registers.data}
              selectedAddress={effectiveSelectedAddress}
            />
          )}
        </>
      )
    }

    if (activeTab === 'faults') {
      return (
        <GlassPanel eyebrow="Deterministic controls" title="Fault profiles">
          {faults.isPending && <AsyncState kind="loading" title="Loading faults" />}
          {faults.isError && <AsyncState detail={faults.error.message} kind="error" title="Faults unavailable" />}
          {deviceFaults.length === 0 && !faults.isPending && <AsyncState kind="empty" title="No faults defined for this device" />}
          <div className="fault-list">
            {deviceFaults.map((fault) => (
              <article className="fault-row" key={fault.id}>
                <div className="fault-icon"><Power aria-hidden="true" size={17} /></div>
                <div><strong>{fault.id}</strong><span>{humanize(fault.action)} · {humanize(fault.trigger)} · priority {fault.priority}</span></div>
                <button
                  aria-label={`${fault.enabled ? 'Disable' : 'Enable'} ${fault.id}`}
                  aria-pressed={fault.enabled}
                  className={`toggle ${fault.enabled ? 'active' : ''}`}
                  disabled={faultToggle.isPending}
                  onClick={() => faultToggle.mutate({ id: fault.id, enabled: !fault.enabled })}
                  type="button"
                ><span /></button>
              </article>
            ))}
          </div>
          {faultToggle.isError && <AsyncState detail={faultToggle.error.message} kind="error" title="Fault update failed" />}
        </GlassPanel>
      )
    }

    if (activeTab === 'flows') {
      return deviceId ? <DeviceFlows deviceId={deviceId} /> : null
    }

    if (activeTab === 'commands') {
      return deviceId ? <DeviceCommandConsole commands={commands.data} errorMessage={commands.error?.message} isLoading={commands.isPending} onSelect={setSelectedCommandName} selectedName={selectedCommand?.name} /> : null
    }

    if (activeTab === 'scenarios') {
      return deviceId ? <DeviceScenarios deviceId={deviceId} inspectorTarget={scenarioInspectorTarget} /> : null
    }

    if (activeTab === 'events') {
      return (
        <GlassPanel eyebrow="Domain telemetry" title="Device events">
          {deviceEvents.length === 0
            ? <AsyncState kind="empty" title="No events retained for this device" />
            : <VirtualEventList compact events={deviceEvents} />}
        </GlassPanel>
      )
    }

    if (activeTab === 'configuration') {
      return device.data
        ? <DeviceConfiguration adapter={adapterAssignment?.adapter} adapters={adapters.data ?? []} binding={adapterAssignment?.binding} device={device.data} onSaveStateChange={updateConfigurationAction} />
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
        <GlassPanel className="device-context-inspector" eyebrow={configurationDirty ? 'Unsaved topology' : 'SPI topology'} title="Configuration Inspector">
          {summary
            ? <dl className="device-configuration-grid configuration-inspector-grid">
              <div><dt>Device path</dt><dd><code>{summary.devicePath}</code></dd></div>
              <div><dt>Adapter</dt><dd>{summary.adapterId}</dd></div>
              <div><dt>Chip select</dt><dd>CS{summary.endpoint}</dd></div>
              <div><dt>Driver</dt><dd>{summary.driver.toUpperCase()}</dd></div>
            </dl>
            : <AsyncState detail="Save an adapter and chip-select assignment to populate this summary." kind="empty" title="No adapter assigned" />}
        </GlassPanel>
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
          <RegisterMapOverview
            onSelect={setSelectedRegisterAddress}
            registers={registerList}
            selectedAddress={effectiveSelectedAddress}
          />
        </>
      )
    }

    if (activeTab === 'flows') {
      return (
        <GlassPanel className="device-context-inspector behavior-overview" eyebrow="Runtime model" title="Behavior Overview">
          <p className="behavior-overview-intro">
            Describes how this device behaves whenever the virtual runtime is active.
          </p>
          <dl className="behavior-overview-parts">
            <div><dt>States</dt><dd>The operating modes the device can occupy.</dd></div>
            <div><dt>Transitions</dt><dd>The events and conditions that move it between states.</dd></div>
            <div><dt>Responses</dt><dd>The register, memory, and event effects produced by each interaction.</dd></div>
          </dl>
        </GlassPanel>
      )
    }

    if (activeTab === 'commands') {
      return <DeviceCommandInspector command={selectedCommand} />
    }

    if (activeTab === 'scenarios') {
      return <div className="scenario-inspector-host" ref={setScenarioInspectorTarget} />
    }

    const label = deviceTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab
    return (
      <GlassPanel className="device-context-inspector" title={`${label} Inspector`}>
        <AsyncState detail={`Select items in ${label} to inspect their details here.`} kind="empty" title="No item selected" />
      </GlassPanel>
    )
  }

  const adapterLifecyclePending = loadAdapter.isPending || unloadAdapter.isPending
  const adapterUnloadable = adapterAssignment?.adapter.state === 'loaded' || adapterAssignment?.adapter.state === 'error'
  const deviceActions = (
    <div aria-label="Device actions" className="device-page-actions" role="group">
      {adapterAssignment
        ? <button
          className={`button ${adapterUnloadable ? 'button-danger' : 'button-primary'}`}
          disabled={adapterLifecyclePending || adapterAssignment.adapter.state === 'loading' || adapterAssignment.adapter.state === 'unloading' || (!adapterUnloadable && adapterAssignment.adapter.readiness !== 'ready')}
          onClick={() => adapterUnloadable ? unloadAdapter.mutate(adapterAssignment.adapter.id) : loadAdapter.mutate(adapterAssignment.adapter.id)}
          title={`${adapterAssignment.adapter.id} serves ${adapterAssignment.adapter.bindings.length} attached device${adapterAssignment.adapter.bindings.length === 1 ? '' : 's'}.`}
          type="button"
        >
          {adapterUnloadable ? <PowerOff aria-hidden="true" size={15} /> : <Power aria-hidden="true" size={15} />}
          {adapterLifecyclePending ? 'Working…' : adapterUnloadable ? 'Unload adapter' : 'Load adapter'}
        </button>
        : <button className="button button-secondary" disabled={!deviceId} onClick={() => { setActiveTab('configuration'); if (deviceId) navigate(`/devices/${encodeURIComponent(deviceId)}`, { replace: true }) }} type="button">
          <Cable aria-hidden="true" size={15} /> Assign adapter
        </button>}
      <button className="button button-secondary" disabled={!deviceId || reset.isPending} onClick={() => deviceId && reset.mutate(deviceId)} type="button">
        <RotateCcw aria-hidden="true" size={15} /> {reset.isPending ? 'Resetting…' : 'Reset device'}
      </button>
    </div>
  )

  const workspaceUtilities = activeTab === 'configuration' ? (
    <div aria-label="Device workspace tools" className="device-workspace-utilities" role="group">
      <button className={`button configuration-save${configurationDirty ? ' configuration-save-dirty' : ''}`} disabled={!configurationDirty || configurationBusy} onClick={() => configurationSave.current()} type="button">
        <Save aria-hidden="true" size={15} /> {configurationBusy ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : null

  return (
    <div className="page-stack devices-page">
      <PageHeader
        action={(
          <button
            className="button button-primary"
            onClick={() => {
              createDevice.reset()
              setShowAddDevice(true)
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={14} /> Add Device
          </button>
        )}
        description="Inspect authoritative device state and operate only through public control APIs."
        eyebrow="Runtime inventory"
        title="Devices"
      />

      <div className="devices-page-layout">
        <DeviceInstanceList
          devices={devices.data ?? []}
          errorMessage={devices.error?.message}
          isLoading={devices.isPending}
          selectedId={deviceId}
        />
        <div className="device-detail-page">
          {!deviceId && <GlassPanel><AsyncState kind="empty" title="Select a device" /></GlassPanel>}
          {device.isPending && deviceId && <GlassPanel><AsyncState kind="loading" title="Loading device profile" /></GlassPanel>}
          {device.isError && <GlassPanel><AsyncState detail={device.error.message} kind="error" title="Device unavailable" /></GlassPanel>}
          {device.data && <DeviceProfileCard actions={deviceActions} currentState={state.data?.state ?? device.data.state} device={device.data} />}
          {(reset.isError || loadAdapter.isError || unloadAdapter.isError) && <AsyncState detail={(reset.error ?? loadAdapter.error ?? unloadAdapter.error)?.message} kind="error" title="Device management failed" />}

          {workspaceUtilities}

          <div className={`device-workspace-layout${activeTab === 'registers' ? ' register-workspace-layout' : ''}`}>
            <div className="device-workspace-main">
              <nav aria-label="Device detail sections" className="device-detail-tabs" role="tablist">
                {deviceTabs.map((tab) => (
                  <button
                    aria-controls="device-tab-panel"
                    aria-selected={activeTab === tab.id}
                    className={activeTab === tab.id ? 'active' : ''}
                    id={`device-tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id)
                      if (deviceId) {
                        const base = `/devices/${encodeURIComponent(deviceId)}`
                        const target = tab.id === 'scenarios'
                          ? `${base}/scenarios`
                          : tab.id === 'flows'
                            ? `${base}/flows`
                            : base
                        navigate(target, { replace: true })
                      }
                    }}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <section aria-labelledby={`device-tab-${activeTab}`} className="device-detail-stack" id="device-tab-panel" role="tabpanel">
                {devices.isError && <GlassPanel><AsyncState detail={devices.error.message} kind="error" title="Registry unavailable" /></GlassPanel>}
                {deviceId ? renderTabContent() : <GlassPanel><AsyncState kind="empty" title="Select a device to inspect this section" /></GlassPanel>}
              </section>
            </div>
            <aside aria-label="Device detail inspector" className="device-inspector-column">
              {renderInspectorContent()}
            </aside>
          </div>
          {deviceId && (
            <DeviceFooterPanels
              key={selectedRegister?.address ?? 'none'}
              currentState={state.data?.state ?? device.data?.state ?? null}
              device={device.data}
              events={deviceEvents}
              isRefreshing={registers.isFetching}
              onRefreshRegisters={() => void refetchRegisters()}
              onSelectRegister={setSelectedRegisterAddress}
              registers={registerList}
              selectedRegister={selectedRegister}
            />
          )}
        </div>
      </div>
      {showAddDevice && (
        <AddDeviceDialog
          defaultDeviceId={nextDeviceId((devices.data ?? []).map((item) => item.id), deviceId)}
          errorMessage={createDevice.error?.message}
          isCreating={createDevice.isPending}
          isLoadingTemplates={deviceTemplates.isPending}
          onClose={() => setShowAddDevice(false)}
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
