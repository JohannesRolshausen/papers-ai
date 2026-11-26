// Document types. Every field the player can click in inspect mode is listed in DOC_FIELDS.

import type { IsoDate } from './dates'
import type { FaceSpec, Sex } from './faces'
import type { Rng } from './rng'
import type { SealSpec } from './seals'
import type { CountryId } from './world'
import { COUNTRIES } from './world'

export type Purpose = 'visit' | 'work' | 'transit'
export const PURPOSES: readonly Purpose[] = ['visit', 'work', 'transit']

export type DocType =
  'passport' | 'idCard' | 'entryPermit' | 'workPass' | 'healthCert' | 'diplomaticAuth' | 'letter'

export const DOC_TYPES: readonly DocType[] = [
  'passport',
  'idCard',
  'entryPermit',
  'workPass',
  'healthCert',
  'diplomaticAuth',
  'letter',
]

// Hidden truth about where a document came from. Never shown during play, only in the debrief.
export type Provenance = 'genuine' | 'altered' | 'forged' | 'support_forgery' | 'borrowed'

interface DocBase {
  id: string
  provenance: Provenance
  // Debrief note on what was done to this document, if anything
  tamperNote: string | null
}

export interface Passport extends DocBase {
  type: 'passport'
  number: string
  surname: string
  given: string
  sex: Sex
  dob: IsoDate
  country: CountryId
  issuingCity: string
  issued: IsoDate
  expires: IsoDate
  height: number
  weight: number
  photo: FaceSpec
  seal: SealSpec
}

export interface IdCard extends DocBase {
  type: 'idCard'
  number: string
  surname: string
  given: string
  dob: IsoDate
  district: string
  expires: IsoDate
  photo: FaceSpec
  seal: SealSpec
}

export interface EntryPermit extends DocBase {
  type: 'entryPermit'
  number: string
  surname: string
  given: string
  passportNumber: string
  purpose: Purpose
  durationDays: number
  validUntil: IsoDate
  seal: SealSpec
}

export interface WorkPass extends DocBase {
  type: 'workPass'
  number: string
  surname: string
  given: string
  passportNumber: string
  employer: string
  field: string
  validUntil: IsoDate
  seal: SealSpec
}

export interface HealthCert extends DocBase {
  type: 'healthCert'
  number: string
  surname: string
  given: string
  passportNumber: string
  vaccine: string
  vaccinatedOn: IsoDate
  issued: IsoDate
  clinicCity: string
  seal: SealSpec
}

export interface DiplomaticAuth extends DocBase {
  type: 'diplomaticAuth'
  number: string
  surname: string
  given: string
  passportNumber: string
  issuingCountry: CountryId
  accessTo: CountryId[]
  seal: SealSpec
}

export interface Letter extends DocBase {
  type: 'letter'
  title: string
  sender: string
  body: string
  claimsExemption: boolean
  seal: SealSpec | null
  authentic: boolean
}

export type GameDocument =
  Passport | IdCard | EntryPermit | WorkPass | HealthCert | DiplomaticAuth | Letter

export type NumberedDocument = Exclude<GameDocument, Letter>
export type NumberedDocType = NumberedDocument['type']

export type DocOfType<T extends DocType> = Extract<GameDocument, { type: T }>

export const DOC_TITLES: Record<DocType, string> = {
  passport: 'Passport',
  idCard: 'Velmark Identity Card',
  entryPermit: 'Entry Permit',
  workPass: 'Work Pass',
  healthCert: 'Health Certificate',
  diplomaticAuth: 'Diplomatic Authorization',
  letter: 'Letter',
}

export interface FieldInfo {
  field: string
  label: string
}

// Inspectable fields per document type, in display order
export const DOC_FIELDS: Record<DocType, readonly FieldInfo[]> = {
  passport: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'sex', label: 'Sex' },
    { field: 'dob', label: 'Date of birth' },
    { field: 'country', label: 'Nationality' },
    { field: 'issuingCity', label: 'Issuing city' },
    { field: 'issued', label: 'Issued' },
    { field: 'expires', label: 'Expires' },
    { field: 'height', label: 'Height' },
    { field: 'weight', label: 'Weight' },
    { field: 'number', label: 'Passport no.' },
    { field: 'photo', label: 'Photo' },
    { field: 'seal', label: 'Seal' },
  ],
  idCard: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'dob', label: 'Date of birth' },
    { field: 'district', label: 'District' },
    { field: 'expires', label: 'Expires' },
    { field: 'number', label: 'ID no.' },
    { field: 'photo', label: 'Photo' },
    { field: 'seal', label: 'Seal' },
  ],
  entryPermit: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'passportNumber', label: 'Passport no.' },
    { field: 'purpose', label: 'Purpose' },
    { field: 'durationDays', label: 'Duration' },
    { field: 'validUntil', label: 'Valid until' },
    { field: 'number', label: 'Permit no.' },
    { field: 'seal', label: 'Seal' },
  ],
  workPass: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'passportNumber', label: 'Passport no.' },
    { field: 'employer', label: 'Employer' },
    { field: 'field', label: 'Field of work' },
    { field: 'validUntil', label: 'Valid until' },
    { field: 'number', label: 'Pass no.' },
    { field: 'seal', label: 'Seal' },
  ],
  healthCert: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'passportNumber', label: 'Passport no.' },
    { field: 'vaccine', label: 'Vaccine' },
    { field: 'vaccinatedOn', label: 'Vaccinated on' },
    { field: 'issued', label: 'Issued' },
    { field: 'clinicCity', label: 'Clinic' },
    { field: 'number', label: 'Certificate no.' },
    { field: 'seal', label: 'Seal' },
  ],
  diplomaticAuth: [
    { field: 'surname', label: 'Surname' },
    { field: 'given', label: 'Given name' },
    { field: 'passportNumber', label: 'Passport no.' },
    { field: 'issuingCountry', label: 'Issued by' },
    { field: 'accessTo', label: 'Access to' },
    { field: 'number', label: 'Authorization no.' },
    { field: 'seal', label: 'Seal' },
  ],
  letter: [
    { field: 'title', label: 'Title' },
    { field: 'sender', label: 'Sender' },
    { field: 'body', label: 'Text' },
    { field: 'seal', label: 'Seal' },
  ],
}

