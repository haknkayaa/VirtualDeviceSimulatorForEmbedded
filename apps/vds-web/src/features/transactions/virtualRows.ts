import { observeElementRect, type Virtualizer } from '@tanstack/react-virtual'

const FALLBACK_RECT = { width: 1000, height: 600 }

/**
 * Rect observer for table virtualisers. A scroll element without layout
 * (first paint, a collapsed pane, jsdom) reports 0×0, which would render no
 * rows at all; treat that as a nominal viewport so a screenful still renders.
 */
export function observeRectWithFallback<T extends Element>(
  instance: Virtualizer<T, Element>,
  callback: (rect: { width: number; height: number }) => void,
) {
  return observeElementRect(instance, (rect) => callback(rect.height > 0 ? rect : FALLBACK_RECT))
}
