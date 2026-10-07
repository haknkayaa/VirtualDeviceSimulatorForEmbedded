import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAdapters, useBusTelemetry, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import { useEventStore } from '../../stores/eventStore'
import type { Adapter } from '../../types/api'
import { formatEndpoint } from '../../utils/endpoints'
import { buildDeviceNodeRows, type DeviceNodeRow } from './overviewModel'

function adapterTone(state: Adapter['state']) {
  if (state === 'loaded') return 'ok'
  if (state === 'error') return 'err'
  if (state === 'loading' || state === 'unloading') return 'warn'
  return 'warn'
}

function adapterStateLabel(adapter: Adapter) {
  if (adapter.state === 'unloaded') return 'not loaded'
  return adapter.state
}

function DeviceState({ state }: { state: string | null | undefined }) {
  if (!state) return <span className="dim" title="The device model does not report a runtime state">—</span>
  return <StatusBadge status={state} />
}

function NodeRow({ row, onOpen }: { row: DeviceNodeRow; onOpen: (row: DeviceNodeRow) => void }) {
  const adapter = row.adapter
  const loaded = adapter?.state === 'loaded'
  const errors = row.telemetry?.errors.count ?? 0
  return (
    <tr className="clickable" onClick={() => onOpen(row)}>
      <td>
        <span className="node-cell">
          <BusTag bus={adapter?.bus_type ?? row.device?.bus} />
          {row.binding
            ? <code className={loaded ? 'node-path' : 'node-path node-path-down'} title={loaded ? 'Open for applications' : 'Not open: the adapter is not loaded'}>{row.binding.device_path}</code>
            : <span className="dim">no node</span>}
          {row.binding && adapter && <span className="node-endpoint">{formatEndpoint(adapter.bus_type, row.binding.endpoint)}</span>}
        </span>
      </td>
      <td>
        {adapter
          ? <span className="node-adapter"><i className={`status-dot ${adapterTone(adapter.state)}`} /><code>{adapter.id}</code><span className={loaded ? 'dim' : 'node-adapter-state'}>{adapterStateLabel(adapter)}</span></span>
          : <span className="dim">not bound</span>}
      </td>
      <td>{row.deviceId ? <strong className="node-device">{row.device?.name ?? row.deviceId}</strong> : <span className="dim">no device attached</span>}</td>
      <td>{row.deviceId ? <DeviceState state={row.device?.state} /> : null}</td>
      <td className="num">
        {row.telemetry ? `${row.telemetry.transactions_total} txns` : '—'}
        {errors > 0 && <span className="text-err"> · {errors} err</span>}
      </td>
    </tr>
  )
}

/** One row per Linux device node an application can open; unbound items fold below. */
export function DeviceNodesPanel() {
  const navigate = useNavigate()
  const adapters = useAdapters()
  const devices = useDevices()
  const telemetry = useBusTelemetry()
  const events = useEventStore((state) => state.events)
  const [showUnbound, setShowUnbound] = useState(false)
  const rows = useMemo(
    () => buildDeviceNodeRows(adapters.data, devices.data, telemetry.data?.buses, events),
    [adapters.data, devices.data, events, telemetry.data?.buses],
  )
  const bound = rows.filter((row) => row.binding)
  const unbound = rows.filter((row) => !row.binding)
  const open = bound.filter((row) => row.adapter?.state === 'loaded').length
  const unboundDevices = unbound.filter((row) => row.deviceId)
  const emptyAdapters = unbound.filter((row) => !row.deviceId)
  const openRow = (row: DeviceNodeRow) => navigate(row.deviceId
    ? `/devices/${encodeURIComponent(row.deviceId)}`
    : `/adapters?adapter=${encodeURIComponent(row.adapter?.id ?? '')}`)
  const unboundSummary = [
    unboundDevices.length ? `${unboundDevices.length} device${unboundDevices.length === 1 ? '' : 's'} not bound to an adapter` : '',
    emptyAdapters.length ? `${emptyAdapters.length} adapter${emptyAdapters.length === 1 ? '' : 's'} without a device` : '',
  ].filter(Boolean).join(' · ')

  return (
    <Panel
      className="overview-nodes"
      flush
      meta={adapters.data ? `${open} open · ${bound.length} bound` : undefined}
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
              <th>Adapter</th>
              <th>Device</th>
              <th>State</th>
              <th className="num">Traffic</th>
            </tr>
          </thead>
          <tbody>
            {bound.map((row) => <NodeRow key={row.key} onOpen={openRow} row={row} />)}
            {unbound.length > 0 && (
              <tr className="group-row unbound-toggle">
                <td colSpan={5}>
                  <button aria-expanded={showUnbound} onClick={() => setShowUnbound((current) => !current)} type="button">
                    {showUnbound ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                    {unboundSummary}
                  </button>
                </td>
              </tr>
            )}
            {showUnbound && unbound.map((row) => <NodeRow key={row.key} onOpen={openRow} row={row} />)}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
