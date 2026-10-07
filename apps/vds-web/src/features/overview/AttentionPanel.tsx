import { ArrowRight, CircleAlert, CircleCheck, CircleX, Copy, Info, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAdapters, useLoadAdapter } from '../../api/queries'
import { Panel } from '../../components/Panel'
import { useWorkspaceProblems } from '../../hooks/useWorkspaceProblems'
import type { Adapter } from '../../types/api'
import type { LiveTransaction } from '../transactions/transactionModel'
import { hostPrerequisites } from './overviewModel'

const icons = { error: CircleX, warning: CircleAlert, info: Info }

/** Problems already shown as prerequisites, failed transactions or in the device path. */
const explainedElsewhere = /^(adapter-unavailable|adapter-auth|adapter-unloaded|adapter-empty|device-unbound|events)-/

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="button button-sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_600)
        }).catch(() => setCopied(false))
      }}
      type="button"
    >
      <Copy aria-hidden="true" size={13} /> {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function LoadAdaptersButton({ adapters }: { adapters: Adapter[] }) {
  const loadAdapter = useLoadAdapter()
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: false })
  const loadAll = async () => {
    setState({ loading: true })
    try {
      for (const adapter of adapters) await loadAdapter.mutateAsync(adapter.id)
      setState({ loading: false })
    } catch (caught) {
      setState({ loading: false, error: caught instanceof Error ? caught.message : 'Adapter load failed' })
    }
  }
  return (
    <>
      <button className="button button-primary button-sm" disabled={state.loading} onClick={() => void loadAll()} type="button">
        {state.loading ? 'Loading…' : 'Load'}
      </button>
      {state.error && <span className="att-error" role="alert">{state.error}</span>}
    </>
  )
}

/** What needs the developer's attention, host prerequisites first. */
export function AttentionPanel({ transactions }: { transactions: LiveTransaction[] }) {
  const adapters = useAdapters()
  const problems = useWorkspaceProblems()
  const prerequisites = useMemo(() => hostPrerequisites(adapters.data), [adapters.data])
  const failed = useMemo(() => transactions.filter((transaction) => transaction.status === 'error'), [transactions])
  const others = useMemo(() => problems.filter((problem) => !explainedElsewhere.test(problem.id)), [problems])
  const command = `sudo modprobe ${prerequisites.missingModules.join(' ')}`

  return (
    <Panel className="overview-attention" flush title="Attention">
      <ul className="att-list">
        {failed.length > 0 && (
          <li className="att-row">
            <TriangleAlert aria-hidden="true" className="att-icon warn" size={18} />
            <span className="att-text"><span><b className="text-warn">{failed.length}</b> rejected transaction{failed.length === 1 ? '' : 's'}</span><small>last: {failed[0].deviceId} · {failed[0].errorCode ?? 'error'}</small></span>
            <Link className="att-link" to="/transactions?result=failed">Inspect <ArrowRight aria-hidden="true" size={14} /></Link>
          </li>
        )}
        {others.map((problem) => {
          const Icon = icons[problem.severity]
          return (
            <li className="att-row" key={problem.id}>
              <Icon aria-label={problem.severity} className={`att-icon ${problem.severity === 'error' ? 'err' : problem.severity === 'warning' ? 'warn' : 'info'}`} size={18} />
              <span className="att-text">{problem.message}<small><code>{problem.source}</code>{problem.detail ? ` · ${problem.detail}` : ''}</small></span>
              {problem.to && <Link className="att-link" to={problem.to}>Inspect <ArrowRight aria-hidden="true" size={14} /></Link>}
            </li>
          )
        })}
        {prerequisites.missingModules.length > 0 ? (
          <li className="att-row">
            <TriangleAlert aria-hidden="true" className="att-icon warn" size={18} />
            <span className="att-text">
              Kernel module{prerequisites.missingModules.length === 1 ? '' : 's'} missing: {prerequisites.missingModules.join(', ')}
              <small>{prerequisites.nodesTotal - prerequisites.nodesOpen} of {prerequisites.nodesTotal} device nodes are not exposed · <code className="att-command">{command}</code></small>
            </span>
            <CopyButton text={command} />
          </li>
        ) : prerequisites.loadableAdapters.length > 0 ? (
          <li className="att-row">
            <TriangleAlert aria-hidden="true" className="att-icon warn" size={18} />
            <span className="att-text">
              {prerequisites.loadableAdapters.length} adapter{prerequisites.loadableAdapters.length === 1 ? ' is' : 's are'} not loaded
              <small>{prerequisites.loadableAdapters.map((adapter) => adapter.id).join(', ')} · load to expose their device nodes</small>
            </span>
            <LoadAdaptersButton adapters={prerequisites.loadableAdapters} />
          </li>
        ) : adapters.data && prerequisites.failedAdapters.length === 0 && (
          <li className="att-row">
            <CircleCheck aria-hidden="true" className="att-icon ok" size={18} />
            <span className="att-text">All host prerequisites available<small>{prerequisites.nodesOpen} of {prerequisites.nodesTotal} device nodes open</small></span>
          </li>
        )}
      </ul>
    </Panel>
  )
}
