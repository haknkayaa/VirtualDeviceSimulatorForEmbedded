import { render, screen } from '@testing-library/react'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { nodeRegistry } from '../registry/nodeRegistry'
import { flowFixture } from '../testFixtures'
import type { FlowCanvasNode } from '../types/flow'
import { BaseFlowNode } from './BaseFlowNode'

describe('runtime status rendering hook', () => {
  it('renders externally supplied runtime status without semantic mutation', () => {
    const document = flowFixture().nodes[1]
    const props = {
      id: document.id,
      type: document.kind,
      data: { document, definition: nodeRegistry.get(document.kind)!, runtimeStatus: 'running', issues: [], readOnly: false },
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as NodeProps<FlowCanvasNode>
    render(<ReactFlowProvider><BaseFlowNode {...props} /></ReactFlowProvider>)
    expect(screen.getByText('Placeholder Action').closest('.flow-node')).toHaveAttribute('data-runtime-status', 'running')
    expect(document.data).not.toHaveProperty('runtimeStatus')
  })

  it('hides output handles when the node is a terminal state', () => {
    const document = flowFixture().nodes[1]
    document.data.terminal = true
    const props = {
      id: document.id,
      type: document.kind,
      data: { document, definition: nodeRegistry.get(document.kind)!, runtimeStatus: 'idle', issues: [], readOnly: false },
      selected: false,
      dragging: false,
      draggable: true,
      selectable: true,
      deletable: true,
      zIndex: 0,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } as NodeProps<FlowCanvasNode>

    render(<ReactFlowProvider><BaseFlowNode {...props} /></ReactFlowProvider>)

    expect(screen.getByLabelText('Input input')).toBeInTheDocument()
    expect(screen.queryByLabelText('Output output')).not.toBeInTheDocument()
  })
})
