import { CircleCheck, CircleDashed, CircleMinus, CircleX, Copy, Plus, Power } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useLoadAdapter } from '../../api/queries'
import type { Adapter } from '../../types/api'
import type { BringUpState, BringUpStatus } from './overviewModel'

const stepIcons: Record<BringUpStatus, typeof CircleCheck> = {
  ok: CircleCheck,
  fail: CircleX,
  blocked: CircleDashed,
  idle: CircleMinus,
}

const stepStatusLabel: Record<BringUpStatus, string> = {
  ok: 'passed',
  fail: 'failed',
  blocked: 'blocked',
  idle: 'waiting',
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      // Clipboard can be refused; the command stays selectable in place.
      setCopied(false)
    }
  }
  return (
    <div className="bringup-command">
      <code>{command}</code>
      <button className="button button-primary button-sm" onClick={() => void copy()} type="button">
        <Copy aria-hidden="true" size={13} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function LoadAdaptersButton({ adapters }: { adapters: Adapter[] }) {
  const loadAdapter = useLoadAdapter()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const loadAll = async () => {
    setError(undefined)
    setLoading(true)
    try {
      for (const adapter of adapters) await loadAdapter.mutateAsync(adapter.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Adapter load failed')
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <button className="button button-primary button-sm" disabled={loading} onClick={() => void loadAll()} type="button">
        <Power aria-hidden="true" size={13} /> {loading ? 'Loading…' : `Load ${adapters.length === 1 ? adapters[0].id : `${adapters.length} adapters`}`}
      </button>
      {error && <span className="bringup-error" role="alert">{error}</span>}
    </>
  )
}

function FixCallout({ state }: { state: BringUpState }) {
  const { current, missingModules, loadableAdapters, nodesTotal } = state
  if (!current) return null
  if (current.id === 'modules') {
    return (
      <div className="bringup-fix">
        <div className="bringup-fix-copy">
          <strong>Load the missing kernel module{missingModules.length === 1 ? '' : 's'}, then load the adapters</strong>
          <span>This unblocks {nodesTotal} device node{nodesTotal === 1 ? '' : 's'}. VDS4E never asks for your sudo password.</span>
        </div>
        <CopyCommand command={`sudo modprobe ${missingModules.join(' ')}`} />
      </div>
    )
  }
  if (current.id === 'adapters' && loadableAdapters.length > 0) {
    return (
      <div className="bringup-fix">
        <div className="bringup-fix-copy">
          <strong>Load the adapters to expose their device nodes</strong>
          <span>{loadableAdapters.map((adapter) => adapter.id).join(', ')} {loadableAdapters.length === 1 ? 'is' : 'are'} ready to load.</span>
        </div>
        <div className="bringup-fix-actions"><LoadAdaptersButton adapters={loadableAdapters} /></div>
      </div>
    )
  }
  if (current.id === 'adapters' && nodesTotal === 0) {
    return (
      <div className="bringup-fix">
        <div className="bringup-fix-copy">
          <strong>Create an adapter and attach a device</strong>
          <span>An adapter exposes a virtual device as /dev/spidevX.Y, /dev/i2c-N or /dev/gpiochipN.</span>
        </div>
        <div className="bringup-fix-actions"><Link className="button button-primary button-sm" to="/adapters?new=1"><Plus aria-hidden="true" size={13} /> New adapter</Link></div>
      </div>
    )
  }
  return (
    <div className="bringup-fix">
      <div className="bringup-fix-copy">
        <strong>{current.title}: {current.detail}</strong>
        <span>Open the adapter for its error and recovery actions.</span>
      </div>
      <div className="bringup-fix-actions"><Link className="button button-sm" to="/adapters">Open Adapters</Link></div>
    </div>
  )
}

/** Host bring-up pipeline: the first failing step and its fix, or one line when ready. */
export function BringUpPanel({ state }: { state: BringUpState }) {
  const ready = !state.current && state.nodesTotal > 0
  if (ready) {
    const traffic = state.steps.find((step) => step.id === 'traffic')
    return (
      <section aria-label="Bring-up" className="bringup bringup-ready">
        <CircleCheck aria-hidden="true" size={18} />
        <strong>{state.nodesOpen} of {state.nodesTotal} device nodes open</strong>
        <span>Applications can open every bound node · {traffic?.detail}</span>
      </section>
    )
  }
  return (
    <section aria-label="Bring-up" className="bringup">
      <ol className="bringup-steps">
        {state.steps.map((step, index) => {
          const Icon = stepIcons[step.status]
          const isCurrent = state.current?.id === step.id
          return (
            <li aria-current={isCurrent ? 'step' : undefined} className={`bringup-step step-${step.status}${isCurrent ? ' current' : ''}`} key={step.id}>
              <span className="bringup-step-head">
                <Icon aria-label={stepStatusLabel[step.status]} size={15} />
                <span>Step {index + 1}</span>
              </span>
              <strong>{step.title}</strong>
              <span className="bringup-step-detail">{step.detail}</span>
            </li>
          )
        })}
      </ol>
      <FixCallout state={state} />
    </section>
  )
}
