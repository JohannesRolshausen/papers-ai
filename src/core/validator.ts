// The single source of truth for admissibility.
// It looks only at data: the true person, what they present, what they carry, the day's rules
// and the registry. The adversary can never claim a status, the validator computes it.

import { HEALTH_CERT_MAX_AGE_YEARS, PERMIT_MAX_DAYS, TOLERANCE } from '../config'
import { addYears, formatDocDate, fullYearsBetween, isBefore } from './dates'
import type { DiplomaticAuth, GameDocument, Letter, NumberedDocument, Passport } from './documents'
import { DOC_TITLES, displayName, isNumbered } from './documents'
import { coreFaceDifferences, coreFaceEqual } from './faces'
import { findDocument, registryDifferences } from './people'
import {
  bulletinRef,
  calendarRef,
  docRef,
  personRef,
  refKey,
  ruleRef,
  rulebookRef,
  sameRefSet,
} from './refs'
import type { RuleId } from './rules'
import { getRule, hasRule } from './rules'
import type { AuthorityId } from './seals'
import { AUTHORITY_NAMES, passportAuthority, sealMatchesAny } from './seals'
import type {
  Appearance,
  DayContext,
  Evidence,
  EvidenceDifficulty,
  HiddenItem,
  PersonTruth,
  RegistryRecord,
  Violation,
  ViolationCode,
  WantedEntry,
  WorldState,
} from './types'
import { COUNTRIES, HOME_COUNTRY, REQUIRED_VACCINE, VELMARK_DISTRICTS, countryName } from './world'

// What the validator needs to know about someone at the window
export interface ApplicantView {
  personId: string
  appearance: Appearance
  documents: GameDocument[]
  hidden: HiddenItem[]
}

// Leap days make "plus ten years" ambiguous, so either direction counts
export function tenYearsApart(issued: string, expires: string): boolean {
  return addYears(issued, 10) === expires || addYears(expires, -10) === issued
}

function inspect(
  refs: Evidence['refs'],
  difficulty: EvidenceDifficulty,
  description: string,
): Evidence {
  return { tool: 'inspect', refs, difficulty, description }
}

function viaTool(
  tool: Exclude<Evidence['tool'], 'inspect'>,
  description: string,
  difficulty: EvidenceDifficulty = 'easy',
): Evidence {
  return { tool, refs: [], difficulty, description }
}

function nameDifficulty(a: string, b: string): EvidenceDifficulty {
  if (a.length !== b.length) return Math.abs(a.length - b.length) <= 1 ? 'subtle' : 'easy'
  let diffs = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++
  return diffs <= 1 ? 'subtle' : 'easy'
}

export function expectedAuthority(doc: NumberedDocument): AuthorityId {
  switch (doc.type) {
    case 'passport':
      return passportAuthority(doc.country)
    case 'idCard':
      return 'civil'
    case 'entryPermit':
      return 'ministry'
    case 'workPass':
      return 'labour'
    case 'healthCert':
      return 'health'
    case 'diplomaticAuth':
      return passportAuthority(doc.issuingCountry)
  }
}

