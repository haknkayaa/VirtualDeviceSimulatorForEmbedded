import { useEffect, useState } from 'react'

/** Wall-clock milliseconds, refreshed on an interval for time-windowed views. */
export function useNow(intervalMs = 1_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
