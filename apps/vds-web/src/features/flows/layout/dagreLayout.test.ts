import { describe, expect, it } from 'vitest'

import { flowFixture } from '../testFixtures'
import type { FlowLayoutEngine } from '../types/flow'
import { DagreLayoutEngine } from './dagreLayout'
import { runFlowLayout } from './layoutEngine'

describe('layout abstraction', () => {
  it('runs an interchangeable engine without mutating the source document', () => {
    const document = flowFixture()
    const original = structuredClone(document)
    const fake: FlowLayoutEngine = { id: 'test', layout: (input) => ({ nodes: input.nodes.map((node, index) => ({ ...node, position: { x: index, y: index } })) }) }
    expect(runFlowLayout(fake, document, { direction: 'LR' }).nodes[1].position).toEqual({ x: 1, y: 1 })
    expect(document).toEqual(original)
  })

  it('supports left-to-right and top-to-bottom Dagre adapters', () => {
    const engine = new DagreLayoutEngine()
    const lr = engine.layout(flowFixture(), { direction: 'LR' }).nodes
    const tb = engine.layout(flowFixture(), { direction: 'TB' }).nodes
    expect(lr[0].position.x).toBeLessThan(lr[2].position.x)
    expect(tb[0].position.y).toBeLessThan(tb[2].position.y)
  })
})