export function validateApplicant(
  app: ApplicantView,
  ctx: DayContext,
  world: WorldState,
): Violation[] {
  const truth = world.persons[app.personId]
  if (!truth) throw new Error(`Unknown person ${app.personId}`)
  const out: Violation[] = []
  const add: AddFn = (code, ruleId, message, evidence, docId = null) => {
    out.push({ code, ruleId, message, evidence, docId })
  }
  const active = (id: RuleId) => hasRule(ctx.rules, id)
  const today = ctx.date
  const docs = app.documents
  const passport = findDocument(docs, 'passport')
  const foreigner = passport
    ? passport.country !== HOME_COUNTRY
    : truth.nationality !== HOME_COUNTRY

  // ---------- Passport ----------
  if (active('passport_required')) {
    if (!passport) {
      add('MISSING_DOCUMENT', 'passport_required', 'No passport presented.', [
        inspect([ruleRef('passport_required')], 'easy', 'The rules require a passport.'),
      ])
    } else {
      if (isBefore(passport.expires, today)) {
        add(
          'PASSPORT_EXPIRED',
          'passport_required',
          `Passport expired on ${formatDocDate(passport.expires)}.`,
          [
            inspect(
              [docRef(passport.id, 'expires'), calendarRef()],
              'easy',
              'Expiry date is before today.',
            ),
          ],
        )
      }
      if (!tenYearsApart(passport.issued, passport.expires)) {
        add(
          'PASSPORT_DATES_INCONSISTENT',
          'passport_required',
          'Issue and expiry dates are not 10 years apart.',
          [
            inspect(
              [docRef(passport.id, 'issued'), docRef(passport.id, 'expires')],
              'subtle',
              'Validity is not exactly 10 years.',
            ),
          ],
        )
      }
      if (!COUNTRIES[passport.country].cities.includes(passport.issuingCity)) {
        add(
          'INVALID_ISSUING_CITY',
          'passport_required',
          `${passport.issuingCity} is not a city of ${countryName(passport.country)}.`,
          [
            inspect(
              [docRef(passport.id, 'issuingCity'), rulebookRef('cities', passport.country)],
              'subtle',
              'Issuing city not in the rulebook list.',
            ),
          ],
        )
      }
      if (Math.abs(passport.height - app.appearance.height) > TOLERANCE.heightCm) {
        add(
          'HEIGHT_MISMATCH',
          'passport_required',
          `Passport says ${passport.height} cm, entrant is ${app.appearance.height} cm.`,
          [
            inspect(
              [docRef(passport.id, 'height'), personRef('height')],
              'subtle',
              'Height chart disagrees with the passport.',
            ),
          ],
        )
      }
      if (Math.abs(passport.weight - app.appearance.weight) > TOLERANCE.weightKg) {
        add(
          'WEIGHT_MISMATCH',
          'passport_required',
          `Passport says ${passport.weight} kg, scale shows ${app.appearance.weight} kg.`,
          [
            inspect(
              [docRef(passport.id, 'weight'), personRef('weight')],
              'subtle',
              'Scale disagrees with the passport.',
            ),
          ],
        )
      }
    }
  }

  // ---------- Identity ----------
  if (active('identity_match') && passport) {
    const photoDiffs = coreFaceDifferences(passport.photo, app.appearance.face)
    if (photoDiffs.length > 0) {
      add('PHOTO_MISMATCH', 'identity_match', 'The passport photo does not show the entrant.', [
        inspect(
          [docRef(passport.id, 'photo'), personRef('face')],
          photoDiffs.length >= 2 ? 'subtle' : 'hard',
          `Different ${photoDiffs.join(', ')}.`,
        ),
      ])
    }
    const record = world.registry[passport.number]
    const nameDiffers = truth.surname !== passport.surname || truth.given !== passport.given
    const holderDiffers = record !== undefined && record.holderId !== truth.personId
    if (
      nameDiffers ||
      truth.dob !== passport.dob ||
      truth.nationality !== passport.country ||
      holderDiffers
    ) {
      add(
        'IDENTITY_MISMATCH',
        'identity_match',
        `The entrant is really ${displayName(truth)} (${countryName(truth.nationality)}).`,
        [
          viaTool(
            'fingerprints',
            `Fingerprints belong to ${displayName(truth)}, born ${formatDocDate(truth.dob)}, ${countryName(truth.nationality)}.`,
          ),
        ],
      )
    }
  }

  // ---------- Authenticity of every document ----------
  if (active('documents_authentic')) {
    for (const doc of docs) {
      if (isNumbered(doc)) checkNumberedDocument(doc, ctx, world, add)
      else checkLetter(doc, ctx, add)
    }
  }

  // ---------- Revoked passports ----------
  if (passport) {
    const listed = ctx.bulletin.revoked.includes(passport.number)
    const record = world.registry[passport.number]
    const revokedInRegistry = record?.status === 'revoked' && record.docType === 'passport'
    if ((listed && active('revoked_list')) || revokedInRegistry) {
      const evidence: Evidence[] = []
      if (listed && active('revoked_list')) {
        evidence.push(
          inspect(
            [docRef(passport.id, 'number'), bulletinRef('revoked')],
            'easy',
            "Number is on today's revoked list.",
          ),
        )
      }
      if (revokedInRegistry)
        evidence.push(viaTool('registry', 'Registry marks this passport as REVOKED.'))
      add(
        'REVOKED_DOCUMENT',
        active('revoked_list') ? 'revoked_list' : 'documents_authentic',
        `Passport ${passport.number} is revoked.`,
        evidence,
        passport.id,
      )
    }
  }

  // ---------- Entry permit / diplomatic exemption ----------
  const diplo = findDocument(docs, 'diplomaticAuth')
  if (active('entry_permit_required') && foreigner) {
    const permit = findDocument(docs, 'entryPermit')
    const diploAccepted = active('diplomatic_exemption') && diplo !== undefined
    const diploGrantsAccess = diploAccepted && diplo.accessTo.includes(HOME_COUNTRY)
    if (!permit && !diploGrantsAccess) {
      if (diploAccepted) {
        add(
          'DIPLOMATIC_ACCESS',
          'diplomatic_exemption',
          'Diplomatic authorization does not cover Velmark, and there is no entry permit.',
          [
            inspect(
              [docRef(diplo.id, 'accessTo'), ruleRef('diplomatic_exemption')],
              'subtle',
              'Velmark is not in the access list.',
            ),
            inspect([ruleRef('entry_permit_required')], 'easy', 'No entry permit.'),
          ],
        )
      } else {
        add('MISSING_DOCUMENT', 'entry_permit_required', 'No entry permit presented.', [
          inspect([ruleRef('entry_permit_required')], 'easy', 'Foreigners need an entry permit.'),
        ])
      }
    }
    if (permit && passport) {
      checkNameAndNumber(permit, passport, 'entry_permit_required', add)
      if (isBefore(permit.validUntil, today)) {
        add(
          'DOC_EXPIRED',
          'entry_permit_required',
          `Entry permit expired on ${formatDocDate(permit.validUntil)}.`,
          [
            inspect(
              [docRef(permit.id, 'validUntil'), calendarRef()],
              'easy',
              'Permit is no longer valid.',
            ),
          ],
        )
      }
      if (permit.durationDays > PERMIT_MAX_DAYS[permit.purpose]) {
        add(
          'DURATION_EXCEEDED',
          'entry_permit_required',
          `${permit.durationDays} days exceeds the ${permit.purpose} maximum.`,
          [
            inspect(
              [docRef(permit.id, 'durationDays'), ruleRef('entry_permit_required')],
              'subtle',
              'Duration above the allowed maximum.',
            ),
          ],
        )
      }
    }
    if (permit && truth.purpose !== permit.purpose) {
      const evidence: Evidence[] = [
        {
          tool: 'interrogate',
          refs: [],
          difficulty: 'hard',
          description: `Real purpose is ${truth.purpose}, the entrant may lie about it.`,
        },
      ]
      const hiddenTell = app.hidden.find((h) => h.revealsPurpose === truth.purpose)
      if (hiddenTell) evidence.push(viaTool('bodyScan', `Scan shows ${hiddenTell.label}.`))
      if (app.appearance.luggage.some((l) => l.revealsPurpose === truth.purpose)) {
        evidence.push(
          inspect(
            [personRef('luggage'), docRef(permit.id, 'purpose')],
            'subtle',
            'Luggage does not fit the stated purpose.',
          ),
        )
      }
      add(
        'WRONG_PURPOSE',
        'entry_permit_required',
        `Permit says ${permit.purpose}, real purpose is ${truth.purpose}.`,
        evidence,
      )
    }
  }
  if (diplo && passport && active('diplomatic_exemption')) {
    checkNameAndNumber(diplo, passport, 'diplomatic_exemption', add)
  }

  // ---------- Wanted ----------
  if (active('wanted_list')) {
    const entry = ctx.bulletin.wanted.find((w) => w.personId === truth.personId)
    if (entry)
      add(
        'WANTED',
        'wanted_list',
        `${displayName(entry)} is wanted for ${entry.reason.toLowerCase()}.`,
        wantedEvidence(entry, passport, app),
      )
  }

  // ---------- Citizens ----------
  if (active('citizen_id_required') && passport && passport.country === HOME_COUNTRY) {
    const card = findDocument(docs, 'idCard')
    if (!card) {
      add('MISSING_DOCUMENT', 'citizen_id_required', 'No identity card presented.', [
        inspect([ruleRef('citizen_id_required')], 'easy', 'Citizens need an identity card.'),
      ])
    } else {
      for (const field of ['surname', 'given'] as const) {
        if (card[field] !== passport[field]) {
          add(
            'NAME_MISMATCH',
            'citizen_id_required',
            'Name on the identity card differs from the passport.',
            [
              inspect(
                [docRef(card.id, field), docRef(passport.id, field)],
                nameDifficulty(card[field], passport[field]),
                'Names differ.',
              ),
            ],
          )
        }
      }
      if (card.dob !== passport.dob) {
        add(
          'DOB_MISMATCH',
          'citizen_id_required',
          'Date of birth differs between identity card and passport.',
          [
            inspect(
              [docRef(card.id, 'dob'), docRef(passport.id, 'dob')],
              'subtle',
              'Dates of birth differ.',
            ),
          ],
        )
      }
      if (isBefore(card.expires, today)) {
        add('DOC_EXPIRED', 'citizen_id_required', 'Identity card expired.', [
          inspect([docRef(card.id, 'expires'), calendarRef()], 'easy', 'Card is no longer valid.'),
        ])
      }
      if (!VELMARK_DISTRICTS.includes(card.district)) {
        add(
          'INVALID_DISTRICT',
          'citizen_id_required',
          `${card.district} is not a Velmark district.`,
          [
            inspect(
              [docRef(card.id, 'district'), rulebookRef('districts', HOME_COUNTRY)],
              'subtle',
              'District not in the rulebook list.',
            ),
          ],
        )
      }
      const diffs = coreFaceDifferences(card.photo, app.appearance.face)
      if (diffs.length > 0 && active('identity_match')) {
        add(
          'PHOTO_MISMATCH',
          'identity_match',
          'The identity card photo does not show the entrant.',
          [
            inspect(
              [docRef(card.id, 'photo'), personRef('face')],
              diffs.length >= 2 ? 'subtle' : 'hard',
              `Different ${diffs.join(', ')}.`,
            ),
          ],
        )
      }
    }
  }

  // ---------- Contraband ----------
  if (active('contraband_banned')) {
    for (const item of app.hidden.filter((h) => h.kind === 'contraband')) {
      add('CONTRABAND', 'contraband_banned', `Carries ${item.label}.`, [
        viaTool('bodyScan', `Scan shows ${item.label}.`),
      ])
    }
  }

  // ---------- Work pass ----------
  if (active('work_pass_required') && foreigner && passport) {
    const permit = findDocument(docs, 'entryPermit')
    if (permit && permit.purpose === 'work') {
      const pass = findDocument(docs, 'workPass')
      if (!pass) {
        add('MISSING_DOCUMENT', 'work_pass_required', 'Comes to work but has no work pass.', [
          inspect([ruleRef('work_pass_required')], 'easy', 'Workers need a work pass.'),
          inspect(
            [docRef(permit.id, 'purpose'), ruleRef('work_pass_required')],
            'easy',
            'Permit purpose is work.',
          ),
        ])
      } else {
        checkNameAndNumber(pass, passport, 'work_pass_required', add)
        if (isBefore(pass.validUntil, today)) {
          add('DOC_EXPIRED', 'work_pass_required', 'Work pass expired.', [
            inspect(
              [docRef(pass.id, 'validUntil'), calendarRef()],
              'easy',
              'Work pass is no longer valid.',
            ),
          ])
        }
      }
    }
  }

  // ---------- Health certificate ----------
  const healthRule = getRule(ctx.rules, 'health_cert_required')
  if (healthRule && passport && healthRule.countries.includes(passport.country)) {
    const cert = findDocument(docs, 'healthCert')
    if (!cert) {
      add(
        'MISSING_DOCUMENT',
        'health_cert_required',
        `No health certificate, required for ${countryName(passport.country)}.`,
        [
          inspect([ruleRef('health_cert_required')], 'easy', 'Health certificate required.'),
          inspect(
            [docRef(passport.id, 'country'), ruleRef('health_cert_required')],
            'easy',
            'Nationality is on the outbreak list.',
          ),
        ],
      )
    } else {
      checkNameAndNumber(cert, passport, 'health_cert_required', add)
      if (cert.vaccine !== REQUIRED_VACCINE) {
        add(
          'WRONG_VACCINE',
          'health_cert_required',
          `Vaccine ${cert.vaccine} instead of ${REQUIRED_VACCINE}.`,
          [
            inspect(
              [docRef(cert.id, 'vaccine'), ruleRef('health_cert_required')],
              'subtle',
              'Wrong vaccine.',
            ),
          ],
        )
      }
      if (fullYearsBetween(cert.vaccinatedOn, today) >= HEALTH_CERT_MAX_AGE_YEARS) {
        add('VACCINATION_EXPIRED', 'health_cert_required', 'Vaccination is too old.', [
          inspect(
            [docRef(cert.id, 'vaccinatedOn'), calendarRef()],
            'subtle',
            `Older than ${HEALTH_CERT_MAX_AGE_YEARS} years.`,
          ),
        ])
      }
      if (isBefore(cert.issued, cert.vaccinatedOn)) {
        add(
          'CERT_DATES_INCONSISTENT',
          'health_cert_required',
          'Certificate issued before the vaccination.',
          [
            inspect(
              [docRef(cert.id, 'issued'), docRef(cert.id, 'vaccinatedOn')],
              'subtle',
              'Issue date before vaccination date.',
            ),
          ],
        )
      }
    }
  }

  // ---------- Border closures ----------
  const closed = getRule(ctx.rules, 'border_closed')
  if (closed) {
    if (passport && closed.countries.includes(passport.country)) {
      add(
        'BORDER_CLOSED',
        'border_closed',
        `The border is closed to ${countryName(passport.country)}.`,
        [
          inspect(
            [docRef(passport.id, 'country'), ruleRef('border_closed')],
            'easy',
            'Nationality is closed today.',
          ),
        ],
      )
    } else if (closed.countries.includes(truth.nationality)) {
      add(
        'BORDER_CLOSED',
        'border_closed',
        `Really a citizen of ${countryName(truth.nationality)}, whose border is closed.`,
        [viaTool('fingerprints', `Fingerprints: citizen of ${countryName(truth.nationality)}.`)],
      )
    }
  }

  return out
}

