import { beforeEach, describe, expect, it } from 'vitest'
import { deserializeFlowDocument, serializeFlowDocument } from '../../../flows/serialization/flowDocument'
import { localFlowRepository } from '../../../flows/serialization/localFlowRepository'
import { useFlowStore } from '../../../flows/store/flowStore'
import { createScenarioFlowDocument, scenarioDocumentToFlow } from './scenarioFlowDocument'
import { compileScenarioFlow } from '../compiler/compileScenarioFlow'
import { exampleScenarioFlow } from './scenarioFlowFixtures'

describe('scenario flow persistence', () => {
  beforeEach(() => localStorage.clear())
  it('round trips semantic data, positions, viewport and metadata deterministically', () => {
    const json = serializeFlowDocument(exampleScenarioFlow)
    expect(serializeFlowDocument(deserializeFlowDocument(json))).toBe(json)
  })
  it('saves and loads local scenario documents', () => {
    const document = createScenarioFlowDocument({ id: 'local-scenario' })
    localFlowRepository.save(document)
    expect(localFlowRepository.load('local-scenario')).toEqual(document)
  })
  it('deletes only an existing local scenario document', () => {
    localFlowRepository.save(createScenarioFlowDocument({ id: 'local-scenario' }))
    expect(localFlowRepository.remove('local-scenario')).toBe(true)
    expect(localFlowRepository.load('local-scenario')).toBeNull()
    expect(localFlowRepository.remove('local-scenario')).toBe(false)
  })
  it('preserves the current scenario when import fails', () => {
    const document = createScenarioFlowDocument({ id: 'current' })
    useFlowStore.getState().newDocument(document)
    expect(useFlowStore.getState().importJson('{')).toMatchObject({ ok: false })
    expect(useFlowStore.getState().document.flow.id).toBe('current')
  })

  it('opens a packaged scenario as an equivalent visual document', () => {
    const packaged = {
      schema_version: 1,
      scenario: { id: 'reset-check', name: 'Reset Check', timeout_ms: 750 },
      steps: [
        { id: 'reset', action: 'reset_device', device: 'spi-flash-0', continue_on_failure: false },
        { id: 'settle', action: 'advance_time', duration_ms: 5, continue_on_failure: false },
        { id: 'ready', action: 'assert_state', device: 'spi-flash-0', expected: 'ready', continue_on_failure: true },
      ],
    }
    const visual = scenarioDocumentToFlow(packaged, { deviceId: 'spi-flash-0', now: '2026-01-01T00:00:00.000Z' })
    const compiled = compileScenarioFlow(visual)

    expect(visual.nodes.map((node) => node.kind)).toEqual(['scenario.start', 'scenario.reset_device', 'scenario.advance_time', 'scenario.assert_state', 'scenario.end'])
    expect(compiled.errors).toEqual([])
    expect(compiled.document).toEqual(packaged)
  })
})
