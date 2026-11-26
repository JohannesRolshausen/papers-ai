// Rules, the day-by-day rule schedule and the morning bulletin.
// Days 1 to 6 introduce rules in a fixed order. From day 7 rules rotate from a pool.

import type { ToolId } from '../config'
import {
  HEALTH_CERT_MAX_AGE_YEARS,
  PERMIT_MAX_DAYS,
  TOLERANCE,
  TOOL_UNLOCK_DAY,
  TOOL_IDS,
  applicantsForDay,
  infiltratorCapForDay,
} from '../config'
import type { IsoDate } from './dates'
import { addDays, dateForDay, formatDocDate } from './dates'
import type { DocType } from './documents'
import { generatePerson, issuePassport } from './people'
import type { Rng } from './rng'
import { rngFor } from './rng'
import type { AuthorityId, SealSpec } from './seals'
import { ALL_AUTHORITIES, AUTHORITY_NAMES, BASE_SEALS, rotatedSeal } from './seals'
import type { Bulletin, DayContext, WantedEntry, WorldState } from './types'
import type { CountryId } from './world'
import { COUNTRIES, FOREIGN_COUNTRY_IDS, REQUIRED_VACCINE, countryName } from './world'

export const RULE_IDS = [
  'passport_required',
  'documents_authentic',
  'identity_match',
  'entry_permit_required',
  'revoked_list',
  'wanted_list',
  'citizen_id_required',
  'contraband_banned',
  'work_pass_required',
  'health_cert_required',
  'diplomatic_exemption',
  'border_closed',
] as const
export type RuleId = (typeof RULE_IDS)[number]

export interface ActiveRule {
  id: RuleId
  // Used by health_cert_required and border_closed, empty otherwise
  countries: CountryId[]
}

export type RotatingAuthority = 'ministry' | 'labour' | 'health'
export const ROTATING_AUTHORITIES: readonly RotatingAuthority[] = ['ministry', 'labour', 'health']

export interface DaySchedule {
  dayIndex: number
  date: IsoDate
  rules: ActiveRule[]
  changes: string[]
  headline: string
  // Valid seal generations per rotating authority, current design first
  sealGenerations: Record<RotatingAuthority, number[]>
  wantedIds: string[]
  revoked: string[]
  newTools: ToolId[]
  newDocuments: DocType[]
}

export interface Schedule {
  daysTotal: number
  days: DaySchedule[]
  wantedReasons: Record<string, string>
}

// ---------- Rule text ----------

function countryList(countries: readonly CountryId[]): string {
  return countries.map(countryName).join(', ')
}

export function ruleText(rule: ActiveRule): string {
  switch (rule.id) {
    case 'passport_required':
      return `Every entrant must present a valid passport. A passport is valid for exactly 10 years from its issue date and must not be expired today. The issuing city must belong to the passport's country. Height may differ by at most ${TOLERANCE.heightCm} cm and weight by at most ${TOLERANCE.weightKg} kg.`
    case 'documents_authentic':
      return 'All documents must be genuine and carry the current seal of the issuing authority. Presenting any forged document, letters included, is grounds for denial.'
    case 'identity_match':
      return 'The entrant must be the person named in the documents. The passport photo must show the entrant. Hairstyle, beard, glasses and hats may differ from the photo.'
    case 'entry_permit_required':
      return `Foreigners need an entry permit. Name and passport number must match the passport, and the permit must be valid today. Maximum duration: transit ${PERMIT_MAX_DAYS.transit} days, visit ${PERMIT_MAX_DAYS.visit} days, work ${PERMIT_MAX_DAYS.work} days. The stated purpose must be the real purpose of the trip.`
    case 'revoked_list':
      return "Passports whose numbers appear on today's revoked list must be denied."
    case 'wanted_list':
      return "Persons on today's wanted list must be denied."
    case 'citizen_id_required':
      return 'Velmarkan citizens must also present their identity card. Name and date of birth must match the passport, the card must be valid today and the district must be a Velmark district.'
    case 'contraband_banned':
      return 'Entrants carrying contraband must be denied.'
    case 'work_pass_required':
      return 'Foreigners entering to work need a work pass. Name and passport number must match the passport and the pass must be valid today.'
    case 'health_cert_required':
      return `Entrants from ${countryList(rule.countries)} need a health certificate for vaccine ${REQUIRED_VACCINE}, given within the last ${HEALTH_CERT_MAX_AGE_YEARS} years. Name and passport number must match the passport. A certificate cannot be issued before the vaccination date.`
    case 'diplomatic_exemption':
      return 'Diplomats with a diplomatic authorization that grants access to Velmark do not need an entry permit. Name and passport number must match the passport.'
    case 'border_closed':
      return `The border is closed to citizens of ${countryList(rule.countries)}.`
  }
}

