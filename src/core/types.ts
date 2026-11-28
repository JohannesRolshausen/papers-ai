// Shared domain types used by the engine, the adversaries and the UI.

import type { ApplicantPlan, BaseProblemId, DayPlan, TechniqueId } from '../ai/schema'
import type { DeepToolId, DifficultyId, ToolId } from '../config'
import type { IsoDate } from './dates'
import type { DocType, GameDocument, NumberedDocType, Passport, Purpose } from './documents'
import type { FaceSpec, Sex } from './faces'
import type { ActiveRule, RuleId, Schedule } from './rules'
import type { AuthorityId, SealSpec } from './seals'
import type { CountryId, Employer } from './world'

// ---------- People and world ----------

export interface PersonTruth {
  personId: string
  surname: string
  given: string
  sex: Sex
  dob: IsoDate
  nationality: CountryId
  face: FaceSpec
  height: number
  weight: number
  occupation: string
  employer: Employer | null
  purpose: Purpose
  durationDays: number
  isDiplomat: boolean
}

export type RegistryStatus = 'valid' | 'revoked'

export interface RegistryRecord {
  number: string
  docType: NumberedDocType
  holderId: string
  fields: Record<string, string>
  status: RegistryStatus
}

export interface CharacterAppearance {
  day: number
  applicantId: string
  kind: 'legit' | 'infiltrator'
  mode: 'introduce' | 'reuse' | 'impersonate'
}

export interface RecurringCharacter {
  id: string
  personId: string
  nickname: string
  introducedDay: number
  appearances: CharacterAppearance[]
}

export type ReservationReason = 'wanted' | 'revoked' | 'character' | 'lookalike'

export interface WorldState {
  seed: number
  counter: number
  persons: Record<string, PersonTruth>
  // Current genuine passport of each person
  passports: Record<string, Passport>
  registry: Record<string, RegistryRecord>
  characters: Record<string, RecurringCharacter>
  // People the random generator must not reuse
  reserved: Record<string, ReservationReason>
}

// ---------- Day context and bulletin ----------

export interface WantedEntry {
  id: string
  personId: string
  surname: string
  given: string
  nationality: CountryId
  face: FaceSpec
  reason: string
}

export interface Bulletin {
  dayIndex: number
  date: IsoDate
  headline: string
  changes: string[]
  rules: { id: RuleId; text: string }[]
  wanted: WantedEntry[]
  revoked: string[]
  newTools: ToolId[]
  newDocuments: DocType[]
}

export interface DayContext {
  dayIndex: number
  date: IsoDate
  daysTotal: number
  rules: ActiveRule[]
  bulletin: Bulletin
  validSeals: Record<AuthorityId, SealSpec[]>
  tools: ToolId[]
  applicantCount: number
  infiltratorCap: number
}

// ---------- Inspection references and evidence ----------

export type PersonField = 'face' | 'height' | 'weight' | 'luggage'
export type RulebookSection = 'seals' | 'cities' | 'districts' | 'vaccines'
export type BulletinSection = 'wanted' | 'revoked' | 'rules'

// Something the player can click in inspect mode
export type Ref =
  | { kind: 'doc'; docId: string; field: string }
  | { kind: 'person'; field: PersonField }
  | { kind: 'calendar' }
  | { kind: 'rule'; ruleId: RuleId }
  | { kind: 'rulebook'; section: RulebookSection; key: string }
  | { kind: 'bulletin'; section: BulletinSection; key: string | null }

export type EvidenceTool =
  'inspect' | 'fingerprints' | 'registry' | 'bodyScan' | 'verifyLetter' | 'interrogate'

export type EvidenceDifficulty = 'easy' | 'subtle' | 'hard'

export interface Evidence {
  tool: EvidenceTool
  // For inspect: the refs whose comparison reveals the problem. Empty for other tools.
  refs: Ref[]
  difficulty: EvidenceDifficulty
  description: string
}

export const VIOLATION_CODES = [
  'MISSING_DOCUMENT',
  'PASSPORT_EXPIRED',
  'PASSPORT_DATES_INCONSISTENT',
  'INVALID_ISSUING_CITY',
  'HEIGHT_MISMATCH',
  'WEIGHT_MISMATCH',
  'PHOTO_MISMATCH',
  'SEAL_INVALID',
  'DOC_UNREGISTERED',
  'DOC_ALTERED',
  'FORGED_LETTER',
  'IDENTITY_MISMATCH',
  'NAME_MISMATCH',
  'NUMBER_MISMATCH',
  'DOB_MISMATCH',
  'DOC_EXPIRED',
  'DURATION_EXCEEDED',
  'WRONG_PURPOSE',
  'REVOKED_DOCUMENT',
  'WANTED',
  'INVALID_DISTRICT',
  'CONTRABAND',
  'VACCINATION_EXPIRED',
  'WRONG_VACCINE',
  'CERT_DATES_INCONSISTENT',
  'DIPLOMATIC_ACCESS',
  'BORDER_CLOSED',
] as const
export type ViolationCode = (typeof VIOLATION_CODES)[number]

