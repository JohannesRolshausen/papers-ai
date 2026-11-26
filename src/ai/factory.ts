// Adversary factory: which adversary plays the queue for a game.
// Package 4 adds the Claude adversary here; until then every game plays offline.

import type { AiMode, Settings } from '../core/types'
import type { Adversary } from './adversary'
import { createOfflineAdversary } from './offlineAdversary'

export interface AdversaryModeInfo {
  mode: AiMode
  label: string
  description: string
  available: boolean
  unavailableReason: string | null
}

// Shown on the setup screen
export const ADVERSARY_MODES: AdversaryModeInfo[] = [
  {
    mode: 'offline',
    label: 'Offline adversary',
    description: 'A rule-based planner that runs in your browser. No account, no key.',
    available: true,
    unavailableReason: null,
  },
  {
    mode: 'claude',
    label: 'Claude',
    description: 'A language model plans every day and answers your questions in character.',
    available: false,
    unavailableReason: 'Coming in a later update. Needs your own API key.',
  },
]

export interface AdversaryPair {
  main: Adversary
  // Takes over planning and answers when the main adversary fails
  fallback: Adversary
}

export function createAdversaries(settings: Settings, seed: number): AdversaryPair {
  switch (settings.aiMode) {
    case 'claude':
    case 'offline':
      return { main: createOfflineAdversary(seed), fallback: createOfflineAdversary(seed) }
  }
}

// Free questions need a language model to answer them well
export function freeQuestionsEnabled(settings: Settings): boolean {
  return (
    settings.aiMode === 'claude' && ADVERSARY_MODES.some((m) => m.mode === 'claude' && m.available)
  )
}
