// People, the registry and genuine document issuing.

import { HEALTH_CERT_MAX_AGE_YEARS, PERMIT_MAX_DAYS } from '../config'
import type { IsoDate } from './dates'
import { addDays, addYears, isAfter } from './dates'
import type {
  DiplomaticAuth,
  EntryPermit,
  GameDocument,
  HealthCert,
  IdCard,
  Letter,
  NumberLookup,
  NumberedDocType,
  NumberedDocument,
  Passport,
  Purpose,
  WorkPass,
} from './documents'
import { PASSPORT_VALIDITY_YEARS, REGISTRY_FIELDS, fieldString, newDocNumber } from './documents'
import type { FaceSpec, Sex } from './faces'
import { photoOf, randomFace } from './faces'
import type { Rng } from './rng'
import type { AuthorityId, SealSpec } from './seals'
import { BASE_SEALS, passportAuthority } from './seals'
import type {
  DayContext,
  PersonTruth,
  RegistryRecord,
  RegistryStatus,
  ReservationReason,
  WorldState,
} from './types'
import type { CountryId, Employer } from './world'
import {
  CLINIC_CITIES,
  COUNTRIES,
  EMPLOYERS,
  FOREIGN_COUNTRY_IDS,
  HOME_COUNTRY,
  OCCUPATIONS,
  REQUIRED_VACCINE,
  VELMARK_DISTRICTS,
} from './world'

export function createWorld(seed: number): WorldState {
  return {
    seed,
    counter: 0,
    persons: {},
    passports: {},
    registry: {},
    characters: {},
    reserved: {},
  }
}

export function nextId(world: WorldState, prefix: string): string {
  world.counter += 1
  return `${prefix}${world.counter}`
}

export function registryLookup(world: WorldState): NumberLookup {
  return { has: (value: string) => value in world.registry }
}

// ---------- Persons ----------

export interface PersonOptions {
  date: IsoDate
  nationality?: CountryId
  sex?: Sex
  purpose?: Purpose
  diplomat?: boolean
  face?: FaceSpec
  surname?: string
  given?: string
  height?: number
  dob?: IsoDate
  reserve?: ReservationReason
}

export function generatePerson(world: WorldState, rng: Rng, opts: PersonOptions): PersonTruth {
  const nationality = opts.nationality ?? rng.pick(FOREIGN_COUNTRY_IDS)
  const country = COUNTRIES[nationality]
  const sex: Sex = opts.sex ?? (rng.chance(0.5) ? 'M' : 'F')
  const age = rng.int(19, 74)
  const dob = opts.dob ?? addDays(addYears(opts.date, -age), -rng.int(0, 364))
  const height = opts.height ?? (sex === 'M' ? rng.int(165, 196) : rng.int(154, 183))
  const bmi = 19 + rng.next() * 11
  const weight = Math.round(bmi * (height / 100) ** 2)
  const diplomat = opts.diplomat ?? false
  const purpose: Purpose =
    opts.purpose ??
    (nationality === HOME_COUNTRY ? 'visit' : rng.pick(['visit', 'visit', 'work', 'transit']))
  const employer: Employer | null = purpose === 'work' ? rng.pick(EMPLOYERS) : null
  const occupation = diplomat ? 'Diplomat' : employer ? employer.field : rng.pick(OCCUPATIONS)
  const person: PersonTruth = {
    personId: nextId(world, 'p'),
    surname: opts.surname ?? rng.pick(country.surnames),
    given: opts.given ?? rng.pick(country.given[sex]),
    sex,
    dob,
    nationality,
    face: opts.face ?? randomFace(rng, sex),
    height,
    weight,
    occupation,
    employer,
    purpose,
    durationDays: durationFor(rng, purpose),
    isDiplomat: diplomat,
  }
  world.persons[person.personId] = person
  if (opts.reserve) world.reserved[person.personId] = opts.reserve
  return person
}

export function durationFor(rng: Rng, purpose: Purpose): number {
  switch (purpose) {
    case 'transit':
      return rng.int(1, PERMIT_MAX_DAYS.transit)
    case 'visit':
      return rng.int(3, PERMIT_MAX_DAYS.visit)
    case 'work':
      return rng.pick([90, 180, 270, PERMIT_MAX_DAYS.work])
  }
}

// ---------- Registry ----------

export function registerDocument(
  world: WorldState,
  doc: NumberedDocument,
  holderId: string,
  status: RegistryStatus = 'valid',
): RegistryRecord {
  const fields: Record<string, string> = {}
  for (const field of REGISTRY_FIELDS[doc.type]) fields[field] = fieldString(doc, field)
  const record: RegistryRecord = { number: doc.number, docType: doc.type, holderId, fields, status }
  world.registry[doc.number] = record
  return record
}

// Fields where the document no longer matches its registry record
export function registryDifferences(doc: NumberedDocument, record: RegistryRecord): string[] {
  return REGISTRY_FIELDS[doc.type].filter(
    (field) => record.fields[field] !== fieldString(doc, field),
  )
}

// ---------- Seals ----------

// The first valid seal is the current design. Genuine documents always carry it.
export function currentSeal(ctx: DayContext, authority: AuthorityId): SealSpec {
  return ctx.validSeals[authority]?.[0] ?? BASE_SEALS[authority]
}

// ---------- Genuine documents ----------

function docId(world: WorldState, type: NumberedDocType | 'letter'): string {
  return nextId(world, `${type}-`)
}

export interface PassportOptions {
  expires?: IsoDate
  register?: boolean
  status?: RegistryStatus
}

