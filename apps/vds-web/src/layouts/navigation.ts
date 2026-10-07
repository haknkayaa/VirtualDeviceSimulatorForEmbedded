import { ArrowLeftRight, AudioWaveform, BookCopy, Cpu, FileText, ListTree, SlidersHorizontal, type LucideIcon } from 'lucide-react'

export interface NavigationItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

/**
 * The single source of workspace navigation. Ordered along the data path an
 * embedded application exercises: adapter (Linux device node) -> device
 * runtime -> observed bus traffic -> history -> package library.
 */
export const navigationItems: NavigationItem[] = [
  { to: '/', label: 'Overview', icon: ArrowLeftRight, end: true },
  { to: '/adapters', label: 'Adapters', icon: SlidersHorizontal },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/transactions', label: 'Transactions', icon: ListTree },
  { to: '/waveform', label: 'Logic Analyzer', icon: AudioWaveform },
  { to: '/logs', label: 'Event Log', icon: FileText },
  { to: '/device-library', label: 'Device Library', icon: BookCopy },
]
