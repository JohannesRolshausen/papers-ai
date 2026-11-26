import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { buildBriefing } from '../src/ai/briefing'
import { buildDossier } from '../src/ai/adversary'
import { defaultApplicantPlan, normalizePlan } from '../src/ai/planCheck'
import type { ApplicantPlan, DayPlan } from '../src/ai/schema'
import { DayPlanSchema } from '../src/ai/schema'
import {
  contextForDay,
  createNewGame,
  deserializeGame,
  grantDailyBudget,
  loadGame,
  prepareDay,
  saveGame,
  serializeGame,
} from '../src/core/state'
import { AI_BUDGET, applicantsForDay, infiltratorCapForDay } from '../src/config'

const infiltrator = (extra: Partial<ApplicantPlan> = {}): ApplicantPlan => ({
  ...defaultApplicantPlan(),
  kind: 'infiltrator',
  base_problem: 'no_permit',
  techniques: [
    { type: 'clean_forgery', target_doc: 'entryPermit', flaw: null, field: null, subtle: false },
  ],
  ...extra,
})

function planOf(applicants: ApplicantPlan[]): DayPlan {
  return { strategy_summary: 'Test', notes_for_future_self: 'Notes', applicants }
}

describe('DayPlan schema', () => {
  it('parses a full plan and rejects a broken one', () => {
    const plan = planOf([infiltrator(), defaultApplicantPlan()])
    expect(DayPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
    expect(DayPlanSchema.safeParse({ ...plan, applicants: [{ kind: 'spy' }] }).success).toBe(false)
  })

  it('converts to a structured output format for the Claude API', () => {
    const format = zodOutputFormat(DayPlanSchema)
    expect(format.type).toBe('json_schema')
    const schema = format.schema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    const text = JSON.stringify(schema)
    expect(text).toContain('base_problem')
    expect(text).toContain('borrowed_identity')
    const parsed = format.parse(JSON.stringify(planOf([infiltrator()])))
    expect(parsed.applicants[0]?.base_problem).toBe('no_permit')
  })
})

describe('plan check', () => {
  const state = createNewGame({ seed: 5, difficulty: 'normal' })
  state.dayIndex = 4
  const ctx = contextForDay(state)

  it('fills and trims the queue to the day size', () => {
    expect(normalizePlan(planOf([]), ctx, state.world, state.ai).plan.applicants.length).toBe(
      applicantsForDay(4),
    )
    const many = planOf(Array.from({ length: 30 }, () => defaultApplicantPlan()))
    expect(normalizePlan(many, ctx, state.world, state.ai).plan.applicants.length).toBe(
      applicantsForDay(4),
    )
  })

  it('enforces the infiltrator cap', () => {
    const plan = planOf(
      Array.from({ length: ctx.applicantCount }, () => infiltrator({ techniques: [] })),
    )
    const result = normalizePlan(plan, ctx, state.world, { budget: 99, leverTokens: 9 })
    expect(result.plan.applicants.filter((a) => a.kind === 'infiltrator').length).toBe(
      infiltratorCapForDay(ctx.applicantCount),
    )
  })

  it('drops techniques the budget cannot pay for', () => {
    const plan = planOf([infiltrator(), infiltrator(), infiltrator()])
    const result = normalizePlan(plan, ctx, state.world, { budget: 5, leverTokens: 0 })
    expect(result.cost).toBe(4)
    expect(result.plan.applicants.filter((a) => a.techniques.length > 0).length).toBe(1)
    expect(result.issues.some((i) => i.includes('budget'))).toBe(true)
  })

  it('allows one primary technique and repairs bad parameters', () => {
    const plan = planOf([
      infiltrator({
        base_problem: 'expired_passport',
        techniques: [
          { type: 'alter_field', target_doc: null, flaw: null, field: 'surname', subtle: true },
          { type: 'clean_forgery', target_doc: 'passport', flaw: null, field: null, subtle: false },
        ],
      }),
    ])
    const result = normalizePlan(plan, ctx, state.world, { budget: 99, leverTokens: 0 })
    const techniques = result.plan.applicants[0]?.techniques ?? []
    expect(techniques.map((t) => t.type)).toEqual(['alter_field'])
    expect(techniques[0]?.field).toBe('expires')
  })

  it('turns impossible infiltrators into legit travelers', () => {
    const day1 = contextForDay(state, 1)
    const plan = planOf([infiltrator({ base_problem: 'wanted' })])
    const result = normalizePlan(plan, day1, state.world, { budget: 99, leverTokens: 0 })
    expect(result.plan.applicants[0]?.kind).toBe('legit')
    expect(result.plan.applicants[0]?.techniques).toEqual([])
  })

  it('makes threats empty when no lever tokens are left', () => {
    const plan = planOf([
      infiltrator({
        lever: { type: 'threat', real: true, line: 'I know your face.', amount: null },
      }),
      infiltrator({ lever: { type: 'bribe', real: true, line: 'For your trouble.', amount: 900 } }),
    ])
    const result = normalizePlan(plan, ctx, state.world, { budget: 99, leverTokens: 1 })
    expect(result.realLevers).toBe(1)
    expect(result.plan.applicants[1]?.lever.real).toBe(false)
    expect(result.plan.applicants[1]?.lever.amount).toBe(100)
  })
})

describe('briefing and dossier', () => {
  it('tells the adversary what is possible today', () => {
    const state = createNewGame({ seed: 8, difficulty: 'easy' })
    const day1 = buildBriefing(contextForDay(state, 1), state.world, state.ai)
    expect(day1.baseProblems.find((b) => b.id === 'expired_passport')?.available).toBe(true)
    expect(day1.baseProblems.find((b) => b.id === 'no_permit')?.available).toBe(false)
    expect(day1.techniques.find((t) => t.id === 'borrowed_identity')?.available).toBe(false)
    expect(day1.daysRemaining).toBe(6)
    const day6 = buildBriefing(contextForDay(state, 6), state.world, state.ai)
    expect(day6.baseProblems.every((b) => b.id === 'banned_nationality' || b.available)).toBe(true)
  })

  it('gives the persona its secrets', () => {
    const state = createNewGame({ seed: 8, difficulty: 'easy' })
    state.dayIndex = 4
    state.ai.budget = 10
    const prepared = prepareDay(state, planOf([infiltrator()]), 'offline')
    const dossier = buildDossier(prepared.applicants[0]!, state.world)
    expect(dossier.kind).toBe('infiltrator')
    expect(dossier.secrets.length).toBeGreaterThan(0)
    expect(dossier.documents.some((d) => d.startsWith('Entry permit'))).toBe(true)
  })
})

describe('game state', () => {
  it('round-trips through JSON and storage', () => {
    const state = createNewGame({ seed: 12, difficulty: 'normal' })
    prepareDay(state, planOf([infiltrator()]), 'offline')
    const copy = deserializeGame(serializeGame(state))
    expect(copy).toEqual(state)
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    expect(saveGame(state, storage)).toBe(true)
    expect(loadGame(storage)?.seed).toBe(12)
    expect(deserializeGame('not json')).toBeNull()
    expect(deserializeGame('{"version":0}')).toBeNull()
  })

  it('charges the adversary and caps its savings', () => {
    const state = createNewGame({ seed: 12, difficulty: 'normal' })
    state.dayIndex = 4
    const before = state.ai.budget
    const prepared = prepareDay(state, planOf([infiltrator()]), 'offline')
    expect(state.ai.budget).toBe(before - prepared.plan.costSpent)
    for (let i = 0; i < 20; i++) grantDailyBudget(state)
    expect(state.ai.budget).toBe(AI_BUDGET.maxBank)
  })
})
