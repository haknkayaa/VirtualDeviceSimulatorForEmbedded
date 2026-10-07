import {
  ArrowLeftRight,
  Binary,
  Bug,
  BugOff,
  CheckCheck,
  CircleDot,
  CirclePlay,
  CircleStop,
  FileInput,
  FileOutput,
  Flag,
  Hourglass,
  Play,
  Radio,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  TimerOff,
  Workflow,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

/**
 * Icon identifiers a node registry entry may reference through `iconIdentifier`.
 * Unknown identifiers fall back to the generic workflow glyph.
 */
const icons: Record<string, LucideIcon> = {
  play: Play,
  flag: Flag,
  workflow: Workflow,
  initial: CirclePlay,
  state: CircleDot,
  end: CircleStop,
  action: Zap,
  reset: RotateCcw,
  spi: ArrowLeftRight,
  send: Send,
  event: Radio,
  fault: Bug,
  'fault-off': BugOff,
  assert: CheckCheck,
  guard: ShieldCheck,
  logic: Binary,
  timer: Timer,
  timeout: TimerOff,
  interval: Repeat,
  wait: Hourglass,
  'file-read': FileInput,
  'file-write': FileOutput,
}

/** Registry-driven node glyph. Unknown identifiers fall back to the generic workflow glyph. */
export function FlowNodeIcon({ identifier, ...props }: LucideProps & { identifier: string | undefined }) {
  const Icon = icons[identifier ?? ''] ?? Workflow
  return <Icon aria-hidden="true" {...props} />
}

