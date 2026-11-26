// Turns a checked DayPlan into concrete applicants.
// Fairness guarantee: every technique leaves at least one piece of evidence that a tool can find,
// and legit travelers always carry valid papers. The validator decides the final truth.

import type {
  AlterField,
  ApplicantPlan,
  BaseProblemId,
  DayPlan,
  DocTarget,
  FlawType,
  LegitQuirk,
  TechniquePlan,
} from '../ai/schema'
import { TECHNIQUES } from '../ai/schema'
import { PERMIT_MAX_DAYS, TOLERANCE } from '../config'
import { addDays, addYears, formatDocDate, isBefore, yearOf } from './dates'
import type {
  DiplomaticAuth,
  DocType,
  EntryPermit,
  GameDocument,
  HealthCert,
  Passport,
  Purpose,
  WorkPass,
} from './documents'
import { alterOneCharacter, displayName, misspell, newDocNumber } from './documents'
import type { FaceSpec } from './faces'
import { disguise, everydayLook, lookAlike, photoOf } from './faces'
import {
  currentSeal,
  generatePerson,
  issueDiplomaticAuth,
  issueHealthCert,
  issueIdCard,
  issuePassport,
  issuePermit,
  issueWorkPass,
  makeLetter,
  nextId,
  passportFor,
  registryLookup,
} from './people'
import type { Rng } from './rng'
import { rngFor } from './rng'
import { closedCountries, hasRule, healthCountries } from './rules'
import { BASE_SEALS, forgeSealVariant, passportAuthority } from './seals'
import type {
  Applicant,
  AppliedTechnique,
  DayContext,
  HiddenItem,
  LuggageItem,
  PersonTruth,
  RecurringCharacter,
  WorldState,
} from './types'
import { validateApplicant } from './validator'
import type { CountryId } from './world'
import {
  COMMON_LUGGAGE,
  CONTRABAND,
  COUNTRIES,
  COUNTRY_IDS,
  EMPLOYERS,
  FAKE_CITIES,
  FOREIGN_COUNTRY_IDS,
  HOME_COUNTRY,
  countryName,
} from './world'

interface DayTracker {
  usedPersons: Set<string>
}

interface Build {
  truth: PersonTruth
  docs: GameDocument[]
  face: FaceSpec
  height: number
  weight: number
  luggage: LuggageItem[]
  hidden: HiddenItem[]
  techniques: AppliedTechnique[]
  notes: string[]
  characterId: string | null
  baseProblem: BaseProblemId | null
}

export function materializeDay(plan: DayPlan, ctx: DayContext, world: WorldState): Applicant[] {
  const tracker: DayTracker = { usedPersons: new Set() }
  return plan.applicants.map((entry, slot) => {
    const rng = rngFor(world.seed, 'materialize', ctx.dayIndex, slot)
    return materializeApplicant(entry, slot, ctx, world, rng, tracker)
  })
}

export function materializeApplicant(
  entry: ApplicantPlan,
  slot: number,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  tracker: DayTracker = { usedPersons: new Set() },
): Applicant {
  const id = `d${ctx.dayIndex}-s${slot + 1}`
  const build =
    entry.kind === 'infiltrator' && entry.base_problem
      ? buildInfiltrator(entry, entry.base_problem, ctx, world, rng, tracker)
      : buildLegit(entry, ctx, world, rng, tracker)

  if (entry.letter && !build.docs.some((d) => d.type === 'letter')) {
    build.docs.push(
      makeLetter(
        world,
        {
          title: entry.letter.title,
          sender: entry.letter.sender,
          body: entry.letter.body,
          claimsExemption: entry.letter.claims_exemption,
        },
        true,
        null,
      ),
    )
  }

  const characterId = registerCharacter(entry, build, id, ctx, world)
  const applicant: Applicant = {
    id,
    day: ctx.dayIndex,
    slot,
    kind: entry.kind,
    baseProblem: build.baseProblem,
    personId: build.truth.personId,
    characterId,
    appearance: {
      face: build.face,
      height: build.height,
      weight: build.weight,
      luggage: build.luggage,
    },
    documents: build.docs,
    hidden: build.hidden,
    plan: entry,
    techniques: build.techniques,
    notes: build.notes,
    violations: [],
    admissible: true,
  }
  applicant.violations = validateApplicant(applicant, ctx, world)
  applicant.admissible = applicant.violations.length === 0
  if (entry.kind === 'legit' && !applicant.admissible) {
    applicant.notes.push(
      `ENGINE WARNING: legit traveler has violations (${applicant.violations.map((v) => v.code).join(', ')}).`,
    )
  }
  if (entry.kind === 'infiltrator' && applicant.admissible) {
    applicant.notes.push('ENGINE WARNING: infiltrator ended up with valid papers.')
  }
  return applicant
}

// ---------- People ----------

interface TravelerOptions {
  nationality?: CountryId | null
  purpose?: Purpose | null
  allowCitizen: boolean
  require?: readonly CountryId[]
  forbid?: readonly CountryId[]
  diplomat?: boolean
  face?: FaceSpec
  sex?: 'M' | 'F'
  height?: number
}