export function ruleTitle(id: RuleId): string {
  const titles: Record<RuleId, string> = {
    passport_required: 'Passports',
    documents_authentic: 'Authentic documents',
    identity_match: 'Identity',
    entry_permit_required: 'Entry permits',
    revoked_list: 'Revoked passports',
    wanted_list: 'Wanted persons',
    citizen_id_required: 'Citizens',
    contraband_banned: 'Contraband',
    work_pass_required: 'Work passes',
    health_cert_required: 'Health certificates',
    diplomatic_exemption: 'Diplomats',
    border_closed: 'Border closures',
  }
  return titles[id]
}

export function hasRule(rules: readonly ActiveRule[], id: RuleId): boolean {
  return rules.some((r) => r.id === id)
}

export function getRule(rules: readonly ActiveRule[], id: RuleId): ActiveRule | undefined {
  return rules.find((r) => r.id === id)
}

// ---------- Schedule generation ----------

const FIXED_INTRO: Record<number, { rules: ActiveRule[]; docs: DocType[]; headline: string }> = {
  1: {
    rules: [
      { id: 'passport_required', countries: [] },
      { id: 'documents_authentic', countries: [] },
      { id: 'identity_match', countries: [] },
    ],
    docs: ['passport'],
    headline: 'Checkpoint Seven reopens. Check every passport.',
  },
  2: {
    rules: [
      { id: 'entry_permit_required', countries: [] },
      { id: 'revoked_list', countries: [] },
    ],
    docs: ['entryPermit'],
    headline: 'Foreigners now need entry permits. Revoked passports listed below.',
  },
  3: {
    rules: [
      { id: 'wanted_list', countries: [] },
      { id: 'citizen_id_required', countries: [] },
      { id: 'contraband_banned', countries: [] },
    ],
    docs: ['idCard', 'letter'],
    headline: 'Wanted list in force. Citizens must carry their identity card.',
  },
  4: {
    rules: [{ id: 'work_pass_required', countries: [] }],
    docs: ['workPass'],
    headline: 'Labour Office issues work passes. No pass, no work.',
  },
  5: {
    rules: [{ id: 'health_cert_required', countries: ['kelmar'] }],
    docs: ['healthCert'],
    headline: 'Marsh fever outbreak in Kelmar. Health certificates required.',
  },
  6: {
    rules: [{ id: 'diplomatic_exemption', countries: [] }],
    docs: ['diplomaticAuth'],
    headline: 'Diplomatic authorizations are now accepted.',
  },
}

const WANTED_REASONS = [
  'Arms trafficking',
  'Escaped custody',
  'Document fraud',
  'Espionage',
  'Armed robbery',
  'Smuggling network',
  'Sabotage of rail lines',
]

type RotationEvent =
  'border_closed' | 'border_reopened' | 'outbreak' | 'outbreak_over' | 'seal_rotation'

interface RotationState {
  closed: { country: CountryId; since: number }[]
  health: { country: CountryId; since: number }[]
  sealGen: Record<RotatingAuthority, number>
  sealRotatedOn: Record<RotatingAuthority, number>
}

