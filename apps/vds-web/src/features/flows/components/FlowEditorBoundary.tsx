import { Component, type ErrorInfo, type ReactNode } from 'react'

export class FlowEditorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Flow editor failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flow-editor-failure" role="alert">
        <strong>Flow editor could not render</strong>
        <span>{this.state.error.message}</span>
      </div>
    )
  }
}