function newTraveler(
  world: WorldState,
  rng: Rng,
  ctx: DayContext,
  opts: TravelerOptions,
): PersonTruth {
  const forbid = new Set(opts.forbid ?? [])
  let candidates: CountryId[]
  if (opts.require && opts.require.length > 0) {
    candidates = [...opts.require]
  } else {
    candidates = (opts.allowCitizen ? COUNTRY_IDS : FOREIGN_COUNTRY_IDS).filter(
      (c) => !forbid.has(c),
    )
    if (candidates.length === 0) candidates = [...FOREIGN_COUNTRY_IDS]
  }
  let nationality: CountryId
  if (opts.nationality && candidates.includes(opts.nationality)) {
    nationality = opts.nationality
  } else if (opts.allowCitizen && candidates.includes(HOME_COUNTRY) && !opts.require) {
    nationality = rng.chance(0.2)
      ? HOME_COUNTRY
      : rng.pick(
          candidates.filter((c) => c !== HOME_COUNTRY).length > 0
            ? candidates.filter((c) => c !== HOME_COUNTRY)
            : candidates,
        )
  } else {
    nationality = rng.pick(candidates)
  }
  let purpose: Purpose | undefined
  if (nationality === HOME_COUNTRY) purpose = 'visit'
  else if (opts.diplomat) purpose = 'visit'
  else if (opts.purpose) purpose = opts.purpose
  else if (!hasRule(ctx.rules, 'entry_permit_required'))
    purpose = rng.pick(['visit', 'work', 'transit'])
  return generatePerson(world, rng, {
    date: ctx.date,
    nationality,
    purpose,
    diplomat: opts.diplomat ?? false,
    face: opts.face,
    sex: opts.sex,
    height: opts.height,
  })
}

function ensureWorker(person: PersonTruth, rng: Rng): void {
  person.purpose = 'work'
  if (!person.employer) {
    person.employer = rng.pick(EMPLOYERS)
    person.occupation = person.employer.field
  }
  if (person.durationDays < 60) person.durationDays = rng.pick([90, 180, 270, 365])
}

// ---------- Genuine paperwork ----------

interface LegitDocOptions {
  passport?: Passport
  omit?: ReadonlySet<DocType>
  permitPurpose?: Purpose
  permitValidUntil?: string
  diplomat?: boolean
}

function issueLegitDocs(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  ctx: DayContext,
  opts: LegitDocOptions = {},
): GameDocument[] {
  const omit = opts.omit ?? new Set<DocType>()
  const passport = opts.passport ?? passportFor(world, rng, person, ctx.date)
  const docs: GameDocument[] = [passport]
  const foreign = passport.country !== HOME_COUNTRY
  const purpose = opts.permitPurpose ?? person.purpose
  const diplomat =
    (opts.diplomat ?? person.isDiplomat) && hasRule(ctx.rules, 'diplomatic_exemption')
  if (foreign && hasRule(ctx.rules, 'entry_permit_required')) {
    if (diplomat) {
      docs.push(issueDiplomaticAuth(world, rng, person, passport, ctx))
    } else if (!omit.has('entryPermit')) {
      docs.push(
        issuePermit(world, rng, person, passport, ctx, {
          purpose,
          validUntil: opts.permitValidUntil,
        }),
      )
    }
  }
  if (
    foreign &&
    !diplomat &&
    hasRule(ctx.rules, 'work_pass_required') &&
    purpose === 'work' &&
    !omit.has('workPass')
  ) {
    docs.push(issueWorkPass(world, rng, person, passport, ctx))
  }
  if (healthCountries(ctx).includes(passport.country) && !omit.has('healthCert')) {
    docs.push(issueHealthCert(world, rng, person, passport, ctx))
  }
  if (!foreign && hasRule(ctx.rules, 'citizen_id_required') && !omit.has('idCard')) {
    docs.push(issueIdCard(world, rng, person, ctx))
  }
  return docs
}

function luggageFor(rng: Rng, person: PersonTruth, showTools: boolean): LuggageItem[] {
  const items: LuggageItem[] = person.isDiplomat
    ? [{ label: 'diplomatic pouch', revealsPurpose: null }]
    : [{ label: rng.pick(COMMON_LUGGAGE), revealsPurpose: null }]
  if (showTools && person.employer)
    items.push({ label: person.employer.tools, revealsPurpose: 'work' })
  return items
}

function weightNear(rng: Rng, passportWeight: number): number {
  return passportWeight + rng.int(-2, 2)
}

// ---------- Legit travelers ----------

