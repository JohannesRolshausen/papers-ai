// Creating, saving and loading a game, and the step that turns an adversary plan into a day.

import type { NormalizedPlan } from '../ai/planCheck'
import { normalizePlan } from '../ai/planCheck'
import type { DayPlan } from '../ai/schema'
import type { DifficultyId } from '../config'
import { AI_BUDGET, DIFFICULTIES, ECONOMY, SHIFT, leverTokensFor } from '../config'
import { materializeDay } from './materialize'
import { createWorld } from './people'
import { buildDayContext, createSchedule } from './rules'
import type { Applicant, DayContext, GameState, Settings, StoredPlan } from './types'

export const SAVE_VERSION = 1
export const SAVE_KEY = 'oversight-save'

export const DEFAULT_MODEL = 'claude-opus-5-5'

export interface NewGameOptions {
  seed?: number
  difficulty: DifficultyId
  settings?: Partial<Settings>
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

export function createNewGame(options: NewGameOptions): GameState {
  const seed = options.seed ?? randomSeed()
  const daysTotal = DIFFICULTIES[options.difficulty].days
  const world = createWorld(seed)
  const schedule = createSchedule(seed, daysTotal, world)
  return {
    version: SAVE_VERSION,
    seed,
    difficulty: options.difficulty,
    daysTotal,
    settings: {
      aiMode: options.settings?.aiMode ?? 'offline',
      model: options.settings?.model ?? DEFAULT_MODEL,
      shiftRealSeconds: options.settings?.shiftRealSeconds ?? SHIFT.defaultRealSeconds,
    },
    dayIndex: 1,
    phase: 'bulletin',
    world,
    schedule,
    economy: { money: ECONOMY.startingMoney, daysInDebt: 0, ledger: [] },
    ai: { budget: AI_BUDGET.start, leverTokens: leverTokensFor(daysTotal) },
    days: [],
    pending: [],
    adversaryMemory: null,
    createdAt: new Date().toISOString(),
  }
}

export function contextForDay(state: GameState, dayIndex: number = state.dayIndex): DayContext {
  return buildDayContext(state.schedule, state.world, dayIndex)
}

// Budget the adversary may spend today. Called once at the start of each day after day 1.
export function grantDailyBudget(state: GameState): void {
  state.ai.budget = Math.min(AI_BUDGET.maxBank, state.ai.budget + AI_BUDGET.perDay)
}

export interface PreparedDay {
  context: DayContext
  plan: StoredPlan
  applicants: Applicant[]
  normalized: NormalizedPlan
}

// Check the plan, charge the adversary, build the applicants. Mutates state.world and state.ai.
export function prepareDay(
  state: GameState,
  rawPlan: DayPlan,
  source: StoredPlan['source'],
  context: DayContext = contextForDay(state),
): PreparedDay {
  const normalized = normalizePlan(rawPlan, context, state.world, state.ai)
  state.ai.budget -= normalized.cost
  state.ai.leverTokens -= normalized.realLevers
  const applicants = materializeDay(normalized.plan, context, state.world)
  const plan: StoredPlan = {
    day: context.dayIndex,
    source,
    plan: normalized.plan,
    issues: normalized.issues,
    costSpent: normalized.cost,
  }
  return { context, plan, applicants, normalized }
}

// ---------- Saving ----------

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state)
}

export function deserializeGame(json: string): GameState | null {
  try {
    const parsed = JSON.parse(json) as Partial<GameState>
    if (parsed.version !== SAVE_VERSION || !parsed.world || !parsed.schedule) return null
    return parsed as GameState
  } catch {
    return null
  }
}

export function saveGame(state: GameState, storage: StorageLike, key = SAVE_KEY): boolean {
  try {
    storage.setItem(key, serializeGame(state))
    return true
  } catch {
    return false
  }
}

export function loadGame(storage: StorageLike, key = SAVE_KEY): GameState | null {
  try {
    const json = storage.getItem(key)
    return json ? deserializeGame(json) : null
  } catch {
    return null
  }
}

export function clearSave(storage: StorageLike, key = SAVE_KEY): void {
  try {
    storage.removeItem(key)
  } catch {
    // Storage may be blocked, nothing to clear then
  }
}
