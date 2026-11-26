// Helpers for controller tests: an adversary with a fixed plan and quick ways to run a shift.

import type { Adversary, PlanRequest, PlanResult } from '../src/ai/adversary'
import { answerQuestion } from '../src/ai/dialogueTemplates'
import { defaultApplicantPlan } from '../src/ai/planCheck'
import type { ApplicantPlan, TechniquePlan } from '../src/ai/schema'
import type { DifficultyId } from '../src/config'
import type { ConsequenceOdds } from '../src/core/consequences'
import type { BoothSession, DayLoopOptions, OpenForm } from '../src/core/dayLoop'
import { DayLoop } from '../src/core/dayLoop'
import { createNewGame } from '../src/core/state'
import type { GameState } from '../src/core/types'

export function entry(partial: Partial<ApplicantPlan> = {}): ApplicantPlan {
  return { ...defaultApplicantPlan('test'), ...partial }
}

export function technique(
  type: TechniquePlan['type'],
  extra: Partial<TechniquePlan> = {},
): TechniquePlan {
  return { type, target_doc: null, flaw: null, field: null, subtle: false, ...extra }
}

export interface FixedAdversary extends Adversary {
  calls: PlanRequest[]
}

// Plans the given entries for each day, the engine fills the rest of the line
export function fixedAdversary(plan: (day: number) => ApplicantPlan[], seed = 1): FixedAdversary {
  const calls: PlanRequest[] = []
  return {
    mode: 'offline',
    calls,
    async planDay(request: PlanRequest): Promise<PlanResult> {
      calls.push(request)
      return {
        plan: {
          strategy_summary: 'fixed',
          notes_for_future_self: '',
          applicants: plan(request.briefing.dayIndex),
        },
        source: 'offline',
        notice: null,
      }
    },
    async respond(request) {
      return answerQuestion(request, seed)
    },
    exportMemory: () => null,
    importMemory: () => undefined,
  }
}

export const NEVER: ConsequenceOdds = {
  bribeAudit: 0,
  wrongDenialComplaint: 0,
  lateDiscovery: 0,
  threatSabotage: 0,
  sabotageDown: 0,
}

export const ALWAYS: ConsequenceOdds = {
  bribeAudit: 1,
  wrongDenialComplaint: 1,
  lateDiscovery: 1,
  threatSabotage: 1,
  sabotageDown: 1,
}

export interface Setup {
  state: GameState
  loop: DayLoop
  adversary: FixedAdversary
}

export function setup(
  plan: (day: number) => ApplicantPlan[],
  options: { seed?: number; difficulty?: DifficultyId; loop?: DayLoopOptions } = {},
): Setup {
  const seed = options.seed ?? 5
  const state = createNewGame({ seed, difficulty: options.difficulty ?? 'normal' })
  state.ai.budget = 99
  const adversary = fixedAdversary(plan, seed)
  const loop = new DayLoop(state, adversary, { odds: NEVER, ...options.loop })
  return { state, loop, adversary }
}

// Starts the given day, playing earlier days with everyone approved
export async function playUntil(s: Setup, day: number): Promise<void> {
  for (;;) {
    await s.loop.startDay()
    if (s.state.dayIndex >= day) return
    s.loop.beginShift()
    approveAll(s.loop)
    s.loop.endShift()
  }
}

export function approveAll(loop: DayLoop): void {
  while (!loop.shiftOver) {
    const called = loop.callNext()
    if (!called.ok) return
    decideFully(loop, 'approve')
  }
}

export function decideFully(loop: DayLoop, decision: 'approve' | 'deny'): void {
  for (let i = 0; i < 3; i++) {
    const result = loop.decide(decision)
    if (!result.ok || result.status === 'done') return
  }
}

export function callFirst(loop: DayLoop): BoothSession {
  loop.beginShift()
  const called = loop.callNext()
  if (!called.ok) throw new Error(called.message)
  return called.session
}

export function typed(form: OpenForm): { text: string; ms: number; typos: number } {
  return { text: form.line, ms: 12_000, typos: 0 }
}