function buildLegit(
  entry: ApplicantPlan,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  tracker: DayTracker,
): Build {
  const notes: string[] = []
  const quirk: LegitQuirk = entry.legit_quirk
  const closed = closedCountries(ctx)
  let person: PersonTruth | null = null
  let characterId: string | null = null

  if (entry.recurring.mode === 'reuse' && entry.recurring.character_id) {
    const character = world.characters[entry.recurring.character_id]
    const candidate = character ? world.persons[character.personId] : undefined
    const blocked =
      candidate !== undefined &&
      (world.reserved[candidate.personId] === 'wanted' ||
        world.reserved[candidate.personId] === 'revoked' ||
        ctx.bulletin.wanted.some((w) => w.personId === candidate.personId))
    if (
      character &&
      candidate &&
      !blocked &&
      !closed.includes(candidate.nationality) &&
      !tracker.usedPersons.has(candidate.personId)
    ) {
      person = candidate
      characterId = character.id
    } else {
      notes.push(
        `Character ${entry.recurring.character_id} could not return today, a new person came instead.`,
      )
    }
  }

  if (!person) {
    person = newTraveler(world, rng, ctx, {
      nationality: quirk === 'returning_citizen' ? HOME_COUNTRY : entry.nationality,
      purpose:
        quirk === 'transit' ? 'transit' : quirk === 'long_work_stay' ? 'work' : entry.purpose,
      allowCitizen:
        quirk !== 'diplomat' &&
        quirk !== 'transit' &&
        quirk !== 'long_work_stay' &&
        quirk !== 'permit_expires_today',
      forbid: closed,
      diplomat: quirk === 'diplomat',
    })
    if (entry.nationality && closed.includes(entry.nationality)) {
      notes.push(
        `${countryName(entry.nationality)} is closed today, so the traveler is from ${countryName(person.nationality)}.`,
      )
    }
  }
  tracker.usedPersons.add(person.personId)

  if (quirk === 'long_work_stay' && person.nationality !== HOME_COUNTRY) {
    ensureWorker(person, rng)
    person.durationDays = PERMIT_MAX_DAYS.work
  } else if (quirk === 'transit' && person.nationality !== HOME_COUNTRY) {
    person.purpose = 'transit'
    person.durationDays = rng.int(1, PERMIT_MAX_DAYS.transit)
  } else if (person.purpose === 'work') {
    ensureWorker(person, rng)
  }

  let passport: Passport | undefined
  if (quirk === 'passport_expires_today') {
    passport = issuePassport(world, rng, person, ctx.date, { expires: ctx.date })
  }
  const docs = issueLegitDocs(world, rng, person, ctx, {
    passport,
    permitValidUntil: quirk === 'permit_expires_today' ? ctx.date : undefined,
  })
  const presented = docs[0] as Passport

  let face = everydayLook(person.face, rng)
  if (quirk === 'new_look') face = disguise(person.face, rng)
  let weight = weightNear(rng, presented.weight)
  if (quirk === 'weight_change') {
    weight =
      presented.weight +
      (rng.chance(0.5) ? 1 : -1) * rng.int(TOLERANCE.weightKg - 1, TOLERANCE.weightKg)
  }

  return {
    truth: person,
    docs,
    face,
    height: person.height,
    weight,
    luggage: luggageFor(rng, person, person.purpose === 'work' && rng.chance(0.5)),
    hidden: [],
    techniques: [],
    notes,
    characterId,
    baseProblem: null,
  }
}

// ---------- Infiltrators ----------

function pickTruePerson(
  entry: ApplicantPlan,
  base: BaseProblemId,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  tracker: DayTracker,
  notes: string[],
): { person: PersonTruth; base: BaseProblemId; characterId: string | null } {
  const closed = closedCountries(ctx)
  const health = healthCountries(ctx)
  const mode = entry.recurring.mode
  const character = entry.recurring.character_id
    ? world.characters[entry.recurring.character_id]
    : undefined

  // A returning character turns bad
  if (mode === 'reuse' && character) {
    const person = world.persons[character.personId]
    if (person && !tracker.usedPersons.has(person.personId)) {
      const foreign = person.nationality !== HOME_COUNTRY
      const fits =
        (base === 'banned_nationality' && closed.includes(person.nationality)) ||
        (base === 'missing_health_cert' && health.includes(person.nationality)) ||
        (base === 'smuggler' && !closed.includes(person.nationality)) ||
        ((base === 'no_permit' || base === 'wrong_purpose' || base === 'missing_work_pass') &&
          foreign &&
          !closed.includes(person.nationality))
      if (fits) return { person, base, characterId: character.id }
    }
    notes.push(`Character ${character.id} does not fit ${base} today, a new person came instead.`)
  }

  // A stranger who looks like a character
  const imitated =
    mode === 'impersonate' && character ? world.persons[character.personId] : undefined
  const lookOpts = imitated
    ? {
        face: lookAlike(imitated.face, rng),
        sex: imitated.sex,
        height:
          imitated.height +
          (rng.chance(0.5) ? 1 : -1) * rng.int(TOLERANCE.heightCm + 1, TOLERANCE.heightCm + 4),
      }
    : {}

  switch (base) {
    case 'wanted': {
      const entryW = ctx.bulletin.wanted.find((w) => !tracker.usedPersons.has(w.personId))
      const person = entryW ? world.persons[entryW.personId] : undefined
      if (person) return { person, base, characterId: null }
      notes.push(
        'Every wanted person was already used today, sent someone without a permit instead.',
      )
      return pickTruePerson(
        entry,
        hasRule(ctx.rules, 'entry_permit_required') ? 'no_permit' : 'expired_passport',
        ctx,
        world,
        rng,
        tracker,
        notes,
      )
    }
    case 'revoked_document': {
      for (const number of ctx.bulletin.revoked) {
        const holder = world.registry[number]?.holderId
        const person = holder ? world.persons[holder] : undefined
        if (
          person &&
          !tracker.usedPersons.has(person.personId) &&
          !closed.includes(person.nationality)
        ) {
          return { person, base, characterId: null }
        }
      }
      notes.push('No unused revoked passport holder today, sent someone without a permit instead.')
      return pickTruePerson(entry, 'no_permit', ctx, world, rng, tracker, notes)
    }
    case 'banned_nationality':
      return {
        person: newTraveler(world, rng, ctx, {
          ...lookOpts,
          nationality: entry.nationality,
          purpose: entry.purpose,
          allowCitizen: false,
          require: closed,
        }),
        base,
        characterId: null,
      }
    case 'missing_health_cert':
      return {
        person: newTraveler(world, rng, ctx, {
          ...lookOpts,
          nationality: entry.nationality,
          purpose: entry.purpose,
          allowCitizen: false,
          require:
            health.filter((c) => !closed.includes(c)).length > 0
              ? health.filter((c) => !closed.includes(c))
              : health,
        }),
        base,
        characterId: null,
      }
    case 'wrong_purpose':
    case 'missing_work_pass':
      return {
        person: newTraveler(world, rng, ctx, {
          ...lookOpts,
          nationality: entry.nationality,
          purpose: 'work',
          allowCitizen: false,
          forbid: closed,
        }),
        base,
        characterId: null,
      }
    case 'no_permit':
      return {
        person: newTraveler(world, rng, ctx, {
          ...lookOpts,
          nationality: entry.nationality,
          purpose: entry.purpose,
          allowCitizen: false,
          forbid: closed,
        }),
        base,
        characterId: null,
      }
    case 'expired_passport':
    case 'smuggler':
      return {
        person: newTraveler(world, rng, ctx, {
          ...lookOpts,
          nationality: entry.nationality,
          purpose: entry.purpose,
          allowCitizen: !imitated,
          forbid: closed,
        }),
        base,
        characterId: null,
      }
  }
}

