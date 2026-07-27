import { Download, Ellipsis, PackageOpen, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api/client'
import { PageHeader } from '../../components/PageHeader'
import type { ImportedDevicePackage } from '../../types/api'
import { DevicePackageDetail } from './DevicePackageDetail'
import { DevicePackageList } from './DevicePackageList'
import { deviceLibraryCatalog, type LibraryPackage } from './deviceLibraryCatalog'

const INSTALL_STATE_KEY = 'vds4e.device-library.installed-packages'

function initialInstalledPackages() {
  const fallback = deviceLibraryCatalog.map((item) => item.id)
  try {
    const stored = window.localStorage.getItem(INSTALL_STATE_KEY)
    if (!stored) return new Set(fallback)
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set(fallback)
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set(fallback)
  }
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

function importedCatalogItem(imported: ImportedDevicePackage): LibraryPackage {
  const bus = imported.bus.toUpperCase()
  const supportedBus = bus === 'I2C' || bus === 'ETHERNET' ? (bus === 'ETHERNET' ? 'Ethernet' : 'I2C') : 'SPI'
  return {
    id: imported.id,
    name: imported.name,
    acronym: imported.name.slice(0, 4).toUpperCase(),
    kind: 'device_model',
    readiness: 'runtime_ready',
    bus: supportedBus,
    version: imported.version,
    source: `~/vsd4e/devices/${imported.id}`,
    description: 'Imported local VDS4E device package.',
    capabilities: [`${supportedBus} package`, 'Imported locally'],
    statistics: [{ label: 'Status', value: 'Installed' }],
    readme: ['Validated and installed through the local package service.'],
  }
}

export function DeviceLibraryPage() {
  const importInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [bus, setBus] = useState('all')
  const [selectedId, setSelectedId] = useState(deviceLibraryCatalog[0].id)
  const [catalog, setCatalog] = useState<LibraryPackage[]>(deviceLibraryCatalog)
  const [installedPackages, setInstalledPackages] = useState(initialInstalledPackages)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  useEffect(() => {
    void api.devicePackages().then((installed) => {
      setCatalog((current) => {
        const knownIds = new Set(current.map((item) => item.id))
        return [...current, ...installed.filter((item) => !knownIds.has(item.id)).map(importedCatalogItem)]
      })
      setInstalledPackages((current) => {
        const next = new Set(current)
        installed.forEach((item) => next.add(item.id))
        window.localStorage.setItem(INSTALL_STATE_KEY, JSON.stringify([...next]))
        return next
      })
    }).catch(() => {
      setImportMessage('Package service is unavailable')
    })
  }, [])
  const packages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return catalog.filter((item) => {
      const matchesBus = bus === 'all' || item.bus === bus
      const searchable = [item.name, item.description, item.source, ...item.capabilities].join(' ').toLowerCase()
      return matchesBus && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [bus, catalog, query])
  const selected = catalog.find((item) => item.id === selectedId) ?? catalog[0]
  const setPackageInstalled = (installed: boolean) => {
    setInstalledPackages((current) => {
      const next = new Set(current)
      if (installed) next.add(selected.id)
      else next.delete(selected.id)
      window.localStorage.setItem(INSTALL_STATE_KEY, JSON.stringify([...next]))
      return next
    })
  }
  const importPackage = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    setImportMessage('')
    try {
      const entries = await Promise.all([...files].map(async (file) => {
        const relativePath = file.webkitRelativePath || file.name
        const segments = relativePath.split('/').filter(Boolean)
        const path = segments.length > 1 ? segments.slice(1).join('/') : segments[0]
        return { path, content_base64: await readFileAsBase64(file) }
      }))
      const imported = await api.importDevicePackage(entries)
      const known = catalog.find((item) => item.id === imported.id)
      if (!known) {
        setCatalog((current) => [...current, importedCatalogItem(imported)])
      }
      setSelectedId(imported.id)
      setInstalledPackages((current) => {
        const next = new Set(current).add(imported.id)
        window.localStorage.setItem(INSTALL_STATE_KEY, JSON.stringify([...next]))
        return next
      })
      setImportMessage(`${imported.name} installed`)
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Package import failed')
    } finally {
      setImporting(false)
      if (importInput.current) importInput.current.value = ''
    }
  }

  return (
    <div className="page-stack device-library-page">
      <PageHeader
        action={(
          <div className="library-page-actions">
            <input
              {...{ webkitdirectory: '' }}
              aria-label="Choose device package directory"
              hidden
              multiple
              onChange={(event) => void importPackage(event.target.files)}
              ref={importInput}
              type="file"
            />
            <button className="button button-secondary" disabled={importing} onClick={() => importInput.current?.click()} type="button">
              <Download aria-hidden="true" size={14} /> {importing ? 'Importing…' : 'Import Package'}
            </button>
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
        <button aria-pressed="true" className="active" type="button">Installed <span>{installedPackages.size}</span></button>
        <button disabled title="Community registry is not connected." type="button">Community <span>0</span></button>
        <button disabled title="Private registry is not configured." type="button">Private Registry <span>0</span></button>
        <button disabled title="Package update checks require a registry connection." type="button">Updates <span>0</span></button>
      </nav>
      <div className="device-library-workspace">
        <DevicePackageList
          bus={bus}
          installedPackages={installedPackages}
          onBusChange={setBus}
          onQueryChange={setQuery}
          onSelect={setSelectedId}
          packages={packages}
          query={query}
          selectedId={selected.id}
        />
        <DevicePackageDetail
          installed={installedPackages.has(selected.id)}
          item={selected}
          onInstalledChange={setPackageInstalled}
        />
      </div>
      {importMessage ? (
        <div className="library-local-note">
          <PackageOpen aria-hidden="true" size={13} />
          {importMessage}
        </div>
      ) : null}
    </div>
  )
}
