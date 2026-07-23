import { CheckCircle2, Code2, FileCode2, GitBranch, PackageCheck, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { LibraryPackage } from './deviceLibraryCatalog'
import { libraryKindLabel } from './deviceLibraryCatalog'

interface DevicePackageDetailProps {
  item: LibraryPackage
}

export function DevicePackageDetail({ item }: DevicePackageDetailProps) {
  return (
    <aside aria-label={`${item.name} package details`} className="library-detail-panel">
      <header className="package-detail-hero">
        <span className={`package-detail-acronym package-kind-${item.kind}`}>{item.acronym}</span>
        <div>
          <p>{libraryKindLabel(item.kind)}</p>
          <h2>{item.name}</h2>
          <span>VDS4E public-safe local catalog</span>
          <div className="package-trust-badges">
            <b><ShieldCheck aria-hidden="true" size={12} /> Public safe</b>
            <b><PackageCheck aria-hidden="true" size={12} /> Bundled</b>
            <b><CheckCircle2 aria-hidden="true" size={12} /> Schema validated</b>
          </div>
        </div>
        <div className="package-install-state">
          <strong><CheckCircle2 aria-hidden="true" size={14} /> Available locally</strong>
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
        <button className="button button-secondary" disabled title="Package export requires a reviewed package service." type="button">
          <Code2 aria-hidden="true" size={14} /> Export package
        </button>
        {item.editorPath ? (
          <Link className="button button-primary" to={item.editorPath}>
            <GitBranch aria-hidden="true" size={14} /> Open in editor
          </Link>
        ) : (
          <button className="button button-primary" disabled type="button"><GitBranch aria-hidden="true" size={14} /> No visual flow</button>
        )}
      </footer>
    </aside>
  )
}
