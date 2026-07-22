import { create } from 'zustand'

interface RunState {
  activeRunId: string | null
  setActiveRunId: (runId: string | null) => void
}

export const useRunStore = create<RunState>((set) => ({
  activeRunId: null,
  setActiveRunId: (activeRunId) => set({ activeRunId }),
}))
