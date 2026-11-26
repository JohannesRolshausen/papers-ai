import { describe, expect, it } from 'vitest'
import { defaultApplicantPlan } from '../src/ai/planCheck'
import type { ApplicantPlan } from '../src/ai/schema'
import { addDays, addYears } from '../src/core/dates'
import type {
  DiplomaticAuth,
  EntryPermit,
  GameDocument,
  HealthCert,
  IdCard,
  Passport,
} from '../src/core/documents'
import { refKey } from '../src/core/refs'
import { contextForDay, createNewGame, prepareDay } from '../src/core/state'
import type { Applicant, DayContext, GameState } from '../src/core/types'
import {
  bodyScanReport,
  fingerprintReport,
  matchInspection,
  registryReport,
  tenYearsApart,
  validateApplicant,
  verifyLetterReport,
} from '../src/core/validator'

function setup(
  day: number,
  entry: Partial<ApplicantPlan>,
  seed = 3,
): { a: Applicant; ctx: DayContext; state: GameState } {
  const state = createNewGame({ seed, difficulty: 'hard' })
  state.dayIndex = day
  state.ai = { budget: 99, leverTokens: 9 }
  const ctx = contextForDay(state)
  const prepared = prepareDay(
    state,
    {
      strategy_summary: '',
      notes_for_future_self: '',
      applicants: [{ ...defaultApplicantPlan(), ...entry }],
    },
    'offline',
    ctx,
  )
  return { a: prepared.applicants[0] as Applicant, ctx, state }
}

function withDoc<T extends GameDocument>(
  a: Applicant,
  type: T['type'],
  change: (doc: T) => T,
): Applicant {
  return { ...a, documents: a.documents.map((d) => (d.type === type ? change(d as T) : d)) }
}

function codesOf(a: Applicant, ctx: DayContext, state: GameState): string[] {
  return validateApplicant(a, ctx, state.world).map((v) => v.code)
}

describe('validator', () => {
  it('accepts a plain legit foreigner', () => {
    const { a, ctx, state } = setup(9, { nationality: 'lunmark', purpose: 'visit' })
    expect(codesOf(a, ctx, state)).toEqual([])
  })

  it('flags an expired passport with the calendar as evidence', () => {
    const { a, ctx, state } = setup(1, { nationality: 'drastia' })
    const changed = withDoc<Passport>(a, 'passport', (p) => ({
      ...p,
      expires: addDays(ctx.date, -1),
      issued: addYears(addDays(ctx.date, -1), -10),
    }))
    const violations = validateApplicant(changed, ctx, state.world)
    const expired = violations.find((v) => v.code === 'PASSPORT_EXPIRED')
    expect(expired).toBeDefined()
    const passport = changed.documents.find((d) => d.type === 'passport') as Passport
    const match = matchInspection(violations, ['calendar', `doc:${passport.id}:expires`])
    expect(match?.violation.code).toBe('PASSPORT_EXPIRED')
    expect(matchInspection(violations, [`doc:${passport.id}:surname`, 'calendar'])).toBeNull()
  })

  it('treats leap days as ten years apart', () => {
    expect(tenYearsApart('2030-02-28', '2040-02-29')).toBe(true)
    expect(tenYearsApart('2031-03-01', '2041-03-01')).toBe(true)
    expect(tenYearsApart('2030-03-01', '2041-03-01')).toBe(false)
  })

  it('checks identity card details for citizens', () => {
    const { a, ctx, state } = setup(9, { legit_quirk: 'returning_citizen' })
    expect(a.documents.some((d) => d.type === 'idCard')).toBe(true)
    const badDistrict = withDoc<IdCard>(a, 'idCard', (c) => ({ ...c, district: 'South Halven' }))
    expect(codesOf(badDistrict, ctx, state)).toContain('INVALID_DISTRICT')
    const badDob = withDoc<IdCard>(a, 'idCard', (c) => ({ ...c, dob: addDays(c.dob, 3) }))
    expect(codesOf(badDob, ctx, state)).toContain('DOB_MISMATCH')
    const noCard = { ...a, documents: a.documents.filter((d) => d.type !== 'idCard') }
    expect(codesOf(noCard, ctx, state)).toEqual(['MISSING_DOCUMENT'])
  })

  it('checks permit validity and duration', () => {
    const { a, ctx, state } = setup(9, { nationality: 'tarvenne', purpose: 'visit' })
    const expired = withDoc<EntryPermit>(a, 'entryPermit', (p) => ({
      ...p,
      validUntil: addDays(ctx.date, -1),
    }))
    expect(codesOf(expired, ctx, state)).toContain('DOC_EXPIRED')
    const tooLong = withDoc<EntryPermit>(a, 'entryPermit', (p) => ({ ...p, durationDays: 45 }))
    expect(codesOf(tooLong, ctx, state)).toContain('DURATION_EXCEEDED')
  })

  it('checks health certificates', () => {
    const { a, ctx, state } = setup(5, { nationality: 'kelmar', purpose: 'visit' })
    expect(a.documents.some((d) => d.type === 'healthCert')).toBe(true)
    const wrong = withDoc<HealthCert>(a, 'healthCert', (c) => ({ ...c, vaccine: 'RK-12' }))
    expect(codesOf(wrong, ctx, state)).toContain('WRONG_VACCINE')
    const old = withDoc<HealthCert>(a, 'healthCert', (c) => ({
      ...c,
      vaccinatedOn: addYears(ctx.date, -4),
      issued: addYears(ctx.date, -4),
    }))
    expect(codesOf(old, ctx, state)).toContain('VACCINATION_EXPIRED')
  })

  it('rejects a diplomatic authorization without Velmark access', () => {
    const { a, ctx, state } = setup(7, { legit_quirk: 'diplomat' })
    const noAccess = withDoc<DiplomaticAuth>(a, 'diplomaticAuth', (d) => ({
      ...d,
      accessTo: d.accessTo.filter((c) => c !== 'velmark'),
    }))
    expect(codesOf(noAccess, ctx, state)).toContain('DIPLOMATIC_ACCESS')
  })

  it('accepts hats and glasses that the photo does not show', () => {
    const { a, ctx, state } = setup(9, { legit_quirk: 'new_look' })
    expect(codesOf(a, ctx, state)).toEqual([])
  })

  it('builds refs that inspect mode can match', () => {
    const { a, ctx, state } = setup(4, {
      kind: 'infiltrator',
      base_problem: 'no_permit',
      techniques: [
        {
          type: 'forged_document',
          target_doc: 'entryPermit',
          flaw: 'name_spelling',
          field: null,
          subtle: true,
        },
      ],
    })
    const violations = validateApplicant(a, ctx, state.world)
    const nameIssue = violations.find((v) => v.code === 'NAME_MISMATCH')
    const evidence = nameIssue?.evidence[0]
    expect(evidence?.tool).toBe('inspect')
    const keys = (evidence?.refs ?? []).map(refKey).reverse()
    expect(matchInspection(violations, keys)?.violation.code).toBe('NAME_MISMATCH')
  })
})

