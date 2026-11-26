import { describe, expect, it } from 'vitest'
import type { ApplicantObservation, DayObservation, RespondRequest } from '../src/ai/adversary'
import { buildDossier } from '../src/ai/adversary'
import { buildBriefing } from '../src/ai/briefing'
import { answerQuestion } from '../src/ai/dialogueTemplates'
import {
  campaignPhase,
  createOfflineAdversary,
  planOfflineDay,
  profilePlayer,
} from '../src/ai/offlineAdversary'
import { normalizePlan } from '../src/ai/planCheck'
import { DayPlanSchema } from '../src/ai/schema'
import type { DifficultyId } from '../src/config'
import { emptyToolUsage } from '../src/core/observations'
import { contextForDay, createNewGame, prepareDay } from '../src/core/state'
import { simulateGame } from '../src/dev/simulation'
import { entry } from './loopHelpers'

describe('offline adversary plans', () => {
  it('plans for every day of every difficulty pass the plan check unchanged', async () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as DifficultyId[]) {
      for (const bot of ['perfect', 'careless'] as const) {
        for (const seed of [1, 2]) {
          const { state } = await simulateGame(seed, difficulty, bot)
          expect(state.days).toHaveLength(state.daysTotal)
          for (const day of state.days) {
            expect(day.plan.issues, `${difficulty} ${bot} ${seed} day ${day.dayIndex}`).toEqual([])
            expect(day.plan.source).toBe('offline')
            for (const a of day.applicants) {
              const fallback = a.notes.filter((n) =>
                /ENGINE WARNING|could not return|does not fit|already used|came instead/.test(n),
              )
              expect(fallback, `${a.id}`).toEqual([])
            }
          }
        }
      }
    }
  })

  it('the raw plan matches the schema and survives normalizePlan without changes', async () => {
    const state = createNewGame({ seed: 3, difficulty: 'hard' })
    const ctx = contextForDay(state, 1)
    const briefing = buildBriefing(ctx, state.world, state.ai)
    const adversary = createOfflineAdversary(3)
    const { plan } = await adversary.planDay({ briefing, previous: null, history: [] })
    expect(DayPlanSchema.safeParse(plan).success).toBe(true)
    expect(plan.applicants).toHaveLength(ctx.applicantCount)
    const normalized = normalizePlan(plan, ctx, state.world, state.ai)
    expect(normalized.issues).toEqual([])
    expect(normalized.plan.applicants).toEqual(plan.applicants)
    expect(plan.strategy_summary).toMatch(/^Day 1 of 28, probing/)
    expect(plan.notes_for_future_self.length).toBeGreaterThan(0)
  })

  it('is deterministic for the same seed', async () => {
    const a = await simulateGame(11, 'normal', 'careless')
    const b = await simulateGame(11, 'normal', 'careless')
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    const c = await simulateGame(12, 'normal', 'careless')
    expect(JSON.stringify(c.state.days[0]?.plan)).not.toBe(JSON.stringify(a.state.days[0]?.plan))
  })

  it('moves from probing to trust building to spending', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => campaignPhase(d, 7))).toEqual([
      'probe',
      'probe',
      'trust',
      'trust',
      'trust',
      'strike',
      'strike',
    ])
    expect(campaignPhase(1, 28)).toBe('probe')
    expect(campaignPhase(14, 28)).toBe('trust')
    expect(campaignPhase(28, 28)).toBe('strike')
  })

  it('introduces regulars, lets them return honestly and later turns or imitates them', async () => {
    const { state } = await simulateGame(4, 'hard', 'perfect')
    const characters = Object.values(state.world.characters)
    expect(characters.length).toBeGreaterThanOrEqual(2)
    const modes = characters.flatMap((c) => c.appearances.map((a) => `${a.kind}:${a.mode}`))
    expect(modes).toContain('legit:introduce')
    expect(modes).toContain('legit:reuse')
    expect(modes.some((m) => m === 'infiltrator:reuse' || m === 'infiltrator:impersonate')).toBe(
      true,
    )
  })

  it('saves real levers for later and spends the budget at the end', async () => {
    const { state } = await simulateGame(2, 'hard', 'careless')
    const realByDay = state.days.map(
      (d) => d.applicants.filter((a) => a.plan.lever.type !== 'none' && a.plan.lever.real).length,
    )
    const probeDays = realByDay.slice(0, 7)
    expect(probeDays.every((n) => n === 0)).toBe(true)
    expect(realByDay.reduce((s, n) => s + n, 0)).toBeGreaterThan(0)
    const spent = state.days.map((d) => d.plan.costSpent)
    const early = spent.slice(0, 7).reduce((s, n) => s + n, 0) / 7
    const late = spent.slice(-8).reduce((s, n) => s + n, 0) / 8
    expect(late).toBeGreaterThan(early)
  })
})

