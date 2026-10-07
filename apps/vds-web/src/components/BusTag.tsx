interface BusTagProps {
  bus: string | null | undefined
}

/** Monospace bus identity tag; colour comes from the bus token, never decoration. */
export function BusTag({ bus }: BusTagProps) {
  const value = (bus ?? 'unknown').toLowerCase()
  return <span className={`bus-tag bus-${value}`}>{value}</span>
}
