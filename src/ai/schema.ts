// The contract between the adversary and the engine.
// The adversary returns a DayPlan. The engine checks it, then builds concrete people from it.

import * as z from 'zod'
import type { ToolId } from '../config'
import type { RuleId } from '../core/rules'

export const BASE_PROBLEM_IDS = [
  'no_permit',
  'expired_passport',
  'wanted',
  'banned_nationality',
  'wrong_purpose',
  'smuggler',
  'missing_health_cert',
  'revoked_document',
  'missing_work_pass',
] as const
export type BaseProblemId = (typeof BASE_PROBLEM_IDS)[number]

export const TECHNIQUE_IDS = [
  'alter_field',
  'forged_document',
  'clean_forgery',
  'borrowed_identity',
  'disguise',
  'hidden_item',
  'fake_letter',
] as const
export type TechniqueId = (typeof TECHNIQUE_IDS)[number]

export const DOC_TARGETS = [
  'passport',
  'idCard',
  'entryPermit',
  'workPass',
  'healthCert',
  'diplomaticAuth',
] as const
export type DocTarget = (typeof DOC_TARGETS)[number]

export const FLAW_TYPES = [
  'seal',
  'issuing_city',
  'name_spelling',
  'number_mismatch',
  'date_inconsistency',
] as const
export type FlawType = (typeof FLAW_TYPES)[number]

export const ALTER_FIELDS = ['expires', 'surname', 'number', 'country', 'purpose'] as const
export type AlterField = (typeof ALTER_FIELDS)[number]

export const LEGIT_QUIRKS = [
  'none',
  'passport_expires_today',
  'permit_expires_today',
  'diplomat',
  'returning_citizen',
  'transit',
  'new_look',
  'weight_change',
  'long_work_stay',
] as const
export type LegitQuirk = (typeof LEGIT_QUIRKS)[number]

export const DEMEANORS = [
  'calm',
  'nervous',
  'friendly',
  'rude',
  'tearful',
  'talkative',
  'official',
  'silent',
] as const
export type Demeanor = (typeof DEMEANORS)[number]

export const LINE_TRIGGERS = [
  'arrival',
  'first_question',
  'discrepancy',
  'deep_check',
  'before_decision',
  'after_approve',
  'after_deny',
] as const
export type LineTrigger = (typeof LINE_TRIGGERS)[number]

export const LEVER_TYPES = ['none', 'bribe', 'threat', 'complaint'] as const
export type LeverType = (typeof LEVER_TYPES)[number]

export const RECURRING_MODES = ['none', 'introduce', 'reuse', 'impersonate'] as const
export type RecurringMode = (typeof RECURRING_MODES)[number]

const CountrySchema = z.enum(['velmark', 'drastia', 'kelmar', 'ostrevia', 'lunmark', 'tarvenne'])
const PurposeSchema = z.enum(['visit', 'work', 'transit'])

export const TechniqueSchema = z.object({
  type: z.enum(TECHNIQUE_IDS),
  target_doc: z.enum(DOC_TARGETS).nullable(),
  flaw: z.enum(FLAW_TYPES).nullable(),
  field: z.enum(ALTER_FIELDS).nullable(),
  subtle: z.boolean(),
})

export const LetterPlanSchema = z.object({
  title: z.string(),
  sender: z.string(),
  body: z.string(),
  claims_exemption: z.boolean(),
})

export const LeverSchema = z.object({
  type: z.enum(LEVER_TYPES),
  real: z.boolean(),
  line: z.string(),
  amount: z.number().nullable(),
})

export const ScriptedLineSchema = z.object({
  trigger: z.enum(LINE_TRIGGERS),
  text: z.string(),
})

export const RecurringSchema = z.object({
  mode: z.enum(RECURRING_MODES),
  character_id: z.string().nullable(),
  nickname: z.string().nullable(),
})

export const PersonaSchema = z.object({
  demeanor: z.enum(DEMEANORS),
  backstory: z.string(),
  cover_story: z.string(),
})

export const ApplicantPlanSchema = z.object({
  kind: z.enum(['legit', 'infiltrator']),
  base_problem: z.enum(BASE_PROBLEM_IDS).nullable(),
  techniques: z.array(TechniqueSchema),
  legit_quirk: z.enum(LEGIT_QUIRKS),
  nationality: CountrySchema.nullable(),
  purpose: PurposeSchema.nullable(),
  recurring: RecurringSchema,
  persona: PersonaSchema,
  opening_line: z.string(),
  scripted_lines: z.array(ScriptedLineSchema),
  letter: LetterPlanSchema.nullable(),
  lever: LeverSchema,
  coordination_note: z.string().nullable(),
  private_intent: z.string(),
})