function buildInfiltrator(
  entry: ApplicantPlan,
  requestedBase: BaseProblemId,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  tracker: DayTracker,
): Build {
  const notes: string[] = []
  const picked = pickTruePerson(entry, requestedBase, ctx, world, rng, tracker, notes)
  const person = picked.person
  const base = picked.base
  tracker.usedPersons.add(person.personId)
  const has = (type: TechniquePlan['type']) => entry.techniques.find((t) => t.type === type)
  const applied: AppliedTechnique[] = []
  const record = (t: TechniquePlan, note: string, target: string | null = null) => {
    applied.push({ type: t.type, target, cost: TECHNIQUES[t.type].cost, note })
  }

  if (base === 'wrong_purpose' || base === 'missing_work_pass') ensureWorker(person, rng)

  // ---------- Honest paperwork ----------
  let passport: Passport
  if (base === 'expired_passport') {
    passport = issuePassport(world, rng, person, ctx.date, {
      expires: addDays(ctx.date, -rng.int(1, 400)),
    })
  } else if (base === 'revoked_document') {
    passport = world.passports[person.personId] ?? passportFor(world, rng, person, ctx.date)
  } else {
    passport = passportFor(world, rng, person, ctx.date)
  }
  const omit = new Set<DocType>()
  if (base === 'no_permit') omit.add('entryPermit')
  if (base === 'missing_work_pass') omit.add('workPass')
  if (base === 'missing_health_cert') omit.add('healthCert')
  const honest = issueLegitDocs(world, rng, person, ctx, {
    passport,
    omit,
    permitPurpose: base === 'wrong_purpose' ? 'visit' : undefined,
    diplomat: false,
  })

  // ---------- Body, luggage, hidden items ----------
  const disguiseT = has('disguise')
  let face = everydayLook(person.face, rng)
  if (disguiseT) {
    face = disguise(person.face, rng)
    record(disguiseT, 'Changed hair, beard, glasses and hat.')
  }
  const hiddenT = has('hidden_item')
  const hidden: HiddenItem[] = []
  let luggage = luggageFor(rng, person, false)
  let weightBump = 0
  if (base === 'wrong_purpose' || base === 'missing_work_pass') {
    const employer =
      person.employer ?? (rng.pick(EMPLOYERS) as NonNullable<PersonTruth['employer']>)
    hidden.push({
      kind: 'document',
      label: `signed employment contract (${employer.name})`,
      revealsPurpose: 'work',
    })
    if (hiddenT) {
      hidden.push({ kind: 'tools', label: employer.tools, revealsPurpose: 'work' })
      record(hiddenT, `Hid the ${employer.tools} under clothing.`)
    } else {
      luggage = [...luggage, { label: employer.tools, revealsPurpose: 'work' }]
    }
  }
  if (base === 'smuggler') {
    const item = rng.pick(CONTRABAND)
    hidden.push({ kind: 'contraband', label: item, revealsPurpose: null })
    if (hiddenT) {
      record(hiddenT, `Concealed ${item} so the scale shows nothing.`)
    } else {
      weightBump = rng.int(TOLERANCE.weightKg + 2, TOLERANCE.weightKg + 5)
      notes.push(`Carries ${item} openly under the coat, adding ${weightBump} kg.`)
    }
  }

  // ---------- Primary technique ----------
  let docs = honest
  const height = person.height
  let presentedWeight = passport.weight
  const primary = entry.techniques.find((t) =>
    ['alter_field', 'forged_document', 'clean_forgery', 'borrowed_identity'].includes(t.type),
  )
  if (primary?.type === 'alter_field' && primary.field) {
    docs = applyAlteration(
      primary.field,
      primary.subtle,
      docs,
      person,
      ctx,
      world,
      rng,
      record.bind(null, primary),
    )
  } else if (
    (primary?.type === 'forged_document' || primary?.type === 'clean_forgery') &&
    primary.target_doc
  ) {
    const flaw = primary.type === 'forged_document' ? (primary.flaw ?? 'seal') : null
    docs = applyForgery(
      primary.target_doc,
      flaw,
      base,
      docs,
      person,
      face,
      ctx,
      world,
      rng,
      (note, target) => record(primary, note, target),
    )
  } else if (primary?.type === 'borrowed_identity') {
    const borrowed = borrowIdentity(entry, person, base, ctx, world, rng, tracker)
    docs = borrowed.docs
    presentedWeight = (docs[0] as Passport).weight
    record(primary, borrowed.note, 'passport')
  }

  // ---------- Fake letter ----------
  const letterT = has('fake_letter')
  if (letterT && entry.letter) {
    const ministry = currentSeal(ctx, 'ministry')
    const seal = letterT.subtle
      ? ministry
      : forgeSealVariant(ministry, rng, ctx.validSeals.ministry)
    docs = [
      ...docs,
      makeLetter(
        world,
        {
          title: entry.letter.title,
          sender: entry.letter.sender,
          body: entry.letter.body,
          claimsExemption: entry.letter.claims_exemption,
        },
        false,
        seal,
      ),
    ]
    record(
      letterT,
      letterT.subtle
        ? 'Forged letter with a valid-looking seal.'
        : 'Forged letter with a wrong seal.',
      'letter',
    )
  }

  return {
    truth: person,
    docs,
    face,
    height,
    weight: weightNear(rng, presentedWeight) + weightBump,
    luggage,
    hidden,
    techniques: applied,
    notes,
    characterId: picked.characterId,
    baseProblem: base,
  }
}

