import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  /** Muted one-line context after the title, e.g. the selected object or a path. */
  context?: ReactNode
  /** Inline toolbar content such as filters, rendered between title and actions. */
  children?: ReactNode
  actions?: ReactNode
}

/** Single-line page toolbar. Pages own exactly one of these at the top. */
export function PageHeader({ title, context, children, actions }: PageHeaderProps) {
  return (
    <header className="page-bar">
      <div className="page-bar-title">
        <h1>{title}</h1>
        {context && <span className="page-bar-context">{context}</span>}
      </div>
      {children && <div className="page-bar-content">{children}</div>}
      {actions && <div className="page-bar-actions">{actions}</div>}
    </header>
  )
}
