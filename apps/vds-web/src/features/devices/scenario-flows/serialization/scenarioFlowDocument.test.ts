import { beforeEach, describe, expect, it } from 'vitest'
import { deserializeFlowDocument, serializeFlowDocument } from '../../../flows/serialization/flowDocument'
import { localFlowRepository } from '../../../flows/serialization/localFlowRepository'
import { useFlowStore } from '../../../flows/store/flowStore'
import { createScenarioFlowDocument } from './scenarioFlowDocument'
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
  it('preserves the current scenario when import fails', () => {
    const document = createScenarioFlowDocument({ id: 'current' })
    useFlowStore.getState().newDocument(document)
    expect(useFlowStore.getState().importJson('{')).toMatchObject({ ok: false })
    expect(useFlowStore.getState().document.flow.id).toBe('current')
  })
})
