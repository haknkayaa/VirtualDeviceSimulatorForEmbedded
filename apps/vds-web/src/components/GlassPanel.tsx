import type { PropsWithChildren, ReactNode } from 'react'

interface GlassPanelProps extends PropsWithChildren {
  className?: string
  title?: string
  eyebrow?: string
  action?: ReactNode
}

export function GlassPanel({ children, className = '', title, eyebrow, action }: GlassPanelProps) {
  return (
    <section className={`glass-panel ${className}`.trim()}>
      {(title || eyebrow || action) && (
        <header className="panel-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
