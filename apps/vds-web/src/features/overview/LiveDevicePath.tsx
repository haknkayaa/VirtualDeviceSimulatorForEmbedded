import { CircuitBoard, Columns4, Cpu, MemoryStick, Monitor, Plus, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAdapters, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { Panel } from '../../components/Panel'
import { useNow } from '../../hooks/useNow'
import type { Adapter, Device } from '../../types/api'
import { humanize } from '../../utils/format'
import type { LiveTransaction } from '../transactions/transactionModel'
import { buildDevicePath, linkActivity, unboundDevices, type LinkActivity } from './overviewModel'

const deviceIcons: Record<string, LucideIcon> = { spi: Cpu, i2c: MemoryStick, gpio: Columns4 }

const escapeSelector = (value: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'))

interface Connector {
  id: string
  d: string
  bus: string
  kind: 'trunk' | LinkActivity['kind']
  failed?: boolean
}

function adapterStatus(adapter: Adapter) {
  if (adapter.state === 'loaded') return { tone: 'ok', text: 'Loaded · Ready' }
  if (adapter.state === 'error') return { tone: 'err', text: 'Error' }
  if (adapter.state === 'loading' || adapter.state === 'unloading') return { tone: 'warn', text: humanize(adapter.state) }
  if (adapter.readiness === 'unavailable') return { tone: 'warn', text: `Not loaded · ${adapter.driver} missing` }
  if (adapter.readiness === 'authorization_required') return { tone: 'warn', text: 'Not loaded · needs authorization' }
  return { tone: 'warn', text: 'Not loaded · ready to load' }
}

function deviceStatus(device: Device | undefined) {
  if (!device) return { tone: 'err', text: 'Missing' }
  if (!device.state) return { tone: 'ok', text: 'Ready' }
  if (device.state === 'ready' || device.state === 'idle') return { tone: 'ok', text: humanize(device.state) }
  if (/error|fault/.test(device.state)) return { tone: 'err', text: humanize(device.state) }
  return { tone: 'warn', text: humanize(device.state) }
}

function GpioEdgeGlyph() {
  return (
    <svg aria-hidden="true" className="ldp-edge-glyph" viewBox="0 0 40 12">
      <path d="M0 10h8V2h10v8h10V2h12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** Elbow path from (x1,y1) to (x2,y2) turning at x = mid. */
function elbow(x1: number, y1: number, x2: number, y2: number, mid: number, radius = 6) {
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`
  const r = Math.min(radius, Math.abs(y2 - y1) / 2, Math.abs(mid - x1), Math.abs(x2 - mid))
  const dir = y2 > y1 ? 1 : -1
  return `M${x1},${y1} H${mid - r} Q${mid},${y1} ${mid},${y1 + dir * r} V${y2 - dir * r} Q${mid},${y2} ${mid + r},${y2} H${x2}`
}

/** Application → adapter (Linux ABI) → virtual device, with live link activity. */
export function LiveDevicePath({ transactions }: { transactions: LiveTransaction[] }) {
  const adapters = useAdapters()
  const devices = useDevices()
  const now = useNow(1_000)
  const groups = buildDevicePath(adapters.data, devices.data)
  const unbound = unboundDevices(adapters.data, devices.data)
  const containerRef = useRef<HTMLDivElement>(null)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })

  const activities = new Map<string, LinkActivity>()
  for (const group of groups) {
    for (const link of group.links) {
      activities.set(`${group.adapter.id}:${link.binding.device_id}`, linkActivity(group.adapter, link.binding.device_id, transactions, now))
    }
  }
  const activityKey = [...activities].map(([key, activity]) => `${key}=${activity.kind}${'failed' in activity && activity.failed ? '!' : ''}`).join('|')
  const layoutKey = groups.map((group) => `${group.adapter.id}:${group.links.length}`).join('|')

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const measure = () => {
      const origin = container.getBoundingClientRect()
      const rect = (selector: string) => {
        const element = container.querySelector<HTMLElement>(selector)
        if (!element) return undefined
        const box = element.getBoundingClientRect()
        return { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top, cy: box.top - origin.top + box.height / 2 }
      }
      const app = rect('[data-node="app"]')
      const next: Connector[] = []
      for (const group of groups) {
        const adapterBox = rect(`[data-node="adapter:${escapeSelector(group.adapter.id)}"]`)
        if (!app || !adapterBox) continue
        next.push({ id: `trunk:${group.adapter.id}`, bus: group.adapter.bus_type.toLowerCase(), kind: 'trunk', d: elbow(app.right, app.cy, adapterBox.left, adapterBox.cy, app.right + (adapterBox.left - app.right) / 2) })
        for (const link of group.links) {
          const deviceBox = rect(`[data-node="device:${escapeSelector(group.adapter.id)}:${escapeSelector(link.binding.device_id)}"]`)
          if (!deviceBox) continue
          const activity = activities.get(`${group.adapter.id}:${link.binding.device_id}`)
          next.push({
            id: `link:${group.adapter.id}:${link.binding.device_id}`,
            bus: group.adapter.bus_type.toLowerCase(),
            kind: activity?.kind ?? 'idle',
            failed: activity?.kind === 'active' ? activity.failed : false,
            d: elbow(adapterBox.right, adapterBox.cy, deviceBox.left, deviceBox.cy, adapterBox.right + 20),
          })
        }
      }
      setConnectors(next)
      setSize({ width: container.scrollWidth, height: container.scrollHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
    // Geometry depends only on which boxes exist and on link state, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, activityKey])

  const startRows = groups.map((_, index) => 1 + groups.slice(0, index).reduce((total, group) => total + group.links.length, 0))
  return (
    <Panel className="overview-path" flush title="Live device path">
      {(adapters.isPending || devices.isPending) && <AsyncState kind="loading" title="Reading topology" />}
      {adapters.isError && <AsyncState detail={adapters.error.message} kind="error" title="Adapter topology unavailable" />}
      {adapters.data && groups.length === 0 && (
        <div className="ldp-empty">
          <AsyncState detail="An adapter exposes a virtual device to your application as /dev/spidevX.Y, /dev/i2c-N or /dev/gpiochipN." kind="empty" title="No device is bound to an adapter yet" />
          <Link className="button button-primary" to="/adapters?new=1"><Plus aria-hidden="true" size={14} /> New adapter</Link>
        </div>
      )}
      {groups.length > 0 && (
        <div className="ldp" ref={containerRef}>
          <svg aria-hidden="true" className="ldp-wires" height={size.height} width={size.width}>
            {connectors.map((connector) => (
              <g className={`ldp-wire wire-${connector.kind}${connector.failed ? ' wire-failed' : ''} bus-${connector.bus}`} key={connector.id}>
                <path className="ldp-wire-base" d={connector.d} />
                {connector.kind === 'active' && <path className="ldp-wire-flow" d={connector.d} />}
              </g>
            ))}
          </svg>
          <div className="ldp-columns" aria-hidden="true">
            <span className="ldp-col-label ldp-col-runtime">Host ABI / runtime</span>
            <span className="ldp-col-label ldp-col-devices">Virtual devices (peripherals)</span>
          </div>
          <div className="ldp-grid">
            <div className="ldp-box ldp-app" data-node="app" style={{ gridRow: `1 / span ${Math.max(1, groups.reduce((total, group) => total + group.links.length, 0))}` }}>
              <Monitor aria-hidden="true" className="ldp-box-icon accent" size={28} strokeWidth={1.5} />
              <strong>Application under test</strong>
              <span>Native x86_64 · Linux device ABI</span>
            </div>
            {groups.map((group, groupIndex) => {
              const status = adapterStatus(group.adapter)
              const groupRow = startRows[groupIndex]
              return [
                <Link
                  className={`ldp-box ldp-adapter bus-${group.adapter.bus_type.toLowerCase()}`}
                  data-node={`adapter:${group.adapter.id}`}
                  key={`adapter:${group.adapter.id}`}
                  style={{ gridRow: `${groupRow} / span ${group.links.length}` }}
                  to={`/adapters?adapter=${encodeURIComponent(group.adapter.id)}`}
                >
                  <CircuitBoard aria-hidden="true" className="ldp-box-icon" size={24} strokeWidth={1.5} />
                  <span className="ldp-box-text">
                    <strong>{group.adapter.name} / {group.adapter.driver.toUpperCase()}</strong>
                    <span className={`ldp-status ${status.tone}`}><i className={`status-dot ${status.tone}`} />{status.text}</span>
                    <code>{group.adapter.device_path ?? group.links[0]?.binding.device_path}</code>
                  </span>
                </Link>,
                ...group.links.map((link, index) => {
                  const activity = activities.get(`${group.adapter.id}:${link.binding.device_id}`)
                  const status = deviceStatus(link.device)
                  const Icon = deviceIcons[group.adapter.bus_type.toLowerCase()] ?? Cpu
                  const gridRow = groupRow + index
                  return [
                    <span className={`ldp-link-label link-${activity?.kind ?? 'idle'}${activity?.kind === 'active' && activity.failed ? ' failed' : ''}`} key={`label:${link.binding.device_id}`} style={{ gridRow }}>
                      {activity?.kind === 'active' && activity.edge ? <GpioEdgeGlyph /> : null}
                      {activity?.label}
                    </span>,
                    <Link
                      className="ldp-box ldp-device"
                      data-node={`device:${group.adapter.id}:${link.binding.device_id}`}
                      key={`device:${link.binding.device_id}`}
                      style={{ gridRow }}
                      to={`/devices/${encodeURIComponent(link.binding.device_id)}`}
                    >
                      <Icon aria-hidden="true" className="ldp-box-icon" size={26} strokeWidth={1.5} />
                      <span className="ldp-box-text">
                        <span className="ldp-device-head">
                          <strong title={link.binding.device_id}>{link.device?.name ?? link.binding.device_id}</strong>
                          <span className={`ldp-status ${status.tone}`}><i className={`status-dot ${status.tone}`} />{status.text}</span>
                        </span>
                        <span className="ldp-device-desc">{link.device?.model ?? humanize(link.device?.type ?? `${group.adapter.bus_type.toUpperCase()} device`)}</span>
                        <code>{link.binding.device_path}</code>
                      </span>
                    </Link>,
                  ]
                }),
              ]
            })}
          </div>
          {unbound.length > 0 && (
            <p className="ldp-unbound">
              {unbound.length} device{unbound.length === 1 ? ' is' : 's are'} not bound to an adapter: {unbound.map((device) => device.id).join(', ')}.{' '}
              <Link className="inline-link" to="/adapters">Bind in Adapters</Link>
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
