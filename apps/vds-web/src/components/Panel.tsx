import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'

interface PanelProps {
  children?: ReactNode
  className?: string
  /** Short uppercase panel caption. */
  title?: ReactNode
  icon?: LucideIcon
  /** Secondary monospace context next to the title (counts, ids, windows). */
  meta?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  /** Remove body padding for tables and lists that own their own gutters. */
  flush?: boolean
  as?: 'section' | 'aside' | 'article'
  'aria-label'?: string
}

/** Flat, bordered tool-window panel: a compact header strip and a scrollable body. */
export function Panel({
  children,
  className = '',
  title,
  icon: Icon,
  meta,
  actions,
  footer,
  flush = false,
  as: Element = 'section',
  'aria-label': ariaLabel,
}: PanelProps) {
  const titleId = useId()
  return (
    <Element aria-label={ariaLabel} aria-labelledby={!ariaLabel && title ? titleId : undefined} className={`panel${flush ? ' flush' : ''} ${className}`.trim()}>
      {(title || meta || actions) && (
        <header className="panel-header">
          {title && <h2 className="panel-title" id={titleId}>{Icon && <Icon aria-hidden="true" size={13} />}{title}</h2>}
          {meta && <span className="panel-meta">{meta}</span>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </Element>
  )
}
