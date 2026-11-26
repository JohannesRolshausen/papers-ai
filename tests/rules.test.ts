import { describe, expect, it } from 'vitest'
import { addDays, addYears, formatDocDate, fullYearsBetween } from '../src/core/dates'
import { hashString, rngFor } from '../src/core/rng'
import { ROTATING_AUTHORITIES, hasRule } from '../src/core/rules'
import { contextForDay, createNewGame } from '../src/core/state'

describe('dates and randomness', () => {
  it('does calendar math in UTC', () => {
    expect(addDays('2041-03-04', 30)).toBe('2041-04-03')
    expect(addYears('2040-02-29', 1)).toBe('2041-02-28')
    expect(formatDocDate('2041-03-04')).toBe('04 MAR 2041')
    expect(fullYearsBetween('2038-03-05', '2041-03-04')).toBe(2)
    expect(fullYearsBetween('2038-03-04', '2041-03-04')).toBe(3)
  })

  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    const a = rngFor(5, 'x', 1)
    const b = rngFor(5, 'x', 1)
    expect([a.next(), a.int(1, 6), a.pick(['p', 'q', 'r'])]).toEqual([
      b.next(),
      b.int(1, 6),
      b.pick(['p', 'q', 'r']),
    ])
  })
})

describe('rule schedule', () => {
  const state = createNewGame({ seed: 99, difficulty: 'hard' })

  it('introduces rules in a fixed order during the first week', () => {
    expect(contextForDay(state, 1).rules.map((r) => r.id)).toEqual([
      'passport_required',
      'documents_authentic',
      'identity_match',
    ])
    expect(hasRule(contextForDay(state, 1).rules, 'entry_permit_required')).toBe(false)
    expect(hasRule(contextForDay(state, 2).rules, 'entry_permit_required')).toBe(true)
    expect(hasRule(contextForDay(state, 3).rules, 'wanted_list')).toBe(true)
    expect(hasRule(contextForDay(state, 5).rules, 'health_cert_required')).toBe(true)
    expect(hasRule(contextForDay(state, 6).rules, 'diplomatic_exemption')).toBe(true)
    expect(hasRule(contextForDay(state, 7).rules, 'border_closed')).toBe(true)
  })

  it('unlocks tools over the first days', () => {
    expect(contextForDay(state, 1).tools).toEqual(['inspect', 'questions', 'registry'])
    expect(contextForDay(state, 2).tools).toContain('fingerprints')
    expect(contextForDay(state, 3).tools).toContain('bodyScan')
  })

  it('keeps the wanted and revoked lists filled with real, reserved people', () => {
    for (let day = 1; day <= 28; day++) {
      const ctx = contextForDay(state, day)
      if (day >= 3) {
        expect(ctx.bulletin.wanted.length).toBeGreaterThanOrEqual(3)
        for (const w of ctx.bulletin.wanted) expect(state.world.reserved[w.personId]).toBe('wanted')
      } else {
        expect(ctx.bulletin.wanted).toEqual([])
      }
      if (day >= 2) {
        expect(ctx.bulletin.revoked.length).toBeGreaterThanOrEqual(3)
        for (const n of ctx.bulletin.revoked)
          expect(state.world.registry[n]?.status).toBe('revoked')
      }
    }
  })

  it('rotates rules after day 7 and gives seal changes a grace day', () => {
    let changes = 0
    for (let seed = 1; seed <= 10; seed++) {
      const s = createNewGame({ seed, difficulty: 'hard' })
      for (const day of s.schedule.days) {
        if (day.dayIndex > 7) changes += day.changes.length
        for (const authority of ROTATING_AUTHORITIES) {
          const gens = day.sealGenerations[authority]
          expect(gens.length).toBeLessThanOrEqual(2)
          if (gens.length === 2) expect(gens[0]).toBe((gens[1] as number) + 1)
        }
        const ctx = contextForDay(s, day.dayIndex)
        expect(ctx.bulletin.rules.length).toBe(ctx.rules.length)
        expect(day.headline.length).toBeGreaterThan(0)
      }
    }
    expect(changes).toBeGreaterThan(50)
  })

  it('never closes the border to Velmark or lists Velmark for health checks', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createNewGame({ seed, difficulty: 'hard' })
      for (const day of s.schedule.days) {
        for (const rule of day.rules) expect(rule.countries).not.toContain('velmark')
      }
    }
  })

  it('creates shorter schedules for easier difficulties', () => {
    expect(createNewGame({ seed: 1, difficulty: 'easy' }).schedule.days.length).toBe(7)
    expect(createNewGame({ seed: 1, difficulty: 'normal' }).schedule.days.length).toBe(14)
  })

  it('dates days consecutively', () => {
    expect(contextForDay(state, 2).date).toBe(addDays(contextForDay(state, 1).date, 1))
  })
})
