import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

export class FlowEditorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Flow editor failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="async-state async-error centered flow-editor-failure" role="alert">
        <AlertCircle aria-hidden="true" size={16} />
        <div>
          <strong>Visual editor could not render</strong>
          <p className="mono">{this.state.error.message}</p>
        </div>
      </div>
    )
  }
}
