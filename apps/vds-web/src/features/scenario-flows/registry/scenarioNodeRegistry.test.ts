import { describe, expect, it } from 'vitest'
import { nodeRegistry } from '../../flows/registry/nodeRegistry'
import { registerScenarioNodes } from './scenarioNodeRegistry'
import { SCENARIO_NODE_KINDS } from '../types/scenarioFlow'

describe('scenario node registry', () => {
  it('registers all twelve typed nodes with valid linear ports', () => {
    const entries = registerScenarioNodes()
    expect(entries).toHaveLength(12)
    Object.values(SCENARIO_NODE_KINDS).forEach((kind) => expect(nodeRegistry.get(kind)?.flowKinds).toContain('scenario'))
    expect(nodeRegistry.get(SCENARIO_NODE_KINDS.start)?.inputPorts).toEqual([])
    expect(nodeRegistry.get(SCENARIO_NODE_KINDS.end)?.outputPorts).toEqual([])
  })
})
