import { render, screen, within } from '@testing-library/react'
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

  it('shows coverage per device with the behavior the run did not exercise', async () => {
    const metric = (covered: number, total: number, missed: string[] = []) => ({ covered, total, missed })
    render(
      <ScenarioResultPanel
        junitPending={false}
        onExportJunit={vi.fn()}
        result={{
          ...result,
          coverage: {
            devices: [{
              device_id: 'flash',
              commands: metric(3, 4, ['BULK_ERASE']),
              registers: metric(1, 1),
              states: metric(2, 3, ['erasing']),
              transitions: metric(1, 2, ['ready -> erasing']),
              faults: metric(0, 0),
            }],
          },
        }}
      />,
    )

    const coverage = screen.getByRole('group', { name: 'Scenario coverage' })
    const row = within(coverage).getByRole('row', { name: /flash/ })
    expect(row).toHaveTextContent('3/4')
    expect(within(row).getByText('3/4').closest('td')).toHaveAttribute('title', 'Not exercised: BULK_ERASE')
    expect(within(row).getAllByRole('cell').at(-1)).toHaveTextContent('—')
    await userEvent.click(within(coverage).getByText(/Not exercised on/))
    expect(within(coverage).getByText('ready -> erasing')).toBeVisible()
  })

  it('omits coverage when the run did not report it', () => {
    render(<ScenarioResultPanel junitPending={false} onExportJunit={vi.fn()} result={result} />)
    expect(screen.queryByRole('group', { name: 'Scenario coverage' })).not.toBeInTheDocument()
  })
})
