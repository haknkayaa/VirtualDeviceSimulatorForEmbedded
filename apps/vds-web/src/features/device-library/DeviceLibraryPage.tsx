import { Ellipsis, PackageOpen, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '../../components/PageHeader'
import { DevicePackageDetail } from './DevicePackageDetail'
import { DevicePackageList } from './DevicePackageList'
import { deviceLibraryCatalog } from './deviceLibraryCatalog'

export function DeviceLibraryPage() {
  const [query, setQuery] = useState('')
  const [bus, setBus] = useState('all')
  const [selectedId, setSelectedId] = useState(deviceLibraryCatalog[0].id)
  const packages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return deviceLibraryCatalog.filter((item) => {
      const matchesBus = bus === 'all' || item.bus === bus
      const searchable = [item.name, item.description, item.source, ...item.capabilities].join(' ').toLowerCase()
      return matchesBus && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [bus, query])
  const selected = deviceLibraryCatalog.find((item) => item.id === selectedId) ?? deviceLibraryCatalog[0]

  return (
    <div className="page-stack device-library-page">
      <PageHeader
        action={(
          <div className="library-page-actions">
            <button className="button button-secondary" disabled title="Backend package export is not available." type="button">
              <Upload aria-hidden="true" size={14} /> Export package
            </button>
            <button aria-label="More library actions" className="icon-button" disabled type="button"><Ellipsis aria-hidden="true" size={16} /></button>
          </div>
        )}
        description="Discover and inspect public-safe device models and visual authoring assets bundled with VDS4E."
        eyebrow="Device Library / Local Package Catalog"
        title="Device Library"
      />
      <nav aria-label="Library collections" className="library-tabs">
        <button aria-pressed="true" className="active" type="button">Installed <span>{deviceLibraryCatalog.length}</span></button>
        <button disabled title="Community registry is not connected." type="button">Community <span>0</span></button>
        <button disabled title="Private registry is not configured." type="button">Private Registry <span>0</span></button>
        <button disabled title="Package update checks require a registry connection." type="button">Updates <span>0</span></button>
      </nav>
      <div className="device-library-workspace">
        <DevicePackageList
          bus={bus}
          onBusChange={setBus}
          onQueryChange={setQuery}
          onSelect={setSelectedId}
          packages={packages}
          query={query}
          selectedId={selected.id}
        />
        <DevicePackageDetail item={selected} />
      </div>
      <div className="library-local-note"><PackageOpen aria-hidden="true" size={13} /> Local assets only · no package registry or install API is enabled.</div>
    </div>
  )
}
