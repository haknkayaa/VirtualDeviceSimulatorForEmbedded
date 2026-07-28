import { Boxes, CheckCircle2, Search, SlidersHorizontal } from 'lucide-react'

import type { LibraryPackage } from './deviceLibraryCatalog'
import { libraryKindLabel } from './deviceLibraryCatalog'

interface DevicePackageListProps {
  bus: string
  onBusChange: (bus: string) => void
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
  packages: LibraryPackage[]
  query: string
  selectedId: string
}

export function DevicePackageList({
  bus,
  onBusChange,
  onQueryChange,
  onSelect,
  packages,
  query,
  selectedId,
}: DevicePackageListProps) {
  return (
    <section aria-label="Local package catalog" className="library-browser-panel">
      <div className="library-search-row">
        <label className="library-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="Search device packages"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search packages, capabilities, sources…"
            type="search"
            value={query}
          />
        </label>
        <select aria-label="Filter packages by bus" onChange={(event) => onBusChange(event.target.value)} value={bus}>
          <option value="all">All buses</option>
          <option value="SPI">SPI</option>
          <option value="I2C">I2C</option>
          <option value="GPIO">GPIO</option>
        </select>
        <button className="button button-secondary" disabled title="Additional registry filters require a package service." type="button">
          <SlidersHorizontal aria-hidden="true" size={14} /> More filters
        </button>
      </div>
      <header className="library-list-header">
        <div><Boxes aria-hidden="true" size={14} /><strong>List</strong></div>
        <span>{packages.length} local packages</span>
      </header>
      <div className="library-package-list">
        {packages.map((item) => (
          <button
            aria-pressed={selectedId === item.id}
            className={`library-package-row${selectedId === item.id ? ' selected' : ''}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            {item.image ? (
              <img alt={item.image.alt} className="package-row-image" src={item.image.src} />
            ) : (
              <span className={`package-acronym package-kind-${item.kind}`}>{item.acronym}</span>
            )}
            <span className="package-row-copy">
              <strong>{item.name}</strong>
              <small>{item.source}</small>
              <span>{item.description}</span>
            </span>
            <span className="package-row-meta">
              <i>{item.bus}</i>
              <i>v{item.version}</i>
              <b>
                <CheckCircle2 aria-hidden="true" size={11} />
                Installed
              </b>
            </span>
            <span className="package-row-kind">{libraryKindLabel()}</span>
          </button>
        ))}
        {packages.length === 0 && (
          <div className="library-empty">
            <Search aria-hidden="true" size={20} />
            <strong>No matching local packages</strong>
            <span>Try a different search or bus filter.</span>
          </div>
        )}
      </div>
      <footer className="library-list-footer">
        <span>Showing {packages.length} bundled assets</span>
        <span>Local catalog · read-only</span>
      </footer>
    </section>
  )
}
