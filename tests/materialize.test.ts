import { describe, expect, it } from 'vitest'
import { defaultApplicantPlan } from '../src/ai/planCheck'
import type { ApplicantPlan, BaseProblemId, TechniquePlan } from '../src/ai/schema'
import { rngFor } from '../src/core/rng'
import { contextForDay, createNewGame, prepareDay } from '../src/core/state'
import type { Applicant, DayContext, GameState } from '../src/core/types'
import { randomDayPlan, reliableEvidence } from './helpers'

function describeApplicant(a: Applicant): string {
  return JSON.stringify(
    {
      id: a.id,
      kind: a.kind,
      base: a.baseProblem,
      techniques: a.techniques,
      notes: a.notes,
      violations: a.violations.map((v) => ({ code: v.code, tools: v.evidence.map((e) => e.tool) })),
    },
    null,
    1,
  )
}

function checkFairness(applicant: Applicant, ctx: DayContext): void {
  if (applicant.kind === 'legit') {
    expect(applicant.violations, describeApplicant(applicant)).toEqual([])
    expect(applicant.admissible).toBe(true)
  } else {
    expect(applicant.admissible, describeApplicant(applicant)).toBe(false)
    const findable = applicant.violations.some((v) =>
      v.evidence.some((e) => reliableEvidence(e, ctx)),
    )
    expect(findable, describeApplicant(applicant)).toBe(true)
  }
}

function runGame(seed: number, rich: boolean): GameState {
  const state = createNewGame({ seed, difficulty: 'hard' })
  for (let day = 1; day <= state.daysTotal; day++) {
    state.dayIndex = day
    if (rich) state.ai = { budget: 99, leverTokens: 99 }
    const ctx = contextForDay(state)
    const plan = randomDayPlan(rngFor(seed, 'fuzz-plan', day), ctx, state.world)
    const prepared = prepareDay(state, plan, 'offline', ctx)
    expect(prepared.applicants.length).toBe(ctx.applicantCount)
    for (const applicant of prepared.applicants) checkFairness(applicant, ctx)
  }
  return state
}

describe('materializer fairness', () => {
  it('holds for random plans over many 28-day games', () => {
    for (let seed = 1; seed <= 25; seed++) runGame(seed, true)
  })

  it('holds when the adversary is short on budget', () => {
    for (let seed = 100; seed <= 110; seed++) runGame(seed, false)
  })

  it('is deterministic for the same seed', () => {
    const a = runGame(42, true)
    const b = runGame(42, true)
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world))
  })
})

function single(
  day: number,
  entry: Partial<ApplicantPlan>,
  seed = 7,
): { applicant: Applicant; ctx: DayContext; state: GameState; issues: string[] } {
  const state = createNewGame({ seed, difficulty: 'hard' })
  state.dayIndex = day
  state.ai = { budget: 99, leverTokens: 9 }
  const ctx = contextForDay(state)
  const plan = {
    strategy_summary: '',
    notes_for_future_self: '',
    applicants: [{ ...defaultApplicantPlan(), ...entry }],
  }
  const prepared = prepareDay(state, plan, 'offline', ctx)
  return {
    applicant: prepared.applicants[0] as Applicant,
    ctx,
    state,
    issues: prepared.plan.issues,
  }
}

const t = (type: TechniquePlan['type'], extra: Partial<TechniquePlan> = {}): TechniquePlan => ({
  type,
  target_doc: null,
  flaw: null,
  field: null,
  subtle: false,
  ...extra,
})

function codes(a: Applicant): string[] {
  return a.violations.map((v) => v.code)
}

function tools(a: Applicant): Set<string> {
  return new Set(a.violations.flatMap((v) => v.evidence.map((e) => e.tool)))
}