export const DayPlanSchema = z.object({
  strategy_summary: z.string(),
  notes_for_future_self: z.string(),
  applicants: z.array(ApplicantPlanSchema),
})

export type TechniquePlan = z.infer<typeof TechniqueSchema>
export type LetterPlan = z.infer<typeof LetterPlanSchema>
export type LeverPlan = z.infer<typeof LeverSchema>
export type ScriptedLine = z.infer<typeof ScriptedLineSchema>
export type RecurringPlan = z.infer<typeof RecurringSchema>
export type PersonaPlan = z.infer<typeof PersonaSchema>
export type ApplicantPlan = z.infer<typeof ApplicantPlanSchema>
export type DayPlan = z.infer<typeof DayPlanSchema>

// Primary techniques change the identity papers. Only one per applicant.
export const PRIMARY_TECHNIQUES: readonly TechniqueId[] = [
  'alter_field',
  'forged_document',
  'clean_forgery',
  'borrowed_identity',
]

export interface TechniqueInfo {
  id: TechniqueId
  cost: number
  minDay: number
  label: string
  description: string
  evidence: string
}

export const TECHNIQUES: Record<TechniqueId, TechniqueInfo> = {
  alter_field: {
    id: 'alter_field',
    cost: 1,
    minDay: 1,
    label: 'Alter a field',
    description:
      'Change one field on a genuine document (set `field`). Subtle alterations change a single character or digit.',
    evidence:
      'Leaves a visible inconsistency (between documents or inside one document) and a registry mismatch.',
  },
  forged_document: {
    id: 'forged_document',
    cost: 2,
    minDay: 1,
    label: 'Forged document',
    description:
      'Produce a fake document (set `target_doc`). You choose the one flaw it carries (set `flaw`).',
    evidence:
      'Exactly one visible flaw of the chosen type, and the document is not in the registry.',
  },
  clean_forgery: {
    id: 'clean_forgery',
    cost: 4,
    minDay: 1,
    label: 'Clean forgery',
    description: 'A fake document with no visible flaw (set `target_doc`).',
    evidence: 'Only a registry lookup reveals it.',
  },
  borrowed_identity: {
    id: 'borrowed_identity',
    cost: 3,
    minDay: 2,
    label: 'Borrowed identity',
    description:
      "Use the genuine, valid documents of a look-alike. The person's own problem disappears from the papers.",
    evidence:
      'Fingerprints show the real identity. The photo differs in one facial feature and the height is a few cm off.',
  },
  disguise: {
    id: 'disguise',
    cost: 1,
    minDay: 3,
    label: 'Disguise',
    description:
      'Change hair, beard, glasses and hat so the face is harder to match to the wanted list.',
    evidence:
      'Core facial features still match the wanted photo. Fingerprints reveal the identity.',
  },
  hidden_item: {
    id: 'hidden_item',
    cost: 1,
    minDay: 3,
    label: 'Hidden item',
    description: 'Hide contraband or work tools so nothing shows in the luggage or on the scale.',
    evidence: 'Only a body scan reveals it.',
  },
  fake_letter: {
    id: 'fake_letter',
    cost: 1,
    minDay: 3,
    label: 'Fake letter',
    description:
      'Hand over a forged official letter you write yourself (fill `letter`). Subtle letters carry a seal that looks valid.',
    evidence:
      'Presenting a forged letter is itself grounds for denial. Verify Letter exposes it, a non-subtle letter also has a wrong seal.',
  },
}

export interface BaseProblemInfo {
  id: BaseProblemId
  label: string
  description: string
  requiresRule: RuleId
  requiresTool: ToolId | null
  techniques: readonly TechniqueId[]
  alterFields: readonly AlterField[]
  forgeTargets: readonly DocTarget[]
}

