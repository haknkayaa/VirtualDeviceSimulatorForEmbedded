import { Download, Ellipsis, PackageOpen, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api/client'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { DevicePackageDetail } from './DevicePackageDetail'
import { DevicePackageList } from './DevicePackageList'
import { libraryPackageFromApi, type LibraryPackage } from './deviceLibraryCatalog'

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export function DeviceLibraryPage() {
  const importInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [bus, setBus] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [catalog, setCatalog] = useState<LibraryPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')

  useEffect(() => {
    void api.devicePackages()
      .then((installed) => {
        const packages = installed.map(libraryPackageFromApi)
        setCatalog(packages)
        setSelectedId((current) => current || packages[0]?.id || '')
      })
      .catch(() => setImportMessage('Package service is unavailable'))
      .finally(() => setLoading(false))
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
      const imported = libraryPackageFromApi(await api.importDevicePackage(entries))
      setCatalog((current) => current.some((item) => item.id === imported.id) ? current : [...current, imported])
      setSelectedId(imported.id)
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
        description="Inspect device packages installed in the local VDS4E package store."
        eyebrow="Device Library / Installed Packages"
        title="Device Library"
      />
      <nav aria-label="Library collections" className="library-tabs">
        <button aria-pressed="true" className="active" type="button">Installed <span>{catalog.length}</span></button>
        <button disabled title="Community registry is not connected." type="button">Community <span>0</span></button>
        <button disabled title="Private registry is not configured." type="button">Private Registry <span>0</span></button>
        <button disabled title="Package update checks require a registry connection." type="button">Updates <span>0</span></button>
      </nav>
      <div className="device-library-workspace">
        {loading ? <AsyncState kind="loading" title="Loading installed packages" /> : null}
        {!loading && selected ? (
          <>
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
          </>
        ) : null}
        {!loading && !selected ? <AsyncState kind="empty" title="No device packages installed" /> : null}
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
