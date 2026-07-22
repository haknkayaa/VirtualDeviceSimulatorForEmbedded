import dagre from '@dagrejs/dagre'

import type { FlowDocument, FlowLayoutEngine, FlowLayoutOptions } from '../types/flow'

export class DagreLayoutEngine implements FlowLayoutEngine {
  readonly id = 'dagre'

  layout(document: FlowDocument, options: FlowLayoutOptions) {
    const width = options.nodeWidth ?? 230
    const height = options.nodeHeight ?? 84
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    graph.setGraph({
      rankdir: options.direction,
      ranksep: options.rankSeparation ?? 90,
      nodesep: options.nodeSeparation ?? 55,
      marginx: 30,
      marginy: 30,
    })
    document.nodes.forEach((node) => graph.setNode(node.id, { width, height }))
    document.edges.forEach((edge) => {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) graph.setEdge(edge.source, edge.target)
    })
    dagre.layout(graph)
    return {
      nodes: document.nodes.map((node) => {
        const laidOut = graph.node(node.id)
        return laidOut ? { ...node, position: { x: laidOut.x - width / 2, y: laidOut.y - height / 2 } } : node
      }),
    }
  }
}

export const defaultLayoutEngine = new DagreLayoutEngine()