export const BASE_PROBLEMS: Record<BaseProblemId, BaseProblemInfo> = {
  no_permit: {
    id: 'no_permit',
    label: 'No entry permit',
    description: 'A foreigner who never obtained an entry permit.',
    requiresRule: 'entry_permit_required',
    requiresTool: null,
    techniques: ['forged_document', 'clean_forgery', 'borrowed_identity', 'fake_letter'],
    alterFields: [],
    forgeTargets: ['entryPermit', 'diplomaticAuth'],
  },
  expired_passport: {
    id: 'expired_passport',
    label: 'Expired passport',
    description: 'The passport ran out before today.',
    requiresRule: 'passport_required',
    requiresTool: null,
    techniques: [
      'alter_field',
      'forged_document',
      'clean_forgery',
      'borrowed_identity',
      'fake_letter',
    ],
    alterFields: ['expires'],
    forgeTargets: ['passport'],
  },
  wanted: {
    id: 'wanted',
    label: 'Wanted person',
    description: "Someone on today's wanted list (the engine picks who).",
    requiresRule: 'wanted_list',
    requiresTool: null,
    techniques: [
      'alter_field',
      'forged_document',
      'clean_forgery',
      'borrowed_identity',
      'disguise',
      'fake_letter',
    ],
    alterFields: ['surname'],
    forgeTargets: ['passport'],
  },
  banned_nationality: {
    id: 'banned_nationality',
    label: 'Banned nationality',
    description: 'A citizen of a country whose border is closed today.',
    requiresRule: 'border_closed',
    requiresTool: null,
    techniques: [
      'alter_field',
      'forged_document',
      'clean_forgery',
      'borrowed_identity',
      'fake_letter',
    ],
    alterFields: ['country'],
    forgeTargets: ['passport'],
  },
  wrong_purpose: {
    id: 'wrong_purpose',
    label: 'False purpose',
    description: 'Holds a genuine visit permit but comes to work.',
    requiresRule: 'entry_permit_required',
    requiresTool: null,
    techniques: ['hidden_item', 'fake_letter'],
    alterFields: [],
    forgeTargets: [],
  },
  smuggler: {
    id: 'smuggler',
    label: 'Smuggler',
    description: 'Valid papers, but carries contraband.',
    requiresRule: 'contraband_banned',
    requiresTool: 'bodyScan',
    techniques: ['hidden_item', 'fake_letter'],
    alterFields: [],
    forgeTargets: [],
  },
  missing_health_cert: {
    id: 'missing_health_cert',
    label: 'No health certificate',
    description: 'From an outbreak country and not vaccinated.',
    requiresRule: 'health_cert_required',
    requiresTool: null,
    techniques: ['forged_document', 'clean_forgery', 'borrowed_identity', 'fake_letter'],
    alterFields: [],
    forgeTargets: ['healthCert'],
  },
  revoked_document: {
    id: 'revoked_document',
    label: 'Revoked passport',
    description: "Holds a passport whose number is on today's revoked list (the engine picks who).",
    requiresRule: 'revoked_list',
    requiresTool: null,
    techniques: [
      'alter_field',
      'forged_document',
      'clean_forgery',
      'borrowed_identity',
      'fake_letter',
    ],
    alterFields: ['number'],
    forgeTargets: ['passport'],
  },
  missing_work_pass: {
    id: 'missing_work_pass',
    label: 'No work pass',
    description: 'Comes to work with a genuine work permit but without a work pass.',
    requiresRule: 'work_pass_required',
    requiresTool: null,
    techniques: ['alter_field', 'forged_document', 'clean_forgery', 'hidden_item', 'fake_letter'],
    alterFields: ['purpose'],
    forgeTargets: ['workPass'],
  },
}

export interface QuirkInfo {
  id: LegitQuirk
  description: string
  requiresRule: RuleId | null
}

export const QUIRKS: Record<LegitQuirk, QuirkInfo> = {
  none: { id: 'none', description: 'Nothing unusual.', requiresRule: null },
  passport_expires_today: {
    id: 'passport_expires_today',
    description: 'Passport expires today. Still valid.',
    requiresRule: null,
  },
  permit_expires_today: {
    id: 'permit_expires_today',
    description: 'Entry permit expires today. Still valid.',
    requiresRule: 'entry_permit_required',
  },
  diplomat: {
    id: 'diplomat',
    description: 'A diplomat with a valid authorization instead of an entry permit.',
    requiresRule: 'diplomatic_exemption',
  },
  returning_citizen: {
    id: 'returning_citizen',
    description: 'A Velmarkan citizen coming home.',
    requiresRule: null,
  },
  transit: {
    id: 'transit',
    description: 'A transit traveler with a two-day permit.',
    requiresRule: 'entry_permit_required',
  },
  new_look: {
    id: 'new_look',
    description: 'Changed hair, beard or glasses since the passport photo. Legal.',
    requiresRule: null,
  },
  weight_change: {
    id: 'weight_change',
    description: 'Weight differs from the passport, but within the allowed tolerance.',
    requiresRule: null,
  },
  long_work_stay: {
    id: 'long_work_stay',
    description: 'A worker with a full-year work permit and work pass.',
    requiresRule: 'work_pass_required',
  },
}

export function techniqueCost(techniques: readonly { type: TechniqueId }[]): number {
  return techniques.reduce((sum, t) => sum + TECHNIQUES[t.type].cost, 0)
}
