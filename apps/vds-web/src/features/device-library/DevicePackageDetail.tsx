import { CheckCircle2, Download, FileCode2, PackageCheck, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { LibraryPackage } from './deviceLibraryCatalog'
import { libraryKindLabel } from './deviceLibraryCatalog'

interface DevicePackageDetailProps {
  item: LibraryPackage
  installed: boolean
  onInstalledChange: (installed: boolean) => void
}

export function DevicePackageDetail({ installed, item, onInstalledChange }: DevicePackageDetailProps) {
  return (
    <aside aria-label={`${item.name} package details`} className="library-detail-panel">
      <header className="package-detail-hero">
        {item.image ? (
          <img alt={item.image.alt} className="package-detail-image" src={item.image.src} />
        ) : (
          <span className={`package-detail-acronym package-kind-${item.kind}`}>{item.acronym}</span>
        )}
        <div>
          <p>{libraryKindLabel()}</p>
          <h2>{item.name}</h2>
          <span>VDS4E public-safe local catalog</span>
          <div className="package-trust-badges">
            <b><ShieldCheck aria-hidden="true" size={12} /> Public safe</b>
            <b><PackageCheck aria-hidden="true" size={12} /> Bundled</b>
            <b>
              <CheckCircle2 aria-hidden="true" size={12} />
              {item.readiness === 'runtime_ready' ? 'Runtime ready' : 'Starter template'}
            </b>
          </div>
        </div>
        <div className="package-install-state">
          <strong>
            <CheckCircle2 aria-hidden="true" size={14} />
            {installed ? 'Installed' : 'Not installed'}
          </strong>
          <span>Version {item.version}</span>
        </div>
      </header>

      <dl className="package-stat-grid">
        {item.statistics.map((stat) => (
          <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>
        ))}
      </dl>

      <section className="package-detail-section">
        <header><h3>Capabilities</h3><span>{item.bus}</span></header>
        <div className="package-capabilities">
          {item.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
        </div>
      </section>

      <section className="package-detail-section package-source-section">
        <header><h3>Source &amp; Trust</h3><span>Repository asset</span></header>
        <div>
          <FileCode2 aria-hidden="true" size={16} />
          <span><small>Source</small><code>{item.source}</code></span>
          <ShieldCheck aria-label="Source is public safe" className="source-safe" size={16} />
        </div>
      </section>

      <section className="package-detail-section package-readme">
        <header><h3>README</h3><span>Excerpt</span></header>
        <div>
          <code># {item.name}</code>
          <p>{item.description}</p>
          <strong>Highlights</strong>
          <ul>{item.readme.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      </section>

      <footer className="package-detail-actions">
        {installed ? (
          <>
            <button className="button button-secondary" onClick={() => onInstalledChange(false)} type="button">
              <Trash2 aria-hidden="true" size={14} /> Uninstall
            </button>
            <Link className="button button-primary" to="/devices">
              <Plus aria-hidden="true" size={14} /> Add Device
            </Link>
          </>
        ) : (
          <button className="button button-primary" onClick={() => onInstalledChange(true)} type="button">
            <Download aria-hidden="true" size={14} /> Install
          </button>
        )}
      </footer>
    </aside>
  )
}