export function issuePassport(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  date: IsoDate,
  opts: PassportOptions = {},
): Passport {
  const expires = opts.expires ?? addDays(date, rng.int(25, 9 * 365))
  const issued = addYears(expires, -PASSPORT_VALIDITY_YEARS)
  const passport: Passport = {
    id: docId(world, 'passport'),
    type: 'passport',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'passport', registryLookup(world), person.nationality),
    surname: person.surname,
    given: person.given,
    sex: person.sex,
    dob: person.dob,
    country: person.nationality,
    issuingCity: rng.pick(COUNTRIES[person.nationality].cities),
    issued,
    expires,
    height: person.height,
    weight: person.weight,
    photo: photoOf(person.face),
    seal: BASE_SEALS[passportAuthority(person.nationality)],
  }
  if (opts.register !== false) {
    registerDocument(world, passport, person.personId, opts.status ?? 'valid')
    world.passports[person.personId] = passport
  }
  return passport
}

// The person's stored genuine passport, renewed if it would be expired on `date`
export function passportFor(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  date: IsoDate,
): Passport {
  const existing = world.passports[person.personId]
  if (existing && !isAfter(date, existing.expires)) return existing
  return issuePassport(world, rng, person, date)
}

export function issueIdCard(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  ctx: DayContext,
): IdCard {
  const card: IdCard = {
    id: docId(world, 'idCard'),
    type: 'idCard',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'idCard', registryLookup(world)),
    surname: person.surname,
    given: person.given,
    dob: person.dob,
    district: rng.pick(VELMARK_DISTRICTS),
    expires: addDays(ctx.date, rng.int(60, 8 * 365)),
    photo: photoOf(person.face),
    seal: currentSeal(ctx, 'civil'),
  }
  registerDocument(world, card, person.personId)
  return card
}

export interface PermitOptions {
  purpose?: Purpose
  validUntil?: IsoDate
  durationDays?: number
}

export function issuePermit(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  passport: Passport,
  ctx: DayContext,
  opts: PermitOptions = {},
): EntryPermit {
  const purpose = opts.purpose ?? person.purpose
  const durationDays = Math.min(opts.durationDays ?? person.durationDays, PERMIT_MAX_DAYS[purpose])
  const permit: EntryPermit = {
    id: docId(world, 'entryPermit'),
    type: 'entryPermit',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'entryPermit', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    purpose,
    durationDays,
    validUntil: opts.validUntil ?? addDays(ctx.date, rng.int(1, 20)),
    seal: currentSeal(ctx, 'ministry'),
  }
  registerDocument(world, permit, person.personId)
  return permit
}

export function issueWorkPass(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  passport: Passport,
  ctx: DayContext,
): WorkPass {
  const employer = person.employer ?? rng.pick(EMPLOYERS)
  const pass: WorkPass = {
    id: docId(world, 'workPass'),
    type: 'workPass',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'workPass', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    employer: employer.name,
    field: employer.field,
    validUntil: addDays(ctx.date, rng.int(30, 365)),
    seal: currentSeal(ctx, 'labour'),
  }
  registerDocument(world, pass, person.personId)
  return pass
}

export function issueHealthCert(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  passport: Passport,
  ctx: DayContext,
): HealthCert {
  const maxAgeDays = HEALTH_CERT_MAX_AGE_YEARS * 365 - 30
  const vaccinatedOn = addDays(ctx.date, -rng.int(10, maxAgeDays))
  const cert: HealthCert = {
    id: docId(world, 'healthCert'),
    type: 'healthCert',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'healthCert', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    vaccine: REQUIRED_VACCINE,
    vaccinatedOn,
    issued: addDays(vaccinatedOn, rng.int(0, 5)),
    clinicCity: rng.pick(CLINIC_CITIES),
    seal: currentSeal(ctx, 'health'),
  }
  registerDocument(world, cert, person.personId)
  return cert
}

export function issueDiplomaticAuth(
  world: WorldState,
  rng: Rng,
  person: PersonTruth,
  passport: Passport,
  ctx: DayContext,
): DiplomaticAuth {
  const others = rng.sample(
    FOREIGN_COUNTRY_IDS.filter((c) => c !== person.nationality),
    rng.int(1, 3),
  )
  const auth: DiplomaticAuth = {
    id: docId(world, 'diplomaticAuth'),
    type: 'diplomaticAuth',
    provenance: 'genuine',
    tamperNote: null,
    number: newDocNumber(rng, 'diplomaticAuth', registryLookup(world)),
    surname: passport.surname,
    given: passport.given,
    passportNumber: passport.number,
    issuingCountry: passport.country,
    accessTo: rng.shuffle([HOME_COUNTRY, ...others]),
    seal: currentSeal(ctx, passportAuthority(passport.country)),
  }
  registerDocument(world, auth, person.personId)
  return auth
}

export interface LetterInput {
  title: string
  sender: string
  body: string
  claimsExemption: boolean
}

export function makeLetter(
  world: WorldState,
  input: LetterInput,
  authentic: boolean,
  seal: SealSpec | null,
): Letter {
  return {
    id: docId(world, 'letter'),
    type: 'letter',
    provenance: authentic ? 'genuine' : 'forged',
    tamperNote: authentic ? null : 'Forged letter',
    title: input.title,
    sender: input.sender,
    body: input.body,
    claimsExemption: input.claimsExemption,
    seal,
    authentic,
  }
}

export function findDocument<T extends GameDocument['type']>(
  docs: readonly GameDocument[],
  type: T,
): Extract<GameDocument, { type: T }> | undefined {
  return docs.find((d) => d.type === type) as Extract<GameDocument, { type: T }> | undefined
}