describe('deep check reports', () => {
  it('fingerprints expose a borrowed identity', () => {
    const { a, ctx, state } = setup(5, {
      kind: 'infiltrator',
      base_problem: 'expired_passport',
      techniques: [
        { type: 'borrowed_identity', target_doc: null, flaw: null, field: null, subtle: false },
      ],
    })
    const report = fingerprintReport(a, ctx, state.world)
    expect(report.matchesPassport).toBe(false)
    expect(report.lines).toContain('DOES NOT MATCH PASSPORT HOLDER')
  })

  it('fingerprints confirm a legit traveler', () => {
    const { a, ctx, state } = setup(5, {})
    expect(fingerprintReport(a, ctx, state.world).matchesPassport).toBe(true)
  })

  it('registry finds no record of a clean forgery', () => {
    const { a, state } = setup(4, {
      kind: 'infiltrator',
      base_problem: 'no_permit',
      techniques: [
        {
          type: 'clean_forgery',
          target_doc: 'entryPermit',
          flaw: null,
          field: null,
          subtle: false,
        },
      ],
    })
    const permit = a.documents.find((d) => d.type === 'entryPermit') as EntryPermit
    expect(registryReport(permit, state.world).found).toBe(false)
    const passport = a.documents.find((d) => d.type === 'passport') as Passport
    expect(registryReport(passport, state.world).found).toBe(true)
  })

  it('registry shows altered fields', () => {
    const { a, state } = setup(3, {
      kind: 'infiltrator',
      base_problem: 'expired_passport',
      techniques: [
        { type: 'alter_field', target_doc: null, flaw: null, field: 'expires', subtle: false },
      ],
    })
    const passport = a.documents.find((d) => d.type === 'passport') as Passport
    const report = registryReport(passport, state.world)
    expect(report.found).toBe(true)
    expect(report.differences.map((d) => d.field)).toEqual(['expires'])
  })

  it('body scan and letter verification report what they find', () => {
    const { a } = setup(5, {
      kind: 'infiltrator',
      base_problem: 'smuggler',
      techniques: [
        { type: 'hidden_item', target_doc: null, flaw: null, field: null, subtle: false },
        { type: 'fake_letter', target_doc: null, flaw: null, field: null, subtle: false },
      ],
      letter: {
        title: 'Note',
        sender: 'Dr. Brenner',
        body: 'My patient needs to pass.',
        claims_exemption: false,
      },
    })
    expect(bodyScanReport(a).items.length).toBe(1)
    const letter = a.documents.find((d) => d.type === 'letter')
    expect(letter && letter.type === 'letter' && verifyLetterReport(letter).authentic).toBe(false)
  })
})
