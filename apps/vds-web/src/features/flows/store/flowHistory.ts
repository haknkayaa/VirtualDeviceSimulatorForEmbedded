import type { FlowDocument } from '../types/flow'

export const FLOW_HISTORY_LIMIT = 100

export interface FlowHistory {
  past: FlowDocument[]
  future: FlowDocument[]
}

export function appendHistory(history: FlowDocument[], document: FlowDocument, limit = FLOW_HISTORY_LIMIT) {
  const next = [...history, structuredClone(document)]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export function documentsEqual(left: FlowDocument, right: FlowDocument) {
  return JSON.stringify(left) === JSON.stringify(right)
}