// ---------- Alterations ----------

function replaceDoc(
  docs: GameDocument[],
  oldDoc: GameDocument,
  newDoc: GameDocument,
): GameDocument[] {
  return docs.map((d) => (d === oldDoc ? newDoc : d))
}

function applyAlteration(
  field: AlterField,
  subtle: boolean,
  docs: GameDocument[],
  person: PersonTruth,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  record: (note: string, target: string | null) => void,
): GameDocument[] {
  const passport = docs.find((d): d is Passport => d.type === 'passport')
  if (!passport) return docs
  const copyPassport = (changes: Partial<Passport>, note: string): Passport => ({
    ...passport,
    ...changes,
    id: nextId(world, 'passport-'),
    provenance: 'altered',
    tamperNote: note,
  })
  switch (field) {
    case 'expires': {
      let expires = addDays(ctx.date, rng.int(200, 2500))
      if (subtle) {
        const year = yearOf(passport.expires)
        const decade = year - (year % 10)
        for (let d = 0; d <= 9; d++) {
          const candidate = addYears(passport.expires, decade + d - year)
          if (decade + d > year && !isBefore(candidate, addDays(ctx.date, 30))) {
            expires = candidate
            break
          }
        }
      }
      const note = `Expiry changed from ${formatDocDate(passport.expires)} to ${formatDocDate(expires)}.`
      record(note, 'passport')
      return replaceDoc(docs, passport, copyPassport({ expires }, note))
    }
    case 'surname': {
      const pool = COUNTRIES[passport.country].surnames.filter((s) => s !== passport.surname)
      const surname = subtle || pool.length === 0 ? misspell(rng, passport.surname) : rng.pick(pool)
      const note = `Surname changed from ${passport.surname} to ${surname}.`
      record(note, 'passport')
      return replaceDoc(docs, passport, copyPassport({ surname }, note))
    }
    case 'number': {
      const number = alterOneCharacter(rng, passport.number, registryLookup(world))
      const note = `Passport number changed from ${passport.number} to ${number}.`
      record(note, 'passport')
      return replaceDoc(docs, passport, copyPassport({ number }, note))
    }
    case 'country': {
      const options = FOREIGN_COUNTRY_IDS.filter(
        (c) =>
          c !== passport.country &&
          !closedCountries(ctx).includes(c) &&
          !healthCountries(ctx).includes(c),
      )
      const country =
        options.length > 0
          ? rng.pick(options)
          : rng.pick(FOREIGN_COUNTRY_IDS.filter((c) => c !== passport.country))
      const note = `Nationality changed from ${countryName(passport.country)} to ${countryName(country)}. Issuing city and seal still belong to ${countryName(passport.country)}.`
      record(note, 'passport')
      return replaceDoc(docs, passport, copyPassport({ country }, note))
    }
    case 'purpose': {
      const permit = docs.find((d): d is EntryPermit => d.type === 'entryPermit')
      if (!permit) return docs
      const note = `Permit purpose changed from ${permit.purpose} to visit.`
      record(note, 'entryPermit')
      return replaceDoc(docs, permit, {
        ...permit,
        id: nextId(world, 'entryPermit-'),
        purpose: 'visit',
        provenance: 'altered',
        tamperNote: note,
      })
    }
  }
}

