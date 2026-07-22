import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { useEventStore } from '../stores/eventStore'
import { useRunStore } from '../stores/runStore'

afterEach(() => {
  cleanup()
  useEventStore.getState().reset()
  useRunStore.getState().setActiveRunId(null)
})