export interface Violation {
  code: ViolationCode
  ruleId: RuleId
  message: string
  evidence: Evidence[]
  // Set when the problem sits on one document (seal, registry record, forged letter, revoked number)
  docId: string | null
}

// ---------- Applicants ----------

export interface HiddenItem {
  kind: 'contraband' | 'tools' | 'document'
  label: string
  revealsPurpose: Purpose | null
}

export interface LuggageItem {
  label: string
  // Visible items can give away the real purpose of a trip
  revealsPurpose: Purpose | null
}

export interface Appearance {
  face: FaceSpec
  height: number
  weight: number
  luggage: LuggageItem[]
}

export interface AppliedTechnique {
  type: TechniqueId
  target: string | null
  cost: number
  note: string
}

export interface Applicant {
  id: string
  day: number
  slot: number
  kind: 'legit' | 'infiltrator'
  baseProblem: BaseProblemId | null
  // The person actually standing at the window
  personId: string
  characterId: string | null
  appearance: Appearance
  documents: GameDocument[]
  hidden: HiddenItem[]
  plan: ApplicantPlan
  techniques: AppliedTechnique[]
  notes: string[]
  violations: Violation[]
  admissible: boolean
}

// ---------- Player actions and outcomes ----------

export type StandardQuestion = 'purpose' | 'duration' | 'stay' | 'occupation' | 'origin'

export type PlayerAction =
  | { type: 'inspect'; refs: string[]; found: ViolationCode | null; minute: number }
  | {
      type: 'question'
      kind: StandardQuestion | 'discrepancy' | 'free'
      text: string
      answer: string
      minute: number
    }
  | {
      type: 'deepCheck'
      tool: DeepToolId
      docId: string | null
      revealed: ViolationCode[]
      // Length of the typed documentation line, time and wrong keystrokes
      chars: number
      typedMs: number
      typos: number
      minute: number
    }
  | {
      type: 'report'
      incident: IncidentKind
      chars: number
      typedMs: number
      typos: number
      minute: number
    }
  | { type: 'bribe'; accepted: boolean; minute: number }
  | { type: 'decision'; decision: Decision; minute: number }

export type Decision = 'approve' | 'deny'
export type IncidentKind = 'threat' | 'bribe' | 'letter'

export interface ApplicantOutcome {
  applicantId: string
  decision: Decision | 'none'
  // Violation code the player flagged before denying, if any
  documentedReason: ViolationCode | null
  minutesSpent: number
  actions: PlayerAction[]
  bribeAccepted: boolean
  reported: IncidentKind[]
  correct: boolean | null
  // Whether the person got to deliver their bribe, threat or complaint
  leverPresented: boolean
}

// ---------- Consequences and events ----------

export type GameEventKind =
  | 'complaint'
  | 'audit'
  | 'sabotage'
  | 'threat_fine'
  | 'late_discovery'
  | 'error_citation'
  | 'bribe_kept'
  | 'commendation'
  | 'note'

// A sabotaged tool either takes longer or does not work at all for one day
export type SabotageMode = 'slow' | 'down'

export interface GameEvent {
  day: number
  kind: GameEventKind
  text: string
  moneyDelta: number
  minutesLost: number
  sabotagedTool: DeepToolId | null
  sabotageMode: SabotageMode | null
  // The applicant whose case caused this event, if any
  sourceApplicantId: string | null
}

export interface PendingConsequence {
  dueDay: number
  kind: GameEventKind
  sourceApplicantId: string
  text: string
  moneyDelta: number
  minutesLost: number
  sabotagedTool: DeepToolId | null
  sabotageMode: SabotageMode | null
}

// ---------- Adversary bookkeeping ----------

export interface AdversaryResources {
  budget: number
  leverTokens: number
}

export interface StoredPlan {
  day: number
  source: 'claude' | 'offline' | 'fallback'
  plan: DayPlan
  issues: string[]
  costSpent: number
}

// ---------- Game state ----------

export type AiMode = 'claude' | 'offline'

export interface Settings {
  aiMode: AiMode
  model: string
  shiftRealSeconds: number
}

export type Phase = 'bulletin' | 'shift' | 'evening' | 'final' | 'gameover'

export interface LedgerEntry {
  day: number
  label: string
  amount: number
}

export interface Economy {
  money: number
  daysInDebt: number
  ledger: LedgerEntry[]
}

export interface DayRecord {
  dayIndex: number
  context: DayContext
  plan: StoredPlan
  applicants: Applicant[]
  // Filled when the day closes, one outcome per applicant in queue order
  outcomes: ApplicantOutcome[]
  // Morning consequences first, then what happened at the end of the shift
  events: GameEvent[]
  // Shown to the player when the plan came from a fallback
  notice: string | null
  closed: boolean
}

export interface GameState {
  version: 1
  seed: number
  difficulty: DifficultyId
  daysTotal: number
  settings: Settings
  dayIndex: number
  phase: Phase
  world: WorldState
  schedule: Schedule
  economy: Economy
  ai: AdversaryResources
  days: DayRecord[]
  pending: PendingConsequence[]
  // Opaque conversation state of the Claude adversary, kept so a reload can continue
  adversaryMemory: unknown
  createdAt: string
}
