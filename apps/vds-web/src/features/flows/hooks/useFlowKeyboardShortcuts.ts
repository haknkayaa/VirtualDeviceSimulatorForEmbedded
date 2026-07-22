import { useEffect } from 'react'

import { useFlowStore } from '../store/flowStore'

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function useFlowKeyboardShortcuts(options: { fitView: () => void; save: () => void; canvasFocused: boolean }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const store = useFlowStore.getState()
      const command = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if ((event.key === 'Delete' || event.key === 'Backspace') && !store.readOnly) { event.preventDefault(); store.deleteSelection() }
      else if (command && key === 'c') { event.preventDefault(); store.copySelection() }
      else if (command && key === 'v' && !store.readOnly) { event.preventDefault(); store.paste() }
      else if (command && key === 'd' && !store.readOnly) { event.preventDefault(); store.duplicateSelection() }
      else if (command && key === 'z' && event.shiftKey && !store.readOnly) { event.preventDefault(); store.redo() }
      else if (command && key === 'y' && !store.readOnly) { event.preventDefault(); store.redo() }
      else if (command && key === 'z' && !store.readOnly) { event.preventDefault(); store.undo() }
      else if (command && key === 's') { event.preventDefault(); options.save() }
      else if (command && key === 'a' && options.canvasFocused) { event.preventDefault(); store.selectAll() }
      else if (event.key === 'Escape') { store.setConnectionPreview(null); store.clearSelection() }
      else if (key === 'f' && options.canvasFocused) { event.preventDefault(); options.fitView() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [options])
}
