import { useMemo } from 'react'

import type { FlowDocument } from '../types/flow'
import { validateFlowDocument } from '../validation/validator'

export function useFlowValidation(document: FlowDocument) {
  return useMemo(() => validateFlowDocument(document), [document])
}