type AddFn = (
  code: ViolationCode,
  ruleId: RuleId,
  message: string,
  evidence: Evidence[],
  // The document a deep check of one document (registry, letter) must look at
  docId?: string | null,
) => void

function checkNameAndNumber(
  doc: Exclude<NumberedDocument, Passport>,
  passport: Passport,
  ruleId: RuleId,
  add: AddFn,
): void {
  if (doc.type === 'idCard') return
  const title = DOC_TITLES[doc.type]
  for (const field of ['surname', 'given'] as const) {
    if (doc[field] !== passport[field]) {
      add(
        'NAME_MISMATCH',
        ruleId,
        `Name on the ${title.toLowerCase()} differs from the passport.`,
        [
          inspect(
            [docRef(doc.id, field), docRef(passport.id, field)],
            nameDifficulty(doc[field], passport[field]),
            `${doc[field]} vs ${passport[field]}.`,
          ),
        ],
      )
    }
  }
  if (doc.passportNumber !== passport.number) {
    add('NUMBER_MISMATCH', ruleId, `Passport number on the ${title.toLowerCase()} differs.`, [
      inspect(
        [docRef(doc.id, 'passportNumber'), docRef(passport.id, 'number')],
        nameDifficulty(doc.passportNumber, passport.number),
        'Passport numbers differ.',
      ),
    ])
  }
}

