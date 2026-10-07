/** Human name for a flow document kind, used in labels and accessible names. */
export function flowDocumentName(kind: string) {
  return kind === 'scenario' ? 'Test scenario' : kind === 'device_behavior' ? 'Behavior model' : 'Document'
}
