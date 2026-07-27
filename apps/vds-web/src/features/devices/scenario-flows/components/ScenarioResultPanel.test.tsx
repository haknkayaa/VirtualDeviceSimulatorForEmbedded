import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ScenarioResultPanel } from './ScenarioResultPanel'

const result = {
  scenario_id: 'visual', status: 'passed' as const, started_virtual_ns: 0, completed_virtual_ns: 1,
  duration_virtual_ns: 1, steps_total: 1, steps_passed: 1, steps_failed: 0, steps_skipped: 0,
  steps: [{ step_id: 'reset', action: 'reset_device', status: 'passed' as const, started_virtual_ns: 0, completed_virtual_ns: 1 }],
}

describe('ScenarioResultPanel', () => {
  it('delegates JUnit generation to the API-backed download action', async () => {
    const onExportJunit = vi.fn()
    render(<ScenarioResultPanel junitPending={false} onExportJunit={onExportJunit} result={result} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export JUnit XML' }))
    expect(onExportJunit).toHaveBeenCalledOnce()
  })
})