function checkNumberedDocument(
  doc: NumberedDocument,
  ctx: DayContext,
  world: WorldState,
  add: AddFn,
): void {
  const title = DOC_TITLES[doc.type]
  const authority = expectedAuthority(doc)
  const valid = ctx.validSeals[authority] ?? []
  if (doc.seal.authority !== authority || !sealMatchesAny(doc.seal, valid)) {
    add(
      'SEAL_INVALID',
      'documents_authentic',
      `The seal on the ${title.toLowerCase()} is not a valid ${AUTHORITY_NAMES[authority]} seal.`,
      [
        inspect(
          [docRef(doc.id, 'seal'), rulebookRef('seals', authority)],
          'subtle',
          'Seal differs from the reference.',
        ),
      ],
      doc.id,
    )
  }
  const record: RegistryRecord | undefined = world.registry[doc.number]
  if (!record || record.docType !== doc.type) {
    add(
      'DOC_UNREGISTERED',
      'documents_authentic',
      `${title} ${doc.number} is not in the registry.`,
      [viaTool('registry', `No record of ${title.toLowerCase()} ${doc.number}.`)],
      doc.id,
    )
    return
  }
  const diffs = registryDifferences(doc, record)
  if (diffs.length > 0) {
    const shown = diffs.map((f) => `${f}: ${record.fields[f]}`).join(', ')
    add(
      'DOC_ALTERED',
      'documents_authentic',
      `${title} was altered (${diffs.join(', ')}).`,
      [viaTool('registry', `Registry record differs: ${shown}.`)],
      doc.id,
    )
  }
}

