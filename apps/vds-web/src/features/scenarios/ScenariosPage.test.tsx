import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScenariosPage } from './ScenariosPage'
import { jsonResponse, renderRoute } from '../../test/render'

const result = {
  scenario_id: 'reset-check',
  status: 'passed',
  started_virtual_ns: 0,
  completed_virtual_ns: 5_000_000,
  duration_virtual_ns: 5_000_000,
  steps_total: 1,
  steps_passed: 1,
  steps_failed: 0,
  steps_skipped: 0,
  steps: [{ step_id: 'assert_ready', action: 'assert_state', status: 'passed', started_virtual_ns: 5_000_000, completed_virtual_ns: 5_000_000 }],
}

describe('scenario run lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts a run, polls status, and renders step and JSON results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/scenarios') return jsonResponse([{ id: 'reset-check', name: 'Reset Check', timeout_ms: 1000, steps: 1 }])
      if (url === '/api/v1/scenarios/reset-check' && init?.method !== 'POST') return jsonResponse({ schema_version: 1, scenario: { id: 'reset-check', name: 'Reset Check', timeout_ms: 1000 }, steps: [{ id: 'assert_ready', action: 'assert_state', device: 'spi-flash-0', expected: 'ready' }] })
      if (url === '/api/v1/scenarios/reset-check/run' && init?.method === 'POST') return jsonResponse({ run_id: 'run-000001', scenario_id: 'reset-check', status: 'queued' }, { status: 202 })
      if (url === '/api/v1/runs/run-000001') return jsonResponse({ run_id: 'run-000001', scenario_id: 'reset-check', status: 'passed', result })
      if (url === '/api/v1/runs/run-000001/result') return jsonResponse(result)
      throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url}`)
    }))
    renderRoute(<ScenariosPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Run scenario' }))
    expect(await screen.findByText('run-000001')).toBeInTheDocument()
    expect((await screen.findAllByText('assert_ready')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Result JSON')).toBeInTheDocument()
    expect(screen.getByText(/"scenario_id": "reset-check"/)).toBeInTheDocument()
  })
})
