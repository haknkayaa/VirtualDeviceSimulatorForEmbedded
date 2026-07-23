import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ellipsis, Pencil, Power, RadioTower, RefreshCw, RotateCcw } from 'lucide-react'
import { useParams } from 'react-router-dom'

import {
  useDevice,
  useDevices,
  useDeviceState,
  useFaults,
  useRegisters,
  useResetDevice,
  useSetFault,
} from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { GlassPanel } from '../../components/GlassPanel'
import { PageHeader } from '../../components/PageHeader'
import { VirtualEventList } from '../../components/VirtualEventList'
import { useEventStore } from '../../stores/eventStore'
import { humanize } from '../../utils/format'
import { BitfieldInspector } from './BitfieldInspector'
import { DeviceFooterPanels } from './DeviceFooterPanels'
import { DeviceProfileCard } from './DeviceProfileCard'
import { RegisterMap } from './RegisterMap'
import { RegisterMapOverview } from './RegisterMapOverview'

const deviceTabs = [
  { id: 'registers', label: 'Registers' },
  { id: 'commands', label: 'Commands' },
  { id: 'memory', label: 'Memory' },
  { id: 'state-machine', label: 'State Machine' },
  { id: 'faults', label: 'Faults' },
  { id: 'events', label: 'Events' },
  { id: 'configuration', label: 'Configuration' },
] as const

type DeviceTab = (typeof deviceTabs)[number]['id']

const unavailableTabCopy: Record<Exclude<DeviceTab, 'registers' | 'faults' | 'events'>, string> = {
  commands: 'Command metadata is not exposed by the current Control API.',
  memory: 'Memory inspection is not exposed by the current Control API.',
  'state-machine': 'State-machine definitions are not exposed by the current Control API.',
  configuration: 'Device configuration is not exposed by the current Control API.',
}

export function DevicesPage() {
  const { deviceId: routeDeviceId } = useParams()
  const [activeTab, setActiveTab] = useState<DeviceTab>('registers')
  const [liveRead, setLiveRead] = useState(false)
  const [selectedRegisterAddress, setSelectedRegisterAddress] = useState<number | null>(null)
  const devices = useDevices()
  const deviceId = routeDeviceId ?? devices.data?.[0]?.id
  const device = useDevice(deviceId)
  const state = useDeviceState(deviceId)
  const registers = useRegisters(deviceId)
  const faults = useFaults()
  const reset = useResetDevice()
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

    if (activeTab === 'events') {
      return (
        <GlassPanel eyebrow="Domain telemetry" title="Device events">
          {deviceEvents.length === 0
            ? <AsyncState kind="empty" title="No events retained for this device" />
            : <VirtualEventList compact events={deviceEvents} />}
        </GlassPanel>
      )
    }

    return (
      <GlassPanel eyebrow="Control API boundary" title={deviceTabs.find((tab) => tab.id === activeTab)?.label ?? activeTab}>
        <AsyncState detail={unavailableTabCopy[activeTab]} kind="empty" title="Not exposed yet" />
      </GlassPanel>
    )
  }

  const renderInspectorContent = () => {
    if (activeTab === 'registers') {
      return (
        <>
          <BitfieldInspector key={selectedRegister?.address ?? 'none'} register={selectedRegister} />
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
      <button className="button button-secondary" disabled title="Device editing is not available in this phase." type="button">
        <Pencil aria-hidden="true" size={15} /> Edit
      </button>
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
    <div className="page-stack">
      <PageHeader
        description="Inspect authoritative device state and operate only through public control APIs."
        eyebrow="Runtime inventory"
        title="Devices"
      />

      {!deviceId && <GlassPanel><AsyncState kind="empty" title="Select a device" /></GlassPanel>}
      {device.isPending && deviceId && <GlassPanel><AsyncState kind="loading" title="Loading device profile" /></GlassPanel>}
      {device.isError && <GlassPanel><AsyncState detail={device.error.message} kind="error" title="Device unavailable" /></GlassPanel>}
      {device.data && <DeviceProfileCard actions={deviceActions} currentState={state.data?.state ?? device.data.state} device={device.data} />}
      {reset.isError && <AsyncState detail={reset.error.message} kind="error" title="Reset failed" />}

      <div className="device-workspace-layout">
        <div className="device-workspace-main">
          <nav aria-label="Device detail sections" className="device-detail-tabs" role="tablist">
            {deviceTabs.map((tab) => (
              <button
                aria-controls="device-tab-panel"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                id={`device-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
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
  )
}
