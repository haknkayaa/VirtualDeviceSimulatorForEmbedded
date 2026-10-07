import { ChevronDown, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useScenarios, useStartScenario } from '../../api/queries'
import { useRunStore } from '../../stores/runStore'

/** Primary action: pick a packaged test scenario and start it. */
export function RunScenarioMenu() {
  const [open, setOpen] = useState(false)
  const scenarios = useScenarios()
  const startScenario = useStartScenario()
  const setActiveRunId = useRunStore((state) => state.setActiveRunId)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="run-menu" ref={rootRef}>
      <button aria-expanded={open} aria-haspopup="menu" className="button button-primary button-lg" onClick={() => setOpen((current) => !current)} type="button">
        <Play aria-hidden="true" fill="currentColor" size={15} /> Run scenario <ChevronDown aria-hidden="true" size={15} />
      </button>
      {open && (
        <div className="run-menu-list" role="menu">
          {scenarios.isPending && <span className="run-menu-note">Loading scenarios…</span>}
          {scenarios.data?.length === 0 && <span className="run-menu-note">No packaged scenarios installed.</span>}
          {scenarios.data?.map((scenario) => (
            <button
              className="run-menu-item"
              disabled={startScenario.isPending}
              key={scenario.id}
              onClick={() => startScenario.mutate(scenario.id, {
                onSuccess: (run) => {
                  setActiveRunId(run.run_id)
                  setOpen(false)
                },
              })}
              role="menuitem"
              type="button"
            >
              <strong>{scenario.name}</strong>
              <span>{scenario.id} · {scenario.steps} steps · {scenario.device_ids.join(', ')}</span>
            </button>
          ))}
          {startScenario.isError && <span className="run-menu-note error" role="alert">{startScenario.error.message}</span>}
        </div>
      )}
    </div>
  )
}