describe('techniques leave the promised evidence', () => {
  it('clean forgery of a permit is only visible in the registry', () => {
    const { applicant } = single(4, {
      kind: 'infiltrator',
      base_problem: 'no_permit',
      techniques: [t('clean_forgery', { target_doc: 'entryPermit' })],
    })
    expect(codes(applicant)).toEqual(['DOC_UNREGISTERED'])
    expect([...tools(applicant)]).toEqual(['registry'])
  })

  it('forged permit with a seal flaw shows a seal problem', () => {
    const { applicant } = single(4, {
      kind: 'infiltrator',
      base_problem: 'no_permit',
      techniques: [t('forged_document', { target_doc: 'entryPermit', flaw: 'seal' })],
    })
    expect(codes(applicant)).toContain('SEAL_INVALID')
    expect(codes(applicant)).toContain('DOC_UNREGISTERED')
  })

  it('altered expiry date breaks the 10 year rule and the registry', () => {
    const { applicant } = single(3, {
      kind: 'infiltrator',
      base_problem: 'expired_passport',
      techniques: [t('alter_field', { field: 'expires', subtle: true })],
    })
    expect(codes(applicant)).toContain('PASSPORT_DATES_INCONSISTENT')
    expect(codes(applicant)).toContain('DOC_ALTERED')
    expect(codes(applicant)).not.toContain('PASSPORT_EXPIRED')
  })

  it('borrowed identity needs fingerprints, photo and height give hints', () => {
    const { applicant } = single(5, {
      kind: 'infiltrator',
      base_problem: 'expired_passport',
      techniques: [t('borrowed_identity')],
    })
    expect(codes(applicant)).toContain('IDENTITY_MISMATCH')
    expect(codes(applicant)).toContain('PHOTO_MISMATCH')
    expect(codes(applicant)).toContain('HEIGHT_MISMATCH')
    expect(codes(applicant)).not.toContain('PASSPORT_EXPIRED')
  })

  it('a hidden smuggler shows nothing but the body scan', () => {
    const { applicant } = single(5, {
      kind: 'infiltrator',
      base_problem: 'smuggler',
      techniques: [t('hidden_item')],
    })
    expect(codes(applicant)).toEqual(['CONTRABAND'])
    expect([...tools(applicant)]).toEqual(['bodyScan'])
  })

  it('an open smuggler is heavier than the passport says', () => {
    const { applicant } = single(5, {
      kind: 'infiltrator',
      base_problem: 'smuggler',
      techniques: [],
    })
    expect(codes(applicant)).toContain('WEIGHT_MISMATCH')
    expect(codes(applicant)).toContain('CONTRABAND')
  })

  it('wanted person with disguise and clean false passport needs fingerprints or a sharp eye', () => {
    const { applicant } = single(8, {
      kind: 'infiltrator',
      base_problem: 'wanted',
      techniques: [t('clean_forgery', { target_doc: 'passport' }), t('disguise')],
    })
    expect(codes(applicant)).toContain('WANTED')
    const wanted = applicant.violations.find((v) => v.code === 'WANTED')
    expect(wanted?.evidence.some((e) => e.tool === 'fingerprints')).toBe(true)
    expect(wanted?.evidence.some((e) => e.tool === 'inspect' && e.difficulty === 'hard')).toBe(true)
  })

  it('false purpose with hidden tools only shows in the scan and the interview', () => {
    const { applicant } = single(6, {
      kind: 'infiltrator',
      base_problem: 'wrong_purpose',
      techniques: [t('hidden_item')],
    })
    expect(codes(applicant)).toEqual(['WRONG_PURPOSE'])
    expect(tools(applicant)).toEqual(new Set(['interrogate', 'bodyScan']))
  })

  it('a subtle fake letter is only exposed by verification and the bulletin', () => {
    const { applicant } = single(5, {
      kind: 'infiltrator',
      base_problem: 'no_permit',
      techniques: [t('fake_letter', { subtle: true })],
      letter: {
        title: 'Exemption',
        sender: 'Velmark Ministry of Admission',
        body: 'Exempt.',
        claims_exemption: true,
      },
    })
    const letter = applicant.violations.find((v) => v.code === 'FORGED_LETTER')
    expect(letter?.evidence.map((e) => e.tool).sort()).toEqual(['inspect', 'verifyLetter'])
    expect(codes(applicant)).toContain('MISSING_DOCUMENT')
  })

  it('every base problem without techniques is visible on day 9', () => {
    const bases: BaseProblemId[] = [
      'no_permit',
      'expired_passport',
      'wanted',
      'revoked_document',
      'missing_work_pass',
    ]
    for (const base of bases) {
      const { applicant, ctx } = single(9, {
        kind: 'infiltrator',
        base_problem: base,
        techniques: [],
      })
      expect(applicant.admissible, base).toBe(false)
      expect(
        applicant.violations.some((v) =>
          v.evidence.some((e) => e.tool === 'inspect' && reliableEvidence(e, ctx)),
        ),
        base,
      ).toBe(true)
    }
  })
})

describe('legit quirks stay legal', () => {
  it('passport expiring today is valid', () => {
    const { applicant } = single(5, { legit_quirk: 'passport_expires_today' })
    expect(applicant.violations).toEqual([])
  })

  it('weight change within tolerance is valid', () => {
    const { applicant } = single(5, { legit_quirk: 'weight_change' })
    expect(applicant.violations).toEqual([])
  })

  it('diplomats travel without an entry permit', () => {
    const { applicant } = single(7, { legit_quirk: 'diplomat' })
    expect(applicant.documents.some((d) => d.type === 'diplomaticAuth')).toBe(true)
    expect(applicant.documents.some((d) => d.type === 'entryPermit')).toBe(false)
    expect(applicant.violations).toEqual([])
  })
})

describe('recurring characters', () => {
  it('can be introduced, return and be impersonated', () => {
    const state = createNewGame({ seed: 11, difficulty: 'hard' })
    const run = (day: number, entries: Partial<ApplicantPlan>[]) => {
      state.dayIndex = day
      state.ai = { budget: 99, leverTokens: 9 }
      const ctx = contextForDay(state)
      const plan = {
        strategy_summary: '',
        notes_for_future_self: '',
        applicants: entries.map((e) => ({ ...defaultApplicantPlan(), ...e })),
      }
      return prepareDay(state, plan, 'offline', ctx).applicants
    }
    const [first] = run(4, [
      {
        recurring: { mode: 'introduce', character_id: null, nickname: 'The baker' },
        nationality: 'lunmark',
        purpose: 'visit',
      },
    ])
    expect(first?.characterId).toBe('char-1')
    const personId = first?.personId
    const [second] = run(5, [
      { recurring: { mode: 'reuse', character_id: 'char-1', nickname: null } },
    ])
    expect(second?.personId).toBe(personId)
    expect(second?.violations).toEqual([])
    const [third] = run(6, [
      {
        kind: 'infiltrator',
        base_problem: 'no_permit',
        recurring: { mode: 'impersonate', character_id: 'char-1', nickname: null },
      },
    ])
    expect(third?.personId).not.toBe(personId)
    expect(third?.characterId).toBe('char-1')
    expect(third?.violations.map((v) => v.code)).toContain('IDENTITY_MISMATCH')
    expect(state.world.characters['char-1']?.appearances.map((a) => a.mode)).toEqual([
      'introduce',
      'reuse',
      'impersonate',
    ])
  })
})
