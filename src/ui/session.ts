// Bridge between the screens and the game logic: one running game with its adversary.
// TEMPORARY: uses the package 1 stand-in until the package 2 controller is merged.

import { contextForDay, grantDailyBudget } from '../core/state'
import type { GameState } from '../core/types'
import { createTempShift } from '../dev/tempShift'
import type { EveningData } from './screens/evening'
import type { ShiftPort } from './shiftPort'

export interface Session {
  state: GameState
  notices(): string[]
  startShift(): Promise<ShiftPort>
  evening(): EveningData
  // Moves on after the evening report and returns the next phase
  advance(): GameState['phase']
  summary(): string[]
}

export function createSession(state: GameState): Session {
  let port: ShiftPort | null = null
  return {
    state,
    notices: () => [],
    async startShift() {
      if (state.dayIndex > 1) grantDailyBudget(state)
      state.phase = 'shift'
      port = createTempShift(state)
      return port
    },
    evening() {
      state.phase = 'evening'
      const ctx = contextForDay(state)
      return {
        dayIndex: state.dayIndex,
        daysTotal: state.daysTotal,
        processed: ctx.applicantCount - (port?.waiting() ?? 0),
        notProcessed: port?.waiting() ?? 0,
        entries: [],
        balance: state.economy.money,
        events: [],
        warning: null,
        nextLabel: state.dayIndex >= state.daysTotal ? 'Final report' : 'Next morning',
      }
    },
    advance() {
      if (state.dayIndex >= state.daysTotal) state.phase = 'final'
      else {
        state.dayIndex += 1
        state.phase = 'bulletin'
      }
      return state.phase
    },
    summary: () => [`Days worked: ${state.dayIndex}`],
  }
}