export function createSchedule(seed: number, daysTotal: number, world: WorldState): Schedule {
  const days: DaySchedule[] = []
  const wantedReasons: Record<string, string> = {}
  const base: ActiveRule[] = []
  const state: RotationState = {
    closed: [],
    health: [],
    sealGen: { ministry: 0, labour: 0, health: 0 },
    sealRotatedOn: { ministry: -99, labour: -99, health: -99 },
  }
  let wanted: string[] = []
  let revoked: string[] = []

  for (let dayIndex = 1; dayIndex <= daysTotal; dayIndex++) {
    const rng = rngFor(seed, 'schedule', dayIndex)
    const date = dateForDay(dayIndex)
    const changes: string[] = []
    const intro = FIXED_INTRO[dayIndex]
    let headline = intro?.headline ?? ''

    if (intro) {
      for (const rule of intro.rules) {
        if (rule.id === 'health_cert_required') {
          for (const c of rule.countries) state.health.push({ country: c, since: dayIndex })
        } else {
          base.push(rule)
        }
        changes.push(`NEW RULE: ${ruleTitle(rule.id)}.`)
      }
    }

    if (dayIndex === 7) {
      const country = rng.pick(FOREIGN_COUNTRY_IDS.filter((c) => c !== 'kelmar'))
      state.closed.push({ country, since: dayIndex })
      changes.push(`The border to ${countryName(country)} is CLOSED until further notice.`)
      headline = `Border to ${countryName(country)} closed.`
    } else if (dayIndex > 7) {
      const eventCount = rng.chance(0.55) ? (rng.chance(0.25) ? 2 : 1) : 0
      for (let i = 0; i < eventCount; i++) {
        const event = pickRotationEvent(rng, state, dayIndex)
        if (!event) break
        const text = applyRotationEvent(rng, state, event, dayIndex, date)
        changes.push(text)
        if (!headline) headline = text
      }
    }

    // Wanted list from day 3: three to four names, one or two replaced per day
    if (dayIndex >= 3) {
      const keep =
        dayIndex === 3 ? [] : rng.sample(wanted, Math.max(0, wanted.length - rng.int(1, 2)))
      const target = rng.int(3, 4)
      const fresh: string[] = []
      while (keep.length + fresh.length < target) {
        const person = generatePerson(world, rng, {
          date,
          nationality: rng.chance(0.2) ? 'velmark' : rng.pick(FOREIGN_COUNTRY_IDS),
          reserve: 'wanted',
        })
        issuePassport(world, rng, person, date)
        wantedReasons[person.personId] = rng.pick(WANTED_REASONS)
        fresh.push(person.personId)
      }
      wanted = [...keep, ...fresh]
    }

    // Revoked passports from day 2: foreigners only, three to four numbers
    if (dayIndex >= 2) {
      const keep =
        dayIndex === 2 ? [] : rng.sample(revoked, Math.max(0, revoked.length - rng.int(1, 2)))
      const target = rng.int(3, 4)
      const fresh: string[] = []
      while (keep.length + fresh.length < target) {
        const person = generatePerson(world, rng, { date, reserve: 'revoked' })
        const passport = issuePassport(world, rng, person, date, { status: 'revoked' })
        fresh.push(passport.number)
      }
      revoked = [...keep, ...fresh]
    }

    const rules: ActiveRule[] = [...base]
    if (state.health.length > 0) {
      rules.push({ id: 'health_cert_required', countries: state.health.map((h) => h.country) })
    }
    if (state.closed.length > 0) {
      rules.push({ id: 'border_closed', countries: state.closed.map((c) => c.country) })
    }

    const sealGenerations = {} as Record<RotatingAuthority, number[]>
    for (const authority of ROTATING_AUTHORITIES) {
      const gen = state.sealGen[authority]
      const inGrace = gen > 0 && dayIndex - state.sealRotatedOn[authority] <= 1
      sealGenerations[authority] = inGrace ? [gen, gen - 1] : [gen]
    }

    const newTools = TOOL_IDS.filter((tool) => TOOL_UNLOCK_DAY[tool] === dayIndex)
    if (!headline) headline = 'No changes today. Stay alert.'

    days.push({
      dayIndex,
      date,
      rules,
      changes,
      headline,
      sealGenerations,
      wantedIds: wanted,
      revoked,
      newTools,
      newDocuments: intro?.docs ?? [],
    })
  }

  return { daysTotal, days, wantedReasons }
}

function pickRotationEvent(rng: Rng, state: RotationState, dayIndex: number): RotationEvent | null {
  const options: { value: RotationEvent; weight: number }[] = []
  const openForeign = FOREIGN_COUNTRY_IDS.filter((c) => !state.closed.some((x) => x.country === c))
  if (state.closed.length < 2 && openForeign.length > 0)
    options.push({ value: 'border_closed', weight: 2 })
  if (state.closed.some((c) => dayIndex - c.since >= 3))
    options.push({ value: 'border_reopened', weight: 1.5 })
  if (state.health.length < 3) options.push({ value: 'outbreak', weight: 1.5 })
  if (state.health.some((h) => dayIndex - h.since >= 4))
    options.push({ value: 'outbreak_over', weight: 1 })
  if (ROTATING_AUTHORITIES.some((a) => dayIndex - state.sealRotatedOn[a] >= 5)) {
    options.push({ value: 'seal_rotation', weight: 1.5 })
  }
  if (options.length === 0) return null
  return rng.pickWeighted(options)
}

