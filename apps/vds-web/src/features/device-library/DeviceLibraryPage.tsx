import { Download, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api/client'
import { useAdapters, useDevices } from '../../api/queries'
import { AsyncState } from '../../components/AsyncState'
import { PageHeader } from '../../components/PageHeader'
import { DevicePackageDetail } from './DevicePackageDetail'
import { DevicePackageList } from './DevicePackageList'
import { libraryPackageFromApi, matchesPackage, type LibraryPackage } from './deviceLibraryCatalog'
import { buildPackageInstances } from './packageInstances'
import './device-library.css'

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

const busFilters = ['all', 'spi', 'i2c', 'gpio', 'uart']

interface Notice {
  tone: 'ok' | 'error'
  text: string
}

export function DeviceLibraryPage() {
  const importInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [bus, setBus] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [catalog, setCatalog] = useState<LibraryPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const devices = useDevices()
  const adapters = useAdapters()

  useEffect(() => {
    void api.devicePackages()
      .then((installed) => {
        const packages = installed.map(libraryPackageFromApi)
        setCatalog(packages)
        setSelectedId((current) => current || packages[0]?.id || '')
      })
      .catch(() => setNotice({ tone: 'error', text: 'Package service is unavailable' }))
      .finally(() => setLoading(false))
  }, [])

  const packages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalog.filter((item) => matchesPackage(item, needle, bus))
  }, [bus, catalog, query])
  const instances = useMemo(
    () => buildPackageInstances(catalog.map((item) => item.id), devices.data, adapters.data),
    [adapters.data, catalog, devices.data],
  )
  const selected = catalog.find((item) => item.id === selectedId) ?? catalog[0]
  const presentBuses = useMemo(() => new Set(catalog.map((item) => item.bus)), [catalog])

  const importPackage = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    setNotice(null)
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
      setNotice({ tone: 'ok', text: `${imported.name} installed` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Package import failed' })
    } finally {
      setImporting(false)
      if (importInput.current) importInput.current.value = ''
    }
  }

  const countLabel = packages.length === catalog.length
    ? `${catalog.length} local package${catalog.length === 1 ? '' : 's'}`
    : `${packages.length} of ${catalog.length} local packages`

  return (
    <div className="page device-library-page">
      <PageHeader
        actions={(
          <>
            <input
              {...{ webkitdirectory: '' }}
              aria-label="Choose device package directory"
              hidden
              multiple
              onChange={(event) => void importPackage(event.target.files)}
              ref={importInput}
              type="file"
            />
            <button
              className="button"
              disabled={importing}
              onClick={() => importInput.current?.click()}
              title="Import a device package directory (device-package.yaml, model/, docs/, assets/)"
              type="button"
            >
              <Download aria-hidden="true" size={13} /> {importing ? 'Importing…' : 'Import Package'}
            </button>
          </>
        )}
        context={<span className="mono">{countLabel}</span>}
        title="Device Library"
      >
        <label className="search-input dl-search">
          <Search aria-hidden="true" size={13} />
          <input
            aria-label="Search device packages"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, id, bus, version"
            type="search"
            value={query}
          />
        </label>
        <div aria-label="Filter packages by bus" className="segmented" role="group">
          {busFilters.map((value) => (
            <button
              aria-pressed={bus === value}
              disabled={value !== 'all' && !presentBuses.has(value)}
              key={value}
              onClick={() => setBus(value)}
              type="button"
            >
              {value === 'all' ? 'All' : value.toUpperCase()}
            </button>
          ))}
        </div>
      </PageHeader>

      {notice && (
        <div className={`inline-alert ${notice.tone} dl-notice`} role="status">
          <span className="dl-notice-text">{notice.text}</span>
          <button aria-label="Dismiss" className="icon-button sm" onClick={() => setNotice(null)} type="button"><X aria-hidden="true" size={12} /></button>
        </div>
      )}

      <div className="page-body fill dl-body">
        {loading && <AsyncState kind="loading" title="Loading installed packages" />}
        {!loading && selected && (
          <div className="dl-layout">
            <DevicePackageList
              instances={instances}
              onSelect={setSelectedId}
              packages={packages}
              selectedId={selected.id}
            />
            <DevicePackageDetail instance={instances.get(selected.id)} item={selected} key={selected.id} />
          </div>
        )}
        {!loading && !selected && (
          <AsyncState
            centered
            detail="Import a package directory containing device-package.yaml to add a device model."
            kind="empty"
            title="No device packages installed"
          />
        )}
      </div>
    </div>
  )
}