function fakeDay(day: number, useRegistry: boolean): DayObservation {
  const applicants: ApplicantObservation[] = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    applicantId: `d${day}-s${i + 1}`,
    kind: i < 4 ? 'infiltrator' : 'legit',
    baseProblem: i < 4 ? 'no_permit' : null,
    techniques: i < 4 ? ['forged_document'] : [],
    characterId: null,
    decision: 'approve',
    result: i < 4 ? (useRegistry ? 'stopped' : 'got_through') : 'legit_admitted',
    minutesSpent: 20,
    inspections: 1,
    flagged: [],
    questions: [],
    deepChecks: useRegistry ? ['registry'] : [],
    reports: [],
    bribeAccepted: false,
    legitQuirk: 'none',
    lever: 'none',
    leverReal: false,
    leverOutcome: null,
  }))
  return {
    dayIndex: day,
    applicants,
    toolUsage: { ...emptyToolUsage(), registry: useRegistry ? 10 : 0 },
    averageMinutesPerApplicant: 20,
    processed: 10,
    notProcessed: 0,
    infiltratorsThrough: useRegistry ? 0 : 4,
    infiltratorsStopped: useRegistry ? 4 : 0,
    legitDenied: 0,
    events: [],
    planIssues: [],
  }
}

describe('offline adversary adapts to the inspector', () => {
  it('measures how often each tool is used', () => {
    const heavy = profilePlayer([1, 2, 3].map((d) => fakeDay(d, true)))
    const never = profilePlayer([1, 2, 3].map((d) => fakeDay(d, false)))
    expect(heavy.deepRate.registry).toBeGreaterThan(0.8)
    expect(never.deepRate.registry).toBeLessThan(0.15)
    expect(never.lastUsed.registry).toBeNull()
  })

  it('avoids registry evidence against an inspector who always runs the registry', () => {
    const state = createNewGame({ seed: 9, difficulty: 'hard' })
    const paper = new Set(['alter_field', 'forged_document', 'clean_forgery'])
    let heavy = 0
    let never = 0
    for (let day = 15; day <= 28; day++) {
      const ctx = contextForDay(state, day)
      const briefing = buildBriefing(ctx, state.world, { budget: 14, leverTokens: 3 })
      const history = (registry: boolean) =>
        Array.from({ length: day - 1 }, (_, i) => fakeDay(i + 1, registry))
      for (const seed of [1, 2, 3]) {
        const count = (registry: boolean) =>
          planOfflineDay(
            { briefing, previous: null, history: history(registry) },
            seed,
          ).plan.applicants.filter((a) => a.techniques.some((t) => paper.has(t.type))).length
        heavy += count(true)
        never += count(false)
      }
    }
    expect(never).toBeGreaterThan(heavy * 2)
  })
})

describe('offline adversary in the interview', () => {
  async function dossierFor(plan = entry()) {
    const state = createNewGame({ seed: 21, difficulty: 'normal' })
    state.dayIndex = 4
    state.ai.budget = 10
    const prepared = prepareDay(
      state,
      { strategy_summary: '', notes_for_future_self: '', applicants: [plan] },
      'offline',
    )
    return buildDossier(prepared.applicants[0]!, state.world)
  }

  const ask = (
    dossier: Awaited<ReturnType<typeof dossierFor>>,
    kind: RespondRequest['question']['kind'],
    text = '',
  ) =>
    answerQuestion(
      { dossier, transcript: [], question: { kind, text, discrepancy: null, code: null } },
      1,
    )

  it('answers standard questions from the facts on the papers', async () => {
    const dossier = await dossierFor(
      entry({ persona: { demeanor: 'calm', backstory: '', cover_story: '' } }),
    )
    expect(ask(dossier, 'origin')).toContain(dossier.claimed.nationality)
    expect(ask(dossier, 'duration')).toContain(String(dossier.claimed.durationDays))
    expect(ask(dossier, 'stay')).toBe(ask(dossier, 'stay'))
    expect(ask(dossier, 'free', 'Are you an AI?')).not.toMatch(/\bAI\b|language model/i)
  })

  it('infiltrators stick to their cover story', async () => {
    const dossier = await dossierFor(
      entry({
        kind: 'infiltrator',
        base_problem: 'wrong_purpose',
        persona: { demeanor: 'calm', backstory: '', cover_story: 'Visiting my aunt in Ostmarch.' },
      }),
    )
    expect(dossier.claimed.purpose).toBe('visit')
    expect(dossier.claimed.occupation).not.toBe(dossier.occupation)
    expect(ask(dossier, 'purpose')).toBe('Visiting my aunt in Ostmarch.')
    const excuse = answerQuestion(
      {
        dossier,
        transcript: [],
        question: {
          kind: 'discrepancy',
          text: 'Explain.',
          discrepancy: 'x',
          code: 'WRONG_PURPOSE',
        },
      },
      1,
    )
    expect(excuse.length).toBeGreaterThan(0)
  })

  it('remembers its journal through export and import', async () => {
    const state = createNewGame({ seed: 3, difficulty: 'easy' })
    const briefing = buildBriefing(contextForDay(state, 1), state.world, state.ai)
    const a = createOfflineAdversary(3)
    await a.planDay({ briefing, previous: null, history: [] })
    const memory = JSON.parse(JSON.stringify(a.exportMemory()))
    const b = createOfflineAdversary(3)
    b.importMemory(memory)
    expect(b.journal).toEqual(a.journal)
    expect(b.journal[0]?.day).toBe(1)
    b.importMemory({ nonsense: true })
    expect(b.journal).toEqual([])
    const answer = await a.respond({
      dossier: await dossierFor(),
      transcript: [],
      question: { kind: 'purpose', text: 'Why?', discrepancy: null, code: null },
    })
    expect(answer.length).toBeGreaterThan(0)
  })
})