// ---------- Forgeries ----------

function forgedPassportFor(
  base: BaseProblemId,
  passport: Passport,
  person: PersonTruth,
  face: FaceSpec,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
): { passport: Passport; note: string } {
  let country = passport.country
  let surname = passport.surname
  let given = passport.given
  let dob = passport.dob
  let note = 'Forged replacement passport.'
  if (base === 'banned_nationality') {
    const options = FOREIGN_COUNTRY_IDS.filter(
      (c) =>
        c !== person.nationality &&
        !closedCountries(ctx).includes(c) &&
        !healthCountries(ctx).includes(c),
    )
    country =
      options.length > 0
        ? rng.pick(options)
        : rng.pick(
            FOREIGN_COUNTRY_IDS.filter(
              (c) => c !== person.nationality && !closedCountries(ctx).includes(c),
            ),
          )
    note = `Forged ${countryName(country)} passport for a citizen of ${countryName(person.nationality)}.`
  }
  if (base === 'wanted') {
    const pool = COUNTRIES[country]
    surname = rng.pick(pool.surnames.filter((s) => s !== person.surname))
    given = rng.pick(pool.given[person.sex].filter((g) => g !== person.given))
    dob = addDays(dob, rng.int(-900, 900))
    note = `Forged passport under the false name ${displayName({ surname, given })}.`
  }
  const expires = addDays(ctx.date, rng.int(200, 8 * 365))
  const forged: Passport = {
    ...passport,
    id: nextId(world, 'passport-'),
    provenance: 'forged',
    tamperNote: note,
    number: newDocNumber(rng, 'passport', registryLookup(world), country),
    surname,
    given,
    dob,
    country,
    issuingCity: rng.pick(COUNTRIES[country].cities),
    expires,
    issued: addYears(expires, -10),
    height: person.height,
    weight: person.weight,
    photo: photoOf(face),
    seal: BASE_SEALS[passportAuthority(country)],
  }
  return { passport: forged, note }
}

// Rebuild supporting documents so they match a forged passport. Support forgeries have no visible flaw.
function alignSupportDocs(
  docs: GameDocument[],
  forgedPassport: Passport,
  person: PersonTruth,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
): GameDocument[] {
  const foreign = forgedPassport.country !== HOME_COUNTRY
  const result: GameDocument[] = [forgedPassport]
  for (const doc of docs) {
    if (doc.type === 'passport' || doc.type === 'letter') {
      if (doc.type === 'letter') result.push(doc)
      continue
    }
    if (doc.type === 'idCard') {
      if (foreign) continue
      if (
        doc.surname === forgedPassport.surname &&
        doc.given === forgedPassport.given &&
        doc.dob === forgedPassport.dob
      ) {
        result.push(doc)
      } else {
        result.push({
          ...doc,
          id: nextId(world, 'idCard-'),
          number: newDocNumber(rng, 'idCard', registryLookup(world)),
          surname: forgedPassport.surname,
          given: forgedPassport.given,
          dob: forgedPassport.dob,
          photo: forgedPassport.photo,
          provenance: 'support_forgery',
          tamperNote: 'Forged to match the fake passport.',
        })
      }
      continue
    }
    if (
      doc.surname === forgedPassport.surname &&
      doc.given === forgedPassport.given &&
      doc.passportNumber === forgedPassport.number
    ) {
      result.push(doc)
      continue
    }
    if (doc.type === 'healthCert' && !healthCountries(ctx).includes(forgedPassport.country))
      continue
    result.push(supportCopy(doc, forgedPassport, world, rng))
  }
  // A new nationality may require papers the person never had
  if (
    foreign &&
    hasRule(ctx.rules, 'entry_permit_required') &&
    !result.some((d) => d.type === 'entryPermit' || d.type === 'diplomaticAuth')
  ) {
    if (docs.some((d) => d.type === 'entryPermit')) {
      const permit = buildForgedPermit(forgedPassport, person, ctx, world, rng)
      result.push({
        ...permit,
        provenance: 'support_forgery',
        tamperNote: 'Forged to match the fake passport.',
      })
    }
  }
  if (
    healthCountries(ctx).includes(forgedPassport.country) &&
    !result.some((d) => d.type === 'healthCert')
  ) {
    const cert = buildForgedHealthCert(forgedPassport, ctx, world, rng)
    result.push({
      ...cert,
      provenance: 'support_forgery',
      tamperNote: 'Forged to match the fake passport.',
    })
  }
  return result
}