// Fields the registry stores a copy of. A difference between document and registry means tampering.
export const REGISTRY_FIELDS: Record<NumberedDocType, readonly string[]> = {
  passport: ['surname', 'given', 'dob', 'country', 'issued', 'expires'],
  idCard: ['surname', 'given', 'dob', 'district', 'expires'],
  entryPermit: ['surname', 'given', 'passportNumber', 'purpose', 'durationDays', 'validUntil'],
  workPass: ['surname', 'given', 'passportNumber', 'employer', 'validUntil'],
  healthCert: ['surname', 'given', 'passportNumber', 'vaccine', 'vaccinatedOn', 'issued'],
  diplomaticAuth: ['surname', 'given', 'passportNumber', 'issuingCountry', 'accessTo'],
}

export const PASSPORT_VALIDITY_YEARS = 10
export const ID_CARD_VALIDITY_YEARS = 10

export function isNumbered(doc: GameDocument): doc is NumberedDocument {
  return doc.type !== 'letter'
}

export function displayName(doc: { surname: string; given: string }): string {
  return `${doc.surname.toUpperCase()}, ${doc.given}`
}

export function fieldValue(doc: GameDocument, field: string): unknown {
  return (doc as unknown as Record<string, unknown>)[field]
}

// Stable string form of a field value, used for registry comparisons
export function fieldString(doc: GameDocument, field: string): string {
  const value = fieldValue(doc, field)
  if (Array.isArray(value)) return [...value].sort().join(',')
  if (value === null || value === undefined) return ''
  return String(value)
}

const NUMBER_PREFIX: Record<NumberedDocType, string> = {
  passport: '',
  idCard: 'VID',
  entryPermit: 'EP',
  workPass: 'WP',
  healthCert: 'HC',
  diplomaticAuth: 'DA',
}

const NUMBER_CHARS = 'ACDEFHJKLMNPRTVWXY'

export interface NumberLookup {
  has(value: string): boolean
}

// Document numbers are unique within a world. `taken` is the set of numbers already in use.
export function newDocNumber(
  rng: Rng,
  type: NumberedDocType,
  taken: NumberLookup,
  country?: CountryId,
): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const digits = String(rng.int(10000, 99999))
    const letters = `${rng.pick([...NUMBER_CHARS])}${rng.pick([...NUMBER_CHARS])}`
    const prefix = type === 'passport' ? COUNTRIES[country ?? 'velmark'].code : NUMBER_PREFIX[type]
    const number = `${prefix}-${digits}-${letters}`
    if (!taken.has(number)) return number
  }
  throw new Error('Could not find a free document number')
}

// Change one character of a document number, keeping its format
export function alterOneCharacter(rng: Rng, value: string, taken: NumberLookup): string {
  const positions = [...value]
    .map((ch, index) => ({ ch, index }))
    .filter(({ ch, index }) => index > 2 && /[0-9A-Z]/.test(ch))
  for (let attempt = 0; attempt < 50; attempt++) {
    const { ch, index } = rng.pick(positions)
    const pool = /[0-9]/.test(ch) ? '0123456789' : NUMBER_CHARS
    const replacement = rng.pick([...pool].filter((c) => c !== ch))
    const candidate = value.slice(0, index) + replacement + value.slice(index + 1)
    if (!taken.has(candidate)) return candidate
  }
  return `${value}X`
}

// Change one letter of a name so it still reads plausibly
export function misspell(rng: Rng, name: string): string {
  const swaps: Record<string, string[]> = {
    a: ['e', 'o'],
    e: ['a', 'i'],
    i: ['y', 'e'],
    o: ['a', 'u'],
    u: ['o'],
    y: ['i'],
    k: ['c'],
    c: ['k'],
    v: ['w'],
    w: ['v'],
    s: ['z'],
    z: ['s'],
    n: ['m'],
    m: ['n'],
    l: ['ll'],
    t: ['th'],
  }
  const candidates = [...name]
    .map((ch, index) => ({ ch, index }))
    .filter(({ ch, index }) => index > 0 && swaps[ch] !== undefined)
  if (candidates.length === 0) return `${name}e`
  const { ch, index } = rng.pick(candidates)
  const replacement = rng.pick(swaps[ch] as string[])
  return name.slice(0, index) + replacement + name.slice(index + 1)
}
