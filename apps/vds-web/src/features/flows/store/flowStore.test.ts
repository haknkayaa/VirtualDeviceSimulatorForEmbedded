import { beforeEach, describe, expect, it } from 'vitest'

import { flowFixture } from '../testFixtures'
import { useFlowStore } from './flowStore'

describe('flow store commands and history', () => {
  beforeEach(() => useFlowStore.getState().loadDocument(flowFixture()))

  it('creates and bulk-deletes nodes and incident edges', () => {
    expect(useFlowStore.getState().addNode('placeholder_action', { x: 10, y: 20 }, 'new-action')).toBe('new-action')
    useFlowStore.getState().connect({ source: 'action', sourceHandle: 'out', target: 'new-action', targetHandle: 'in' }, 'default', 'edge-new')
    useFlowStore.getState().select(['action', 'new-action'], [])
    useFlowStore.getState().deleteSelection()
    expect(useFlowStore.getState().document.nodes.map((node) => node.id)).toEqual(['start', 'end'])
    expect(useFlowStore.getState().document.edges).toEqual([])
  })

  it('creates valid edges and rejects invalid directions', () => {
    expect(useFlowStore.getState().connect({ source: 'start', sourceHandle: 'in', target: 'end', targetHandle: 'in' }, 'default', 'bad')).toBe(false)
    expect(useFlowStore.getState().connect({ source: 'start', sourceHandle: 'out', target: 'end', targetHandle: 'in' }, 'default', 'good')).toBe(true)
  })

  it('copies, pastes, and duplicates selected subgraphs', () => {
    useFlowStore.getState().select(['start', 'action'], [])
    expect(useFlowStore.getState().copySelection()).toBe(true)
    expect(useFlowStore.getState().paste()).toBe(true)
    expect(useFlowStore.getState().document.nodes).toHaveLength(5)
    expect(useFlowStore.getState().document.edges).toHaveLength(3)
    expect(useFlowStore.getState().duplicateSelection()).toBe(true)
    expect(useFlowStore.getState().document.nodes).toHaveLength(7)
  })

  it('undoes and redoes semantic graph mutations', () => {
    useFlowStore.getState().addNode('placeholder_action', { x: 40, y: 40 }, 'undo-me')
    expect(useFlowStore.getState().document.nodes).toHaveLength(4)
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().document.nodes).toHaveLength(3)
    useFlowStore.getState().redo()
    expect(useFlowStore.getState().document.nodes.at(-1)?.id).toBe('undo-me')
  })

  it('compacts a completed drag into one history entry', () => {
    useFlowStore.getState().beginGesture()
    useFlowStore.getState().moveNodes({ action: { x: 250, y: 20 } })
    useFlowStore.getState().moveNodes({ action: { x: 270, y: 40 } })
    expect(useFlowStore.getState().past).toHaveLength(0)
    useFlowStore.getState().endGesture()
    expect(useFlowStore.getState().past).toHaveLength(1)
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().document.nodes.find((node) => node.id === 'action')?.position).toEqual({ x: 240, y: 0 })
  })

  it('tracks dirty state against the last local save', () => {
    expect(useFlowStore.getState().isDirty).toBe(false)
    useFlowStore.getState().updateNodeData('action', { label: 'Changed' })
    expect(useFlowStore.getState().isDirty).toBe(true)
    useFlowStore.getState().prepareLocalSave()
    expect(useFlowStore.getState().isDirty).toBe(false)
  })

  it('creates linked reusable instances and synchronizes their settings', () => {
    useFlowStore.getState().setNodeReusable('action', true)
    const reusableId = useFlowStore.getState().document.nodes.find((node) => node.id === 'action')?.ui.reusable_id

    expect(typeof reusableId).toBe('string')
    expect(useFlowStore.getState().addReusableNode(reusableId as string, { x: 600, y: 80 }, 'action-shadow')).toBe('action-shadow')

    useFlowStore.getState().updateNodeData('action-shadow', { label: 'Shared action', terminal: true })
    const linked = useFlowStore.getState().document.nodes.filter((node) => node.ui.reusable_id === reusableId)
    expect(linked).toHaveLength(2)
    expect(linked.map((node) => node.data.label)).toEqual(['Shared action', 'Shared action'])
    expect(linked.every((node) => node.data.terminal === true)).toBe(true)
    expect(linked.map((node) => node.position)).toEqual([{ x: 240, y: 0 }, { x: 600, y: 80 }])
    expect(useFlowStore.getState().isDirty).toBe(true)
  })

  it('can detach one reusable instance without changing the others', () => {
    useFlowStore.getState().setNodeReusable('action', true)
    const reusableId = useFlowStore.getState().document.nodes.find((node) => node.id === 'action')?.ui.reusable_id as string
    useFlowStore.getState().addReusableNode(reusableId, { x: 600, y: 80 }, 'action-shadow')

    useFlowStore.getState().setNodeReusable('action-shadow', false)
    useFlowStore.getState().updateNodeData('action-shadow', { label: 'Detached' })

    expect(useFlowStore.getState().document.nodes.find((node) => node.id === 'action')?.data.label).toBe('Action')
    expect(useFlowStore.getState().document.nodes.find((node) => node.id === 'action-shadow')?.ui.reusable_id).toBeUndefined()
  })

  it('keeps revision one on the first local save and increments later revisions', () => {
    useFlowStore.getState().newDocument(flowFixture())
    expect(useFlowStore.getState().prepareLocalSave().flow.revision).toBe(1)
    useFlowStore.getState().updateFlowName('Revision two')
    expect(useFlowStore.getState().prepareLocalSave().flow.revision).toBe(2)
  })

  it('reconnects an edge through the same port validation contract', () => {
    expect(useFlowStore.getState().reconnect('edge-1', { source: 'start', sourceHandle: 'out', target: 'end', targetHandle: 'in' })).toBe(true)
    expect(useFlowStore.getState().document.edges.find((edge) => edge.id === 'edge-1')?.target).toBe('end')
    expect(useFlowStore.getState().reconnect('edge-1', { source: 'end', sourceHandle: 'in', target: 'start', targetHandle: 'out' })).toBe(false)
  })

  it('prevents every persisted mutation in read-only mode', () => {
    useFlowStore.getState().setReadOnly(true)
    const before = structuredClone(useFlowStore.getState().document)
    expect(useFlowStore.getState().addNode('placeholder_action', { x: 1, y: 1 })).toBeNull()
    useFlowStore.getState().deleteSelection()
    useFlowStore.getState().undo()
    expect(useFlowStore.getState().document).toEqual(before)
  })

  it('preserves the current document when import fails and replaces it in one history entry when valid', () => {
    const before = structuredClone(useFlowStore.getState().document)
    expect(useFlowStore.getState().importJson('{bad')).toMatchObject({ ok: false })
    expect(useFlowStore.getState().document).toEqual(before)
    const duplicate = flowFixture()
    duplicate.nodes.push(structuredClone(duplicate.nodes[0]))
    expect(useFlowStore.getState().importJson(JSON.stringify(duplicate))).toMatchObject({ ok: false })
    expect(useFlowStore.getState().document).toEqual(before)
    const imported = flowFixture()
    imported.flow.id = 'imported'
    expect(useFlowStore.getState().importJson(JSON.stringify(imported))).toMatchObject({ ok: true })
    expect(useFlowStore.getState().document.flow.id).toBe('imported')
    expect(useFlowStore.getState().past).toHaveLength(1)
  })

  it('keeps external runtime statuses out of history and persisted JSON', () => {
    useFlowStore.getState().setRuntimeStatuses({ action: 'running' })
    expect(useFlowStore.getState().runtimeStatuses.action).toBe('running')
    expect(useFlowStore.getState().past).toEqual([])
    expect(JSON.stringify(useFlowStore.getState().document)).not.toContain('running')
  })
})
