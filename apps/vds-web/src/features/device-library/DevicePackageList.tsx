import { Cpu } from 'lucide-react'
import { memo } from 'react'

import { AsyncState } from '../../components/AsyncState'
import { BusTag } from '../../components/BusTag'
import type { LibraryPackage } from './deviceLibraryCatalog'
import type { PackageInstance } from './packageInstances'

interface DevicePackageListProps {
  instances: Map<string, PackageInstance>
  onSelect: (id: string) => void
  packages: LibraryPackage[]
  selectedId: string
}

export function PackageThumb({ item, size = 'sm' }: { item: LibraryPackage; size?: 'sm' | 'lg' }) {
  return item.image
    ? <img alt={item.image.alt} className={`dl-thumb dl-thumb-${size}`} loading="lazy" src={item.image.src} />
    : <span aria-hidden="true" className={`dl-thumb dl-thumb-${size} dl-monogram bus-${item.bus}`}><Cpu size={size === 'lg' ? 22 : 14} /></span>
}

const PackageRow = memo(function PackageRow({ item, instance, selected, onSelect }: {
  item: LibraryPackage
  instance?: PackageInstance
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={`list-row dl-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(item.id)}
      type="button"
    >
      <PackageThumb item={item} />
      <span className="dl-row-name">
        <strong className="truncate">{item.name}</strong>
        <code className="truncate">{item.id}</code>
      </span>
      <BusTag bus={item.bus} />
      <code className="dl-row-version">{item.version}</code>
      <span className="dl-row-node truncate">
        {instance?.nodePath
          ? <code className={instance.exposed ? '' : 'dl-node-down'}>{instance.nodePath}</code>
          : <span className="faint">{instance?.device ? 'unbound' : '—'}</span>}
      </span>
    </button>
  )
})

/** Dense package catalog: one row per installed package with its runtime node, if any. */
export function DevicePackageList({ instances, onSelect, packages, selectedId }: DevicePackageListProps) {
  return (
    <section aria-label="Local package catalog" className="panel flush dl-list">
      <div aria-hidden="true" className="dl-row dl-list-head">
        <span />
        <span>Package</span>
        <span>Bus</span>
        <span>Version</span>
        <span>Linux node</span>
      </div>
      <div className="dl-list-body">
        {packages.map((item) => (
          <PackageRow
            instance={instances.get(item.id)}
            item={item}
            key={item.id}
            onSelect={onSelect}
            selected={selectedId === item.id}
          />
        ))}
        {packages.length === 0 && (
          <AsyncState detail="Try a different search or bus filter." kind="empty" title="No matching local packages" />
        )}
      </div>
    </section>
  )
}
