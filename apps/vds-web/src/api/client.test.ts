import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from './client'
import { jsonResponse } from '../test/render'

describe('REST API mapping', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps device snapshots without changing the server contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([{ id: 'spi-flash-0', bus: 'spi', state: 'ready' }]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.devices()).resolves.toEqual([
      { id: 'spi-flash-0', bus: 'spi', state: 'ready' },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/devices', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }))
  })

  it('maps structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: 'device_not_found', message: "device 'missing' was not found" },
          { status: 404 },
        ),
      ),
    )
    await expect(api.device('missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'device_not_found',
      message: "device 'missing' was not found",
    } satisfies Partial<ApiError>)
  })

  it('submits compiled visual scenarios through the existing control-plane run path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run_id: 'run-1', scenario_id: 'visual', status: 'queued' }))
    vi.stubGlobal('fetch', fetchMock)
    const document = { schema_version: 1, scenario: { id: 'visual', name: 'Visual', timeout_ms: 1000 }, steps: [{ id: 'reset', continue_on_failure: false, action: 'reset_device', device: 'dev' }] }
    await api.runScenarioDefinition(document)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scenarios/visual/run', expect.objectContaining({
      method: 'POST', body: JSON.stringify(document), headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })
})
