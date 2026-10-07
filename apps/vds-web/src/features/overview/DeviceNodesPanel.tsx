import { Network } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAdapters, useBusTelemetry, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import { formatWallTime } from '../../utils/events'
import { formatEndpoint } from '../../utils/endpoints'
import { buildDeviceNodeRows } from './overviewModel'

function adapterTone(state: string) {
  if (state === 'loaded') return 'ok'
  if (state === 'error') return 'err'
  if (state === 'loading' || state === 'unloading') return 'warn'
  return ''
}

/** Linux device node → adapter → virtual device, with live bus counters. */
export function DeviceNodesPanel() {
  const navigate = useNavigate()
  const adapters = useAdapters()
  const devices = useDevices()
  const telemetry = useBusTelemetry()
  const events = useEventStore((state) => state.events)
  const rows = useMemo(
    () => buildDeviceNodeRows(adapters.data, devices.data, telemetry.data?.buses, events),
    [adapters.data, devices.data, events, telemetry.data?.buses],
  )
  const exposed = rows.filter((row) => row.binding && row.adapter?.state === 'loaded').length

  return (
    <Panel
      className="overview-nodes"
      flush
      icon={Network}
      meta={adapters.data ? `${exposed} exposed · ${rows.filter((row) => row.binding).length} bound` : undefined}
      title="Device nodes"
    >
      {(adapters.isPending || devices.isPending) && <AsyncState kind="loading" title="Reading topology" />}
      {adapters.isError && <AsyncState detail={adapters.error.message} kind="error" title="Adapter topology unavailable" />}
      {adapters.data && devices.data && rows.length === 0 && (
        <AsyncState detail="Create an adapter, then attach a device to expose a /dev node." kind="empty" title="No adapters or devices configured" />
      )}
      {rows.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Bus</th>
              <th>Adapter</th>
              <th>EP</th>
              <th>Device</th>
              <th>State</th>
              <th className="num">Txns</th>
              <th className="num">Err</th>
              <th className="num">p95</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const loaded = row.adapter?.state === 'loaded'
              const bus = row.adapter?.bus_type ?? row.device?.bus
              const errors = row.telemetry?.errors.count ?? 0
              return (
                <tr
                  className="clickable"
                  key={row.key}
                  onClick={() => navigate(row.deviceId ? `/devices/${encodeURIComponent(row.deviceId)}` : `/adapters?adapter=${encodeURIComponent(row.adapter?.id ?? '')}`)}
                >
                  <td>
                    {row.binding
                      ? <code className={loaded ? 'node-path' : 'node-path node-path-down'} title={loaded ? 'Exposed to applications' : 'Not exposed: adapter is not loaded'}>{row.binding.device_path}</code>
                      : <span className="dim">—</span>}
                  </td>
                  <td><BusTag bus={bus} /></td>
                  <td>
                    {row.adapter
                      ? <span className="node-adapter"><i className={`status-dot ${adapterTone(row.adapter.state)}`} /><code>{row.adapter.id}</code><span className="dim">{row.adapter.state}</span></span>
                      : <span className="dim">unbound</span>}
                  </td>
                  <td className="mono">{row.binding && row.adapter ? formatEndpoint(row.adapter.bus_type, row.binding.endpoint) : '—'}</td>
                  <td>{row.deviceId ? <strong className="node-device">{row.device?.name ?? row.deviceId}</strong> : <span className="dim">no device attached</span>}</td>
                  <td>{row.deviceId ? <StatusBadge status={row.device?.state ?? 'unknown'} /> : null}</td>
                  <td className="num">{row.telemetry?.transactions_total ?? '—'}</td>
                  <td className={`num${errors ? ' text-err' : ''}`}>{row.telemetry ? errors : '—'}</td>
                  <td className="num">{row.telemetry && row.telemetry.transactions_total > 0 ? `${row.telemetry.latency.wall_p95_us.toFixed(0)} µs` : '—'}</td>
                  <td className="mono dim">{row.lastActivityWallNs ? formatWallTime(row.lastActivityWallNs) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
