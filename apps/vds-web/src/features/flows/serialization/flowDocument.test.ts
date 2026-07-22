import { describe, expect, it } from 'vitest'

import { flowFixture } from '../testFixtures'
import { deserializeFlowDocument, serializeFlowDocument } from './flowDocument'
import { FlowDocumentError } from './flowDocumentSchema'

describe('flow document serialization', () => {
  it('round trips positions, semantic data, edges, and viewport', () => {
    const document = flowFixture()
    expect(deserializeFlowDocument(serializeFlowDocument(document))).toEqual(document)
  })

  it('produces deterministic JSON with recursively sorted object keys', () => {
    const first = serializeFlowDocument(flowFixture())
    const second = serializeFlowDocument(flowFixture())
    expect(first).toBe(second)
    expect(first.indexOf('"a": 2')).toBeLessThan(first.indexOf('"z": 1'))
  })

  it('rejects malformed and unknown schema versions with actionable errors', () => {
    expect(() => deserializeFlowDocument('{')).toThrow(FlowDocumentError)
    expect(() => deserializeFlowDocument(JSON.stringify({ ...flowFixture(), schema_version: 99 })))
      .toThrow('supports version 1')
  })
})
