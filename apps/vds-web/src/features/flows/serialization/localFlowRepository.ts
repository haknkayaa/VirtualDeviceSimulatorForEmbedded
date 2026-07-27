import type { FlowDocument, FlowListItem } from '../types/flow'
import { deserializeFlowDocument, serializeFlowDocument } from './flowDocument'

const PREFIX = 'vds4e.flow.'

function storage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export const localFlowRepository = {
  list(): FlowListItem[] {
    const target = storage()
    if (!target) return []
    const items: FlowListItem[] = []
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const document = deserializeFlowDocument(target.getItem(key) ?? '')
        items.push({ id: document.flow.id, name: document.flow.name, kind: document.flow.kind, revision: document.flow.revision, updatedAt: document.flow.updated_at, source: 'local' })
      } catch {
        // Corrupt local entries are isolated from the catalog.
      }
    }
    return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  },
  load(id: string): FlowDocument | null {
    const raw = storage()?.getItem(`${PREFIX}${id}`)
    return raw ? deserializeFlowDocument(raw) : null
  },
  save(document: FlowDocument) {
    storage()?.setItem(`${PREFIX}${document.flow.id}`, serializeFlowDocument(document))
  },
}
