import { describe, expect, it } from 'vitest'

import { flowFixture } from '../testFixtures'
import { validateFlowDocument } from './validator'

describe('generic flow validation', () => {
  it('accepts the complete foundation fixture', () => {
    expect(validateFlowDocument(flowFixture())).toEqual([])
  })

  it('reports duplicate IDs, unknown kinds, missing references, bad handles, labels, and boundaries', () => {
    const document = flowFixture()
    document.nodes.push({ ...structuredClone(document.nodes[0]) })
    document.nodes[1].kind = 'future-domain-node'
    document.nodes[1].data.label = ''
    document.nodes = document.nodes.filter((node) => node.kind !== 'end')
    document.edges[0].sourceHandle = 'not-an-output'
    document.edges[1].target = 'missing'
    document.edges.push({ ...document.edges[0], kind: 'future-edge' })
    const ruleIds = validateFlowDocument(document).map((issue) => issue.ruleId)
    expect(ruleIds).toEqual(expect.arrayContaining([
      'duplicate-node-id', 'duplicate-edge-id', 'unknown-node-kind', 'unknown-edge-kind',
      'unknown-edge-target', 'invalid-source-handle', 'missing-end', 'empty-required-label',
    ]))
  })

  it('reports orphans, self-loops, and cycles as warnings without rejecting them', () => {
    const document = flowFixture()
    document.nodes.push({ id: 'orphan', kind: 'placeholder_action', position: { x: 0, y: 200 }, data: { label: 'Orphan' }, ui: {} })
    document.edges.push({ id: 'loop', kind: 'default', source: 'action', sourceHandle: 'out', target: 'action', targetHandle: 'in', data: {}, ui: {} })
    const issues = validateFlowDocument(document)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'orphan-node', severity: 'warning' }),
      expect.objectContaining({ ruleId: 'self-loop', severity: 'warning' }),
      expect.objectContaining({ ruleId: 'cycle-detected', severity: 'warning' }),
    ]))
  })
})
