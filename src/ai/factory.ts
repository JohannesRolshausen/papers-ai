// Adversary factory: which adversary plays the queue for a game.
// The offline adversary always stands by as the fallback. In Claude mode it plans the days
// Claude cannot plan and answers when Claude cannot.

import type { AiMode, Settings } from '../core/types'
import type { Adversary } from './adversary'
import type { ClaudeFetch } from './claudeAdversary'
import { ClaudeAdversary } from './claudeAdversary'
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
    description:
      'A language model plans every day and answers your questions in character. Needs your own API key.',
    available: true,
    unavailableReason: null,
  },
]

export interface AdversaryPair {
  main: Adversary
  // Takes over planning and answers when the main adversary fails
  fallback: Adversary
  // The main adversary when it is Claude, for the key dialog and notices
  claude: ClaudeAdversary | null
}

export interface AdversaryContext {
  // The player's key. It is never part of the game state.
  apiKey?: string | null
  // Replaces the network, only for tests
  fetch?: ClaudeFetch
}

export function createAdversaries(
  settings: Settings,
  seed: number,
  context: AdversaryContext = {},
): AdversaryPair {
  const fallback = createOfflineAdversary(seed)
  switch (settings.aiMode) {
    case 'claude': {
      // Without a key the adversary asks for one when the first day is planned
      const claude = new ClaudeAdversary({
        apiKey: context.apiKey ?? null,
        model: settings.model,
        fallback,
        ...(context.fetch ? { fetch: context.fetch } : {}),
      })
      return { main: claude, fallback, claude }
    }
    case 'offline':
      return { main: createOfflineAdversary(seed), fallback, claude: null }
  }
}

// Free questions need a language model to answer them well
export function freeQuestionsEnabled(settings: Settings): boolean {
  return (
    settings.aiMode === 'claude' && ADVERSARY_MODES.some((m) => m.mode === 'claude' && m.available)
  )
}
