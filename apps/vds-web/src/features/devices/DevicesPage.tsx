import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ellipsis, Pencil, Power, RadioTower, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import {
  useCreateDevice,
  useAdapters,
  useDevice,
  useDeviceTemplates,
  useDevices,
  useDeviceState,
  useFaults,
  useRegisters,
  useResetDevice,
  useSetFault,
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
import { DeviceCommandConsole } from './DeviceCommandConsole'
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
  { id: 'flows', label: 'Flows' },
  { id: 'scenarios', label: 'Scenarios' },
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
  const [liveRead, setLiveRead] = useState(false)
  const [showAddDevice, setShowAddDevice] = useState(false)
  const [selectedRegisterAddress, setSelectedRegisterAddress] = useState<number | null>(null)
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
  const state = useDeviceState(deviceId)
  const registers = useRegisters(deviceId)
  const faults = useFaults()
  const reset = useResetDevice()
  const writeRegister = useWriteRegister()
  const faultToggle = useSetFault()
  const events = useEventStore((store) => store.events)
  const deviceFaults = faults.data?.filter((fault) => fault.device_id === deviceId) ?? []
  const refetchDevices = devices.refetch
  const refetchDevice = device.refetch
  const refetchState = state.refetch
  const refetchRegisters = registers.refetch
  const refetchFaults = faults.refetch
  const deviceEvents = useMemo(
    () => events.filter((event) => event.device_id === deviceId).slice(-100).reverse(),
    [deviceId, events],
  )
  const registerList = registers.data ?? []
  const selectedRegister = registerList.find((register) => register.address === selectedRegisterAddress) ?? registerList[0]
  const effectiveSelectedAddress = selectedRegister?.address ?? null
  const isRefreshing = devices.isFetching || device.isFetching || state.isFetching || registers.isFetching || faults.isFetching
  const adapterAssignment = adapters.data
    ?.flatMap((adapter) => adapter.bindings.map((binding) => ({ adapter, binding })))
    .find(({ binding }) => binding.device_id === deviceId)

  const refresh = useCallback(() => {
    void Promise.all([
      refetchDevices(),
      refetchDevice(),
      refetchState(),
      refetchRegisters(),
      refetchFaults(),
    ])
  }, [refetchDevice, refetchDevices, refetchFaults, refetchRegisters, refetchState])

  useEffect(() => {
    if (!liveRead) return
    const interval = window.setInterval(refresh, 1_000)
    return () => window.clearInterval(interval)
  }, [liveRead, refresh])

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
      return deviceId ? <DeviceCommandConsole deviceId={deviceId} /> : null
    }

    if (activeTab === 'scenarios') {
      return deviceId ? <DeviceScenarios deviceId={deviceId} /> : null
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

    const label = deviceTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab
    return (
      <GlassPanel className="device-context-inspector" title={`${label} Inspector`}>
        <AsyncState detail={`Select items in ${label} to inspect their details here.`} kind="empty" title="No item selected" />
      </GlassPanel>
    )
  }

  const deviceActions = (
    <div aria-label="Device actions" className="device-page-actions" role="group">
      <button className="button button-secondary" disabled={!deviceId || isRefreshing} onClick={refresh} type="button">
        <RefreshCw aria-hidden="true" className={isRefreshing ? 'spin' : ''} size={15} />
        {isRefreshing ? 'Refreshing' : 'Refresh'}
      </button>
      <button
        aria-pressed={liveRead}
        className={`button button-secondary${liveRead ? ' active' : ''}`}
        disabled={!deviceId}
        onClick={() => setLiveRead((enabled) => !enabled)}
        type="button"
      >
        <RadioTower aria-hidden="true" size={15} /> Live Read
      </button>
      {activeTab === 'configuration'
        ? <button className={`button configuration-save${configurationDirty ? ' configuration-save-dirty' : ''}`} disabled={!configurationDirty || configurationBusy} onClick={() => configurationSave.current()} type="button">
          <Save aria-hidden="true" size={15} /> {configurationBusy ? 'Saving…' : 'Save'}
        </button>
        : <button className="button button-secondary" disabled title="Device editing is not available in this phase." type="button">
          <Pencil aria-hidden="true" size={15} /> Edit
        </button>}
      <details className="device-more-menu">
        <summary className="button button-secondary"><Ellipsis aria-hidden="true" size={16} /> More</summary>
        <div className="device-more-popover">
          <button disabled={!deviceId || reset.isPending} onClick={() => deviceId && reset.mutate(deviceId)} type="button">
            <RotateCcw aria-hidden="true" size={15} /> {reset.isPending ? 'Resetting device' : 'Reset device'}
          </button>
        </div>
      </details>
    </div>
  )

  return (
    <div className="page-stack devices-page">
      <PageHeader
        description="Inspect authoritative device state and operate only through public control APIs."
        eyebrow="Runtime inventory"
        title="Devices"
      />

      <div className="devices-page-layout">
        <DeviceInstanceList
          devices={devices.data ?? []}
          errorMessage={devices.error?.message}
          isLoading={devices.isPending}
          onAdd={() => {
            createDevice.reset()
            setShowAddDevice(true)
          }}
          selectedId={deviceId}
        />
        <div className="device-detail-page">
          {!deviceId && <GlassPanel><AsyncState kind="empty" title="Select a device" /></GlassPanel>}
          {device.isPending && deviceId && <GlassPanel><AsyncState kind="loading" title="Loading device profile" /></GlassPanel>}
          {device.isError && <GlassPanel><AsyncState detail={device.error.message} kind="error" title="Device unavailable" /></GlassPanel>}
          {device.data && <DeviceProfileCard actions={deviceActions} currentState={state.data?.state ?? device.data.state} device={device.data} />}
          {reset.isError && <AsyncState detail={reset.error.message} kind="error" title="Reset failed" />}

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
              liveRead={liveRead}
              onLiveReadChange={setLiveRead}
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
