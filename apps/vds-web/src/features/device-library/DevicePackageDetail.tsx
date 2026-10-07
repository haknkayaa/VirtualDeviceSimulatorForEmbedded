import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDeviceCommands, useDeviceTemplates, useRegisters } from '../../api/queries'
import { BusTag } from '../../components/BusTag'
import { StatusBadge } from '../../components/StatusBadge'
import type { LibraryPackage } from './deviceLibraryCatalog'
import { PackageThumb } from './DevicePackageList'
import type { PackageInstance } from './packageInstances'

interface DevicePackageDetailProps {
  item: LibraryPackage
  instance?: PackageInstance
}

function countLabel(query: { data?: unknown[]; isPending: boolean; isError: boolean }) {
  if (query.data) return String(query.data.length)
  if (query.isError) return '—'
  return query.isPending ? '…' : '—'
}

/** Instance-backed runtime facts. Only queried when a device instance exists. */
function RuntimeFacts({ instance }: { instance: PackageInstance & { device: NonNullable<PackageInstance['device']> } }) {
  const registers = useRegisters(instance.device.id)
  const commands = useDeviceCommands(instance.device.id)
  return (
    <>
      <div><dt>Device</dt><dd><Link className="dl-link mono" to={`/devices/${encodeURIComponent(instance.device.id)}`}>{instance.device.id}</Link></dd></div>
      <div><dt>State</dt><dd>{instance.device.state ? <StatusBadge status={instance.device.state} /> : <span className="faint">no state machine</span>}</dd></div>
      <div><dt>Registers</dt><dd className="mono">{countLabel(registers)}</dd></div>
      <div><dt>Commands</dt><dd className="mono">{countLabel(commands)}</dd></div>
    </>
  )
}

export function DevicePackageDetail({ item, instance }: DevicePackageDetailProps) {
  const templates = useDeviceTemplates()
  const template = templates.data?.find((candidate) => candidate.id === item.id)

  return (
    <section aria-label={`${item.name} package details`} className="panel dl-detail">
      <header className="dl-detail-head">
        <PackageThumb item={item} size="lg" />
        <div className="dl-detail-title">
          <h2>{item.name}</h2>
          <span className="dl-detail-sub">
            <code>{item.id}</code>
            <BusTag bus={item.bus} />
            <code>v{item.version}</code>
          </span>
        </div>
        <Link className="button button-primary dl-detail-action" to="/devices?add=1">
          <Plus aria-hidden="true" size={13} /> Add Device
        </Link>
      </header>

      <div className="dl-detail-body">
        <section className="dl-section">
          <h3 className="panel-section-title">Package</h3>
          <dl className="kv-grid dl-kv">
            <div><dt>Package ID</dt><dd className="mono">{item.id}</dd></div>
            <div><dt>Display name</dt><dd>{item.name}</dd></div>
            {template && template.name !== item.name && <div><dt>Model name</dt><dd>{template.name}</dd></div>}
            <div><dt>Version</dt><dd className="mono">{item.version}</dd></div>
            <div><dt>Bus</dt><dd className="mono">{item.bus.toUpperCase()}</dd></div>
            <div><dt>Runtime model</dt><dd className="mono">{template?.model ?? '—'}</dd></div>
            <div><dt>Status</dt><dd className="package-install-state"><strong>Installed</strong></dd></div>
            <div><dt>Image asset</dt><dd className="mono">{item.image ? 'yes' : 'none'}</dd></div>
            <div><dt>Store path</dt><dd className="mono" title="Default package store; VDS4E_DEVICE_STORE overrides it">{item.storePath}</dd></div>
          </dl>
        </section>

        <section className="dl-section">
          <h3 className="panel-section-title">Runtime instance</h3>
          {instance?.device || instance?.binding ? (
            <dl className="kv-grid dl-kv">
              {instance.device && <RuntimeFacts instance={{ ...instance, device: instance.device }} />}
              <div>
                <dt>Adapter</dt>
                <dd>
                  {instance.adapter
                    ? <Link className="dl-link mono" to={`/adapters?adapter=${encodeURIComponent(instance.adapter.id)}`}>{instance.adapter.id}</Link>
                    : <span className="faint">not attached</span>}
                  {instance.adapter && <span className="faint"> · {instance.adapter.state}</span>}
                </dd>
              </div>
              <div>
                <dt>Linux node</dt>
                <dd className="mono">
                  {instance.nodePath
                    ? <span className={instance.exposed ? '' : 'dl-node-down'} title={instance.exposed ? 'Exposed to applications' : 'Not exposed: adapter is not loaded'}>{instance.nodePath}</span>
                    : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="dl-empty">No runtime device has been created from this package. Use <strong>Add Device</strong>, then attach it to an adapter to expose a Linux node.</p>
          )}
        </section>
      </div>
    </section>
  )
}
