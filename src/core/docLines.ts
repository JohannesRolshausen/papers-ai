// Documentation lines for deep checks, incident reports and supervisor reviews.
// The player types these lines like a typing test. They grow longer as the game goes on.

import type { DeepToolId } from '../config'
import { BOOTH_ID, OFFICER_ID } from '../config'
import type { IncidentKind, ViolationCode } from './types'

export type FormKind = DeepToolId | 'incident' | 'review'

export const FORM_TITLES: Record<FormKind, string> = {
  registry: 'REGISTRY QUERY',
  fingerprints: 'BIOMETRIC REQUEST',
  bodyScan: 'SCAN AUTHORIZATION',
  verifyLetter: 'VERIFICATION CALL',
  incident: 'INCIDENT REPORT',
  review: 'SUPERVISOR REVIEW',
}

export const FORM_CODES: Record<FormKind, string> = {
  registry: 'R-12',
  fingerprints: 'B-7',
  bodyScan: 'S-3',
  verifyLetter: 'V-9',
  incident: 'X-1',
  review: 'SR-4',
}

// Extra fields join the line from these days on: growing bureaucracy
export const DOC_LINE_STAGES = {
  form: 4,
  booth: 8,
  time: 12,
  document: 17,
  copy: 22,
} as const

export const COPY_TO: Record<FormKind, string> = {
  registry: 'CENTRAL REGISTRY',
  fingerprints: 'BIOMETRICS BUREAU',
  bodyScan: 'CUSTOMS OFFICE',
  verifyLetter: 'MINISTRY DESK',
  incident: 'INTERNAL AFFAIRS',
  review: 'PERSONNEL FILE',
}

// Fixed reasons the player can pick when no discrepancy is marked
export const REASON_CHOICES: Record<DeepToolId, readonly string[]> = {
  registry: ['ROUTINE CHECK', 'DOCUMENT DOUBT', 'NUMBER CHECK', 'SEAL DOUBT'],
  fingerprints: ['ROUTINE CHECK', 'PHOTO DOUBT', 'IDENTITY DOUBT', 'WANTED LIST CHECK'],
  bodyScan: ['ROUTINE CHECK', 'WEIGHT DOUBT', 'SUSPICIOUS LUGGAGE', 'CONTRABAND SUSPICION'],
  verifyLetter: ['ROUTINE CHECK', 'SEAL DOUBT', 'EXEMPTION CLAIM', 'UNKNOWN SENDER'],
}

export const INCIDENT_LABELS: Record<IncidentKind, string> = {
  threat: 'THREAT AGAINST OFFICER',
  bribe: 'BRIBERY ATTEMPT',
  letter: 'FORGED LETTER',
}

const REASON_LABELS: Partial<Record<ViolationCode, string>> = {
  DOC_UNREGISTERED: 'UNREGISTERED DOCUMENT',
  DOC_ALTERED: 'ALTERED DOCUMENT',
  SEAL_INVALID: 'INVALID SEAL',
  FORGED_LETTER: 'FORGED LETTER',
  REVOKED_DOCUMENT: 'REVOKED PASSPORT',
  WANTED: 'WANTED LIST MATCH',
  MISSING_DOCUMENT: 'MISSING DOCUMENT',
}

// Reason text for a marked discrepancy
export function reasonFromCode(code: ViolationCode): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, ' ')
}

// Uppercase ASCII only, so the line can be typed on any keyboard
export function plainUpper(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ,.:'/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function subjectName(person: { surname: string; given: string } | null): string {
  if (!person) return 'UNIDENTIFIED'
  return plainUpper(`${person.surname}, ${person.given}`)
}

export function formatClock(minute: number): string {
  const m = Math.max(0, Math.floor(minute))
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface DocLineInput {
  kind: FormKind
  day: number
  serial: number
  // "SURNAME, GIVEN" or UNIDENTIFIED
  subject: string
  // Reason for a deep check, incident label or the case of a review
  reason: string
  minute: number
  // Number of the checked document, for registry queries and later days
  documentNumber: string | null
}

export function formNumber(day: number, serial: number): string {
  return `${String(day).padStart(2, '0')}-${serial}`
}

export function buildDocLine(input: DocLineInput): string {
  const { kind, day } = input
  const parts = [`${FORM_TITLES[kind]} ${formNumber(day, input.serial)}`]
  if (day >= DOC_LINE_STAGES.form) parts.push(`FORM ${FORM_CODES[kind]}`)
  if (day >= DOC_LINE_STAGES.booth) parts.push(`BOOTH ${BOOTH_ID}`)
  if (day >= DOC_LINE_STAGES.time) parts.push(`TIME ${formatClock(input.minute)}`)
  parts.push(`${kind === 'review' ? 'COMPLAINT BY' : 'SUBJECT'}: ${plainUpper(input.subject)}`)
  if (input.documentNumber && (kind === 'registry' || day >= DOC_LINE_STAGES.document)) {
    parts.push(`DOC: ${plainUpper(input.documentNumber)}`)
  }
  const label = kind === 'incident' ? 'TYPE' : kind === 'review' ? 'CASE' : 'REASON'
  parts.push(`${label}: ${plainUpper(input.reason)}`)
  parts.push(`OFFICER ${OFFICER_ID}`)
  if (day >= DOC_LINE_STAGES.copy) parts.push(`COPY: ${COPY_TO[kind]}`)
  return parts.join(' | ')
}

// ---------- Typing comparison ----------

export type CharState = 'correct' | 'wrong' | 'missing' | 'extra'

export interface TypingComparison {
  // One state per expected character, then one 'extra' per character typed beyond the end
  states: CharState[]
  // Wrong characters plus extra characters
  typos: number
  missing: number
  // Length of the correct start, where the cursor can safely continue
  correctPrefix: number
  complete: boolean
  accuracy: number
}

export interface TypingOptions {
  ignoreCase: boolean
}

export function compareTyping(
  expected: string,
  typed: string,
  options: TypingOptions = { ignoreCase: true },
): TypingComparison {
  const norm = (c: string) => (options.ignoreCase ? c.toUpperCase() : c)
  const states: CharState[] = []
  let typos = 0
  let missing = 0
  let correctPrefix = 0
  let prefixBroken = false
  let correct = 0
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i] as string
    const got = typed[i]
    if (got === undefined) {
      states.push('missing')
      missing++
      prefixBroken = true
    } else if (norm(got) === norm(want)) {
      states.push('correct')
      correct++
      if (!prefixBroken) correctPrefix++
    } else {
      states.push('wrong')
      typos++
      prefixBroken = true
    }
  }
  for (let i = expected.length; i < typed.length; i++) {
    states.push('extra')
    typos++
  }
  const longest = Math.max(expected.length, typed.length)
  return {
    states,
    typos,
    missing,
    correctPrefix,
    complete: typos === 0 && missing === 0,
    accuracy: longest === 0 ? 1 : correct / longest,
  }
}

// Result of a finished typing test, as the interface reports it
export interface TypingResult {
  text: string
  ms: number
  // Wrong keystrokes made along the way, even if corrected later
  typos: number
}

// Characters per minute, the usual typing test measure
export function charsPerMinute(chars: number, ms: number): number {
  if (ms <= 0) return 0
  return Math.round((chars / ms) * 60_000)
}
