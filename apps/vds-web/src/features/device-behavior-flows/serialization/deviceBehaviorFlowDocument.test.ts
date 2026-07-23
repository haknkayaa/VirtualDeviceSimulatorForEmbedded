import { beforeEach, describe, expect, it } from 'vitest'

import { deserializeFlowDocument, serializeFlowDocument } from '../../flows/serialization/flowDocument'
import { localFlowRepository } from '../../flows/serialization/localFlowRepository'
import { useFlowStore } from '../../flows/store/flowStore'
import { createDeviceBehaviorFlowDocument, exampleDeviceBehaviorFlow } from './deviceBehaviorFlowDocument'

describe('device behavior persistence', () => {
  beforeEach(() => localStorage.clear())
  it('round trips behavior semantics and viewport deterministically', () => {
    const json = serializeFlowDocument(exampleDeviceBehaviorFlow)
    expect(serializeFlowDocument(deserializeFlowDocument(json))).toBe(json)
  })
  it('saves and loads locally and preserves current state on invalid import', () => {
    const document = createDeviceBehaviorFlowDocument({ id: 'behavior-local' })
    localFlowRepository.save(document)
    expect(localFlowRepository.load('behavior-local')).toEqual(document)
    useFlowStore.getState().newDocument(document)
    expect(useFlowStore.getState().importJson('{')).toMatchObject({ ok: false })
    expect(useFlowStore.getState().document.flow.id).toBe('behavior-local')
  })
})