function checkLetter(letter: Letter, ctx: DayContext, add: AddFn): void {
  if (letter.authentic) return
  const evidence: Evidence[] = [
    viaTool('verifyLetter', `${letter.sender} has no record of this letter.`),
  ]
  if (letter.seal) {
    const valid = ctx.validSeals[letter.seal.authority] ?? []
    if (!sealMatchesAny(letter.seal, valid)) {
      evidence.push(
        inspect(
          [docRef(letter.id, 'seal'), rulebookRef('seals', letter.seal.authority)],
          'subtle',
          'Letter seal differs from the reference.',
        ),
      )
    }
  }
  if (letter.claimsExemption) {
    evidence.push(
      inspect(
        [docRef(letter.id, 'body'), bulletinRef('rules')],
        'hard',
        "The claimed exemption is not in today's rules.",
      ),
    )
  }
  add(
    'FORGED_LETTER',
    'documents_authentic',
    `Forged letter: "${letter.title}".`,
    evidence,
    letter.id,
  )
}

function wantedEvidence(
  entry: WantedEntry,
  passport: Passport | undefined,
  app: ApplicantView,
): Evidence[] {
  const evidence: Evidence[] = [
    viaTool('fingerprints', `Fingerprints match wanted person ${displayName(entry)}.`),
  ]
  if (passport && passport.surname === entry.surname && passport.given === entry.given) {
    evidence.push(
      inspect(
        [docRef(passport.id, 'surname'), bulletinRef('wanted', entry.id)],
        'easy',
        'Name is on the wanted list.',
      ),
    )
    evidence.push(
      inspect(
        [docRef(passport.id, 'given'), bulletinRef('wanted', entry.id)],
        'easy',
        'Name is on the wanted list.',
      ),
    )
  }
  if (coreFaceEqual(app.appearance.face, entry.face)) {
    const styleChanged =
      app.appearance.face.hair !== entry.face.hair || app.appearance.face.beard !== entry.face.beard
    evidence.push(
      inspect(
        [personRef('face'), bulletinRef('wanted', entry.id)],
        styleChanged ? 'hard' : 'subtle',
        'Face matches the wanted photo.',
      ),
    )
  }
  if (passport && coreFaceEqual(passport.photo, entry.face)) {
    evidence.push(
      inspect(
        [docRef(passport.id, 'photo'), bulletinRef('wanted', entry.id)],
        'subtle',
        'Passport photo matches the wanted photo.',
      ),
    )
  }
  return evidence
}