function applyRotationEvent(
  rng: Rng,
  state: RotationState,
  event: RotationEvent,
  dayIndex: number,
  date: IsoDate,
): string {
  switch (event) {
    case 'border_closed': {
      const country = rng.pick(
        FOREIGN_COUNTRY_IDS.filter((c) => !state.closed.some((x) => x.country === c)),
      )
      state.closed.push({ country, since: dayIndex })
      return `The border to ${countryName(country)} is CLOSED until further notice.`
    }
    case 'border_reopened': {
      const entry = rng.pick(state.closed.filter((c) => dayIndex - c.since >= 3))
      state.closed = state.closed.filter((c) => c !== entry)
      return `The border to ${countryName(entry.country)} is OPEN again.`
    }
    case 'outbreak': {
      const candidates = FOREIGN_COUNTRY_IDS.filter(
        (c) => !state.health.some((h) => h.country === c),
      )
      const country = rng.pick(candidates)
      state.health.push({ country, since: dayIndex })
      return `Marsh fever reported in ${countryName(country)}. Health certificates now required for its citizens.`
    }
    case 'outbreak_over': {
      const entry = rng.pick(state.health.filter((h) => dayIndex - h.since >= 4))
      state.health = state.health.filter((h) => h !== entry)
      return `The outbreak in ${countryName(entry.country)} is over. No health certificate needed for its citizens.`
    }
    case 'seal_rotation': {
      const authority = rng.pick(
        ROTATING_AUTHORITIES.filter((a) => dayIndex - state.sealRotatedOn[a] >= 5),
      )
      state.sealGen[authority] += 1
      state.sealRotatedOn[authority] = dayIndex
      return `New seal design for the ${AUTHORITY_NAMES[authority]}. The old seal is accepted until ${formatDocDate(addDays(date, 1))}.`
    }
  }
}

// ---------- Day context ----------

export function validSealsFor(day: DaySchedule): Record<AuthorityId, SealSpec[]> {
  const result = {} as Record<AuthorityId, SealSpec[]>
  for (const authority of ALL_AUTHORITIES) {
    if ((ROTATING_AUTHORITIES as readonly string[]).includes(authority)) {
      const gens = day.sealGenerations[authority as RotatingAuthority]
      result[authority] = gens.map((g) => rotatedSeal(BASE_SEALS[authority], g))
    } else {
      result[authority] = [BASE_SEALS[authority]]
    }
  }
  return result
}

export function buildDayContext(
  schedule: Schedule,
  world: WorldState,
  dayIndex: number,
): DayContext {
  const day = schedule.days[dayIndex - 1]
  if (!day) throw new Error(`No schedule for day ${dayIndex}`)
  const wanted: WantedEntry[] = day.wantedIds.map((personId) => {
    const person = world.persons[personId]
    if (!person) throw new Error(`Unknown wanted person ${personId}`)
    return {
      id: `wanted-${personId}`,
      personId,
      surname: person.surname,
      given: person.given,
      nationality: person.nationality,
      face: person.face,
      reason: schedule.wantedReasons[personId] ?? 'Wanted',
    }
  })
  const bulletin: Bulletin = {
    dayIndex,
    date: day.date,
    headline: day.headline,
    changes: day.changes,
    rules: day.rules.map((rule) => ({ id: rule.id, text: ruleText(rule) })),
    wanted,
    revoked: day.revoked,
    newTools: day.newTools,
    newDocuments: day.newDocuments,
  }
  const applicantCount = applicantsForDay(dayIndex)
  return {
    dayIndex,
    date: day.date,
    daysTotal: schedule.daysTotal,
    rules: day.rules,
    bulletin,
    validSeals: validSealsFor(day),
    tools: TOOL_IDS.filter((tool) => TOOL_UNLOCK_DAY[tool] <= dayIndex),
    applicantCount,
    infiltratorCap: infiltratorCapForDay(applicantCount),
  }
}

export function closedCountries(ctx: DayContext): CountryId[] {
  return getRule(ctx.rules, 'border_closed')?.countries ?? []
}

export function healthCountries(ctx: DayContext): CountryId[] {
  return getRule(ctx.rules, 'health_cert_required')?.countries ?? []
}

export function countryCities(country: CountryId): readonly string[] {
  return COUNTRIES[country].cities
}
