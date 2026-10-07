import { Activity, AudioWaveform, Boxes, Cable, LayoutDashboard, LibraryBig, ScrollText, type LucideIcon } from 'lucide-react'

export interface NavigationItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export interface NavigationGroup {
  label?: string
  items: NavigationItem[]
}

/**
 * The single source of workspace navigation. Ordered along the data path an
 * embedded application exercises: Linux device node -> adapter -> device
 * runtime -> observed bus traffic.
 */
export const navigationGroups: NavigationGroup[] = [
  { items: [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }] },
  {
    label: 'Topology',
    items: [
      { to: '/adapters', label: 'Adapters', icon: Cable },
      { to: '/devices', label: 'Devices', icon: Boxes },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { to: '/transactions', label: 'Transactions', icon: Activity },
      { to: '/waveform', label: 'Logic Analyzer', icon: AudioWaveform },
      { to: '/logs', label: 'Event Log', icon: ScrollText },
    ],
  },
  {
    label: 'Library',
    items: [{ to: '/device-library', label: 'Device Library', icon: LibraryBig }],
  },
]