// ---------- Inspect mode ----------

export interface InspectMatch {
  violation: Violation
  evidence: Evidence
}

// The player clicked a set of refs. Returns the violation those refs expose, if any.
export function matchInspection(
  violations: readonly Violation[],
  clickedKeys: readonly string[],
): InspectMatch | null {
  for (const violation of violations) {
    for (const evidence of violation.evidence) {
      if (evidence.tool !== 'inspect') continue
      if (sameRefSet(evidence.refs.map(refKey), clickedKeys)) return { violation, evidence }
    }
  }
  return null
}

// ---------- Deep checks ----------

export interface FingerprintReport {
  surname: string
  given: string
  dob: string
  nationality: string
  wanted: WantedEntry | null
  matchesPassport: boolean
  lines: string[]
}

export function fingerprintReport(
  app: ApplicantView,
  ctx: DayContext,
  world: WorldState,
): FingerprintReport {
  const truth = world.persons[app.personId] as PersonTruth
  const passport = findDocument(app.documents, 'passport')
  const wanted = ctx.bulletin.wanted.find((w) => w.personId === truth.personId) ?? null
  const matchesPassport =
    passport !== undefined &&
    passport.surname === truth.surname &&
    passport.given === truth.given &&
    passport.dob === truth.dob &&
    passport.country === truth.nationality
  const lines = [
    `IDENTITY: ${displayName(truth)}`,
    `BORN: ${formatDocDate(truth.dob)}`,
    `NATIONALITY: ${countryName(truth.nationality)}`,
    matchesPassport ? 'MATCHES PASSPORT HOLDER' : 'DOES NOT MATCH PASSPORT HOLDER',
  ]
  if (wanted && hasRule(ctx.rules, 'wanted_list'))
    lines.push(`WANTED: ${wanted.reason.toUpperCase()}`)
  return {
    surname: truth.surname,
    given: truth.given,
    dob: truth.dob,
    nationality: truth.nationality,
    wanted,
    matchesPassport,
    lines,
  }
}