function supportCopy(
  doc: EntryPermit | WorkPass | HealthCert | DiplomaticAuth,
  passport: Passport,
  world: WorldState,
  rng: Rng,
): GameDocument {
  return {
    ...doc,
    id: nextId(world, `${doc.type}-`),
    number: newDocNumber(rng, doc.type, registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    provenance: 'support_forgery',
    tamperNote: 'Forged to match the fake passport.',
  }
}

function buildForgedPermit(
  passport: Passport,
  person: PersonTruth,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
): EntryPermit {
  const purpose = person.purpose
  return {
    id: nextId(world, 'entryPermit-'),
    type: 'entryPermit',
    provenance: 'forged',
    tamperNote: 'Forged entry permit.',
    number: newDocNumber(rng, 'entryPermit', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    purpose,
    durationDays: Math.min(person.durationDays, PERMIT_MAX_DAYS[purpose]),
    validUntil: addDays(ctx.date, rng.int(2, 20)),
    seal: currentSeal(ctx, 'ministry'),
  }
}

function buildForgedHealthCert(
  passport: Passport,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
): HealthCert {
  const vaccinatedOn = addDays(ctx.date, -rng.int(30, 600))
  return {
    id: nextId(world, 'healthCert-'),
    type: 'healthCert',
    provenance: 'forged',
    tamperNote: 'Forged health certificate.',
    number: newDocNumber(rng, 'healthCert', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    vaccine: 'MF-3',
    vaccinatedOn,
    issued: addDays(vaccinatedOn, rng.int(0, 4)),
    clinicCity: rng.pick(['Halvenburg', 'Ostmarch', 'Kessling']),
    seal: currentSeal(ctx, 'health'),
  }
}

function buildForgedDoc(
  target: Exclude<DocTarget, 'passport' | 'idCard'>,
  passport: Passport,
  person: PersonTruth,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
): EntryPermit | WorkPass | HealthCert | DiplomaticAuth {
  switch (target) {
    case 'entryPermit':
      return buildForgedPermit(passport, person, ctx, world, rng)
    case 'healthCert':
      return buildForgedHealthCert(passport, ctx, world, rng)
    case 'workPass': {
      const employer = person.employer ?? rng.pick(EMPLOYERS)
      return {
        id: nextId(world, 'workPass-'),
        type: 'workPass',
        provenance: 'forged',
        tamperNote: 'Forged work pass.',
        number: newDocNumber(rng, 'workPass', registryLookup(world)),
        surname: passport.surname,
        given: passport.given,
        passportNumber: passport.number,
        employer: employer.name,
        field: employer.field,
        validUntil: addDays(ctx.date, rng.int(30, 300)),
        seal: currentSeal(ctx, 'labour'),
      }
    }
    case 'diplomaticAuth': {
      const others = rng.sample(
        FOREIGN_COUNTRY_IDS.filter((c) => c !== passport.country),
        rng.int(1, 2),
      )
      return {
        id: nextId(world, 'diplomaticAuth-'),
        type: 'diplomaticAuth',
        provenance: 'forged',
        tamperNote: 'Forged diplomatic authorization.',
        number: newDocNumber(rng, 'diplomaticAuth', registryLookup(world)),
        surname: passport.surname,
        given: passport.given,
        passportNumber: passport.number,
        issuingCountry: passport.country,
        accessTo: rng.shuffle([HOME_COUNTRY, ...others]),
        seal: BASE_SEALS[passportAuthority(passport.country)],
      }
    }
  }
}

function applyForgery(
  target: DocTarget,
  flaw: FlawType | null,
  base: BaseProblemId,
  docs: GameDocument[],
  person: PersonTruth,
  face: FaceSpec,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  record: (note: string, target: string | null) => void,
): GameDocument[] {
  const passport = docs.find((d): d is Passport => d.type === 'passport')
  if (!passport) return docs
  const kind = flaw ? 'Forged' : 'Clean forgery of'

  if (target === 'passport') {
    const forged = forgedPassportFor(base, passport, person, face, ctx, world, rng)
    let result = alignSupportDocs(docs, forged.passport, person, ctx, world, rng)
    let fp = result[0] as Passport
    let flawNote = 'No visible flaw.'
    let usedFlaw = flaw
    if (usedFlaw === 'name_spelling' || usedFlaw === 'number_mismatch') {
      const support = result.find(
        (d): d is EntryPermit | WorkPass | HealthCert | DiplomaticAuth =>
          d.type === 'entryPermit' ||
          d.type === 'workPass' ||
          d.type === 'healthCert' ||
          d.type === 'diplomaticAuth',
      )
      if (!support) usedFlaw = 'seal'
      else if (usedFlaw === 'name_spelling') {
        const surname = misspell(rng, fp.surname)
        fp = { ...fp, surname }
        result = [fp, ...result.slice(1)]
        flawNote = `Passport surname misspelled as ${surname}.`
      } else {
        const wrong = alterOneCharacter(rng, support.passportNumber, registryLookup(world))
        result = result.map((d) => (d === support ? { ...support, passportNumber: wrong } : d))
        flawNote = `The ${support.type} refers to passport ${wrong}.`
      }
    }
    if (usedFlaw === 'seal') {
      fp = { ...fp, seal: forgeSealVariant(fp.seal, rng) }
      result = [fp, ...result.slice(1)]
      flawNote = 'Passport seal differs from the reference.'
    } else if (usedFlaw === 'issuing_city') {
      const elsewhere = COUNTRY_IDS.filter((c) => c !== fp.country).flatMap((c) => [
        ...COUNTRIES[c].cities,
      ])
      const city = rng.pick([...FAKE_CITIES, ...elsewhere])
      fp = { ...fp, issuingCity: city }
      result = [fp, ...result.slice(1)]
      flawNote = `Issuing city ${city} does not belong to ${countryName(fp.country)}.`
    } else if (usedFlaw === 'date_inconsistency') {
      fp = { ...fp, issued: addYears(fp.issued, -rng.int(1, 2)) }
      result = [fp, ...result.slice(1)]
      flawNote = 'Issue and expiry dates are not 10 years apart.'
    }
    record(
      `${forged.note} ${flaw ? flawNote : 'No visible flaw, only the registry knows.'}`,
      'passport',
    )
    return result
  }

  if (target === 'idCard') return docs
  const forged = buildForgedDoc(target, passport, person, ctx, world, rng)
  let flawed: GameDocument = forged
  let flawNote = 'No visible flaw, only the registry knows.'
  if (flaw === 'name_spelling') {
    flawed = { ...forged, surname: misspell(rng, forged.surname) }
    flawNote = `Surname misspelled as ${(flawed as EntryPermit).surname}.`
  } else if (flaw === 'number_mismatch') {
    flawed = {
      ...forged,
      passportNumber: alterOneCharacter(rng, forged.passportNumber, registryLookup(world)),
    }
    flawNote = `Refers to passport ${(flawed as EntryPermit).passportNumber}.`
  } else if (flaw === 'date_inconsistency' && forged.type === 'healthCert') {
    flawed = { ...forged, issued: addDays(forged.vaccinatedOn, -rng.int(3, 40)) }
    flawNote = 'Issued before the vaccination date.'
  } else if (flaw) {
    flawed = {
      ...forged,
      seal: forgeSealVariant(forged.seal, rng, ctx.validSeals[forged.seal.authority]),
    }
    flawNote = 'Seal differs from the reference.'
  }
  record(`${kind} ${target}. ${flawNote}`, target)
  const withoutSameType = docs.filter((d) => d.type !== target)
  return [...withoutSameType, flawed]
}

// ---------- Borrowed identity ----------

function borrowIdentity(
  entry: ApplicantPlan,
  person: PersonTruth,
  base: BaseProblemId,
  ctx: DayContext,
  world: WorldState,
  rng: Rng,
  tracker: DayTracker,
): { docs: GameDocument[]; note: string } {
  const closed = closedCountries(ctx)
  const health = healthCountries(ctx)
  const character =
    entry.recurring.mode === 'impersonate' && entry.recurring.character_id
      ? world.characters[entry.recurring.character_id]
      : undefined
  const imitated = character ? world.persons[character.personId] : undefined

  let owner: PersonTruth
  if (imitated && !closed.includes(imitated.nationality)) {
    owner = imitated
    tracker.usedPersons.add(owner.personId)
  } else {
    const nationalityOk = (c: CountryId) =>
      !closed.includes(c) && !(base === 'missing_health_cert' && health.includes(c))
    const nationality = nationalityOk(person.nationality)
      ? person.nationality
      : rng.pick(COUNTRY_IDS.filter(nationalityOk))
    owner = generatePerson(world, rng, {
      date: ctx.date,
      nationality,
      sex: person.sex,
      purpose: nationality === HOME_COUNTRY ? 'visit' : person.purpose,
      face: lookAlike(person.face, rng),
      height:
        person.height +
        (rng.chance(0.5) ? 1 : -1) * rng.int(TOLERANCE.heightCm + 1, TOLERANCE.heightCm + 4),
      dob: addDays(person.dob, rng.int(-700, 700)),
      reserve: 'lookalike',
    })
    owner.weight = person.weight + rng.int(-1, 1)
    if (owner.purpose === 'work') ensureWorker(owner, rng)
  }
  const docs = issueLegitDocs(world, rng, owner, ctx).map((d) => ({
    ...d,
    provenance: 'borrowed' as const,
    tamperNote: `Genuine document of ${displayName(owner)}.`,
  }))
  const note =
    imitated && owner === imitated
      ? `Impersonates the regular ${character?.nickname ?? displayName(owner)} with their genuine papers.`
      : `Uses the genuine papers of look-alike ${displayName(owner)}.`
  return { docs, note }
}

// ---------- Recurring characters ----------

function registerCharacter(
  entry: ApplicantPlan,
  build: Build,
  applicantId: string,
  ctx: DayContext,
  world: WorldState,
): string | null {
  const mode = entry.recurring.mode
  if (mode === 'introduce') {
    const id = `char-${Object.keys(world.characters).length + 1}`
    const character: RecurringCharacter = {
      id,
      personId: build.truth.personId,
      nickname: entry.recurring.nickname ?? id,
      introducedDay: ctx.dayIndex,
      appearances: [{ day: ctx.dayIndex, applicantId, kind: entry.kind, mode: 'introduce' }],
    }
    world.characters[id] = character
    if (!world.reserved[build.truth.personId]) world.reserved[build.truth.personId] = 'character'
    return id
  }
  if ((mode === 'reuse' || mode === 'impersonate') && entry.recurring.character_id) {
    const character = world.characters[entry.recurring.character_id]
    if (!character) return null
    const returned = mode === 'reuse' && build.characterId === character.id
    const impersonated =
      mode === 'impersonate' &&
      build.techniques.some(
        (t) => t.type === 'borrowed_identity' && t.note.startsWith('Impersonates'),
      )
    if (!returned && !impersonated) return null
    character.appearances.push({
      day: ctx.dayIndex,
      applicantId,
      kind: entry.kind,
      mode: returned ? 'reuse' : 'impersonate',
    })
    return character.id
  }
  return null
}
