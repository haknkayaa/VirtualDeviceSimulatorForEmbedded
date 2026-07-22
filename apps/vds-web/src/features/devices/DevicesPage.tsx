import { Power, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

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
import { StatusBadge } from '../../components/StatusBadge'
import { formatHex, humanize } from '../../utils/format'

export function DevicesPage() {
  const { deviceId: routeDeviceId } = useParams()
  const devices = useDevices()
  const deviceId = routeDeviceId ?? devices.data?.[0]?.id
  const device = useDevice(deviceId)
  const state = useDeviceState(deviceId)
  const registers = useRegisters(deviceId)
  const faults = useFaults()
  const reset = useResetDevice()
  const faultToggle = useSetFault()
  const deviceFaults = faults.data?.filter((fault) => fault.device_id === deviceId) ?? []

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Runtime inventory" title="Devices" description="Inspect authoritative device state and operate only through public control APIs." />
      <div className="devices-layout">
        <GlassPanel className="device-list-panel" eyebrow="Registry" title="Loaded devices">
          {devices.isPending && <AsyncState kind="loading" title="Loading registry" />}
          {devices.isError && <AsyncState detail={devices.error.message} kind="error" title="Registry unavailable" />}
          {devices.data?.length === 0 && <AsyncState kind="empty" title="No devices loaded" />}
          <nav className="device-nav" aria-label="Device list">
            {devices.data?.map((item) => (
              <Link className={item.id === deviceId ? 'device-link active' : 'device-link'} key={item.id} to={`/devices/${encodeURIComponent(item.id)}`}>
                <span className="device-bus">{item.bus.toUpperCase()}</span>
                <div><strong>{item.id}</strong><StatusBadge status={item.state} /></div>
              </Link>
            ))}
          </nav>
        </GlassPanel>
        <div className="device-detail-stack">
          {!deviceId && <GlassPanel><AsyncState kind="empty" title="Select a device" /></GlassPanel>}
          {device.isError && <GlassPanel><AsyncState detail={device.error.message} kind="error" title="Device unavailable" /></GlassPanel>}
          {device.data && (
            <GlassPanel
              eyebrow={`${device.data.bus.toUpperCase()} device`}
              title={device.data.id}
              action={
                <button className="button button-secondary" disabled={reset.isPending} onClick={() => reset.mutate(device.data.id)} type="button">
                  <RotateCcw size={16} /> {reset.isPending ? 'Resetting' : 'Reset'}
                </button>
              }
            >
              <div className="device-summary">
                <div><span>Current state</span><StatusBadge status={state.data?.state ?? device.data.state} /></div>
                <div><span>Bus</span><strong>{humanize(device.data.bus)}</strong></div>
                <div><span>Registers</span><strong>{registers.data?.length ?? '—'}</strong></div>
                <div><span>Fault profiles</span><strong>{deviceFaults.length}</strong></div>
              </div>
              {reset.isError && <AsyncState detail={reset.error.message} kind="error" title="Reset failed" />}
            </GlassPanel>
          )}
          <GlassPanel eyebrow="Authoritative snapshot" title="Register table">
            {registers.isPending && deviceId && <AsyncState kind="loading" title="Reading registers" />}
            {registers.isError && <AsyncState detail={registers.error.message} kind="error" title="Registers unavailable" />}
            {registers.data?.length === 0 && <AsyncState kind="empty" title="No registers exposed" />}
            {registers.data && registers.data.length > 0 && (
              <div className="table-scroll"><table>
                <thead><tr><th>Name</th><th>Address</th><th>Width</th><th>Access</th><th>Value</th></tr></thead>
                <tbody>{registers.data.map((register) => (
                  <tr key={register.address}><td><strong>{register.name}</strong></td><td className="mono">{formatHex(register.address)}</td><td>{register.width_bits} bit</td><td>{register.access.toUpperCase()}</td><td className="mono value-cell">{formatHex(register.value, register.width_bits)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </GlassPanel>
          <GlassPanel eyebrow="Deterministic controls" title="Fault profiles">
            {faults.isPending && <AsyncState kind="loading" title="Loading faults" />}
            {faults.isError && <AsyncState detail={faults.error.message} kind="error" title="Faults unavailable" />}
            {deviceFaults.length === 0 && !faults.isPending && <AsyncState kind="empty" title="No faults defined for this device" />}
            <div className="fault-list">
              {deviceFaults.map((fault) => (
                <article className="fault-row" key={fault.id}>
                  <div className="fault-icon"><Power size={17} /></div>
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
        </div>
      </div>
    </div>
  )
}