export interface RegistryReport {
  number: string
  found: boolean
  status: 'valid' | 'revoked' | null
  differences: { field: string; registry: string }[]
  lines: string[]
}

export function registryReport(doc: NumberedDocument, world: WorldState): RegistryReport {
  const record = world.registry[doc.number]
  if (!record || record.docType !== doc.type) {
    return {
      number: doc.number,
      found: false,
      status: null,
      differences: [],
      lines: [`${doc.number}: NO RECORD`],
    }
  }
  const differences = registryDifferences(doc, record).map((field) => ({
    field,
    registry: record.fields[field] ?? '',
  }))
  const lines = [`${doc.number}: RECORD FOUND`, `STATUS: ${record.status.toUpperCase()}`]
  for (const field of REGISTRY_PRINT_ORDER) {
    const value = record.fields[field]
    if (value !== undefined) lines.push(`${field.toUpperCase()}: ${value}`)
  }
  for (const d of differences) lines.push(`MISMATCH IN ${d.field.toUpperCase()}`)
  return { number: doc.number, found: true, status: record.status, differences, lines }
}

const REGISTRY_PRINT_ORDER = [
  'surname',
  'given',
  'dob',
  'country',
  'passportNumber',
  'purpose',
  'durationDays',
  'issued',
  'expires',
  'validUntil',
  'employer',
  'vaccine',
  'vaccinatedOn',
  'district',
  'issuingCountry',
  'accessTo',
]

export interface BodyScanReport {
  items: HiddenItem[]
  lines: string[]
}

export function bodyScanReport(app: ApplicantView): BodyScanReport {
  if (app.hidden.length === 0) return { items: [], lines: ['NOTHING CONCEALED'] }
  return { items: app.hidden, lines: app.hidden.map((h) => `CONCEALED: ${h.label.toUpperCase()}`) }
}

export interface LetterReport {
  authentic: boolean
  lines: string[]
}

export function verifyLetterReport(letter: Letter): LetterReport {
  return letter.authentic
    ? { authentic: true, lines: [`${letter.sender.toUpperCase()} CONFIRMS THE LETTER`] }
    : { authentic: false, lines: [`${letter.sender.toUpperCase()}: NO RECORD OF THIS LETTER`] }
}

export function isDiplomaticAuth(doc: GameDocument): doc is DiplomaticAuth {
  return doc.type === 'diplomaticAuth'
}
