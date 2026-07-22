import type { FlowDocument, FlowLayoutEngine, FlowLayoutOptions, FlowLayoutResult } from '../types/flow'

export function runFlowLayout(engine: FlowLayoutEngine, document: FlowDocument, options: FlowLayoutOptions): FlowLayoutResult {
  return engine.layout(structuredClone(document), options)
}
