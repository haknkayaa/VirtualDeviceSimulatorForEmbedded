import type { CompilerIssue } from '../types/deviceBehaviorFlow'

export function behaviorCompilerError(code: string, message: string, target: { node_id?: string; edge_id?: string } = {}): CompilerIssue {
  return { code, message, ...target }
}
