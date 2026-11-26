// The interface every adversary implements, and the data passed to it.
// Package 2 builds observations from player actions, package 4 implements the Claude adversary.

import type { DeepToolId, ToolId } from '../config'
import { formatDocDate } from '../core/dates'
import { displayName } from '../core/documents'
import type {
  AiMode,
  Applicant,
  Decision,
  IncidentKind,
  StandardQuestion,
  ViolationCode,
  WorldState,
} from '../core/types'
import { countryName } from '../core/world'
import type { DayBriefing } from './briefing'
import type {
  BaseProblemId,
  DayPlan,
  Demeanor,
  LeverPlan,
  ScriptedLine,
  TechniqueId,
} from './schema'

// ---------- Observations: what the adversary saw at the booth ----------

export type ApplicantResult =
  'got_through' | 'stopped' | 'legit_admitted' | 'legit_denied' | 'not_processed'

export interface ApplicantObservation {
  slot: number
  applicantId: string
  kind: 'legit' | 'infiltrator'
  baseProblem: BaseProblemId | null
  techniques: TechniqueId[]
  characterId: string | null
  decision: Decision | 'none'
  result: ApplicantResult
  minutesSpent: number
  inspections: number
  flagged: ViolationCode[]
  questions: string[]
  deepChecks: DeepToolId[]
  reports: IncidentKind[]
  bribeAccepted: boolean
  leverOutcome: string | null
}

export interface DayObservation {
  dayIndex: number
  applicants: ApplicantObservation[]
  toolUsage: Record<ToolId, number>
  averageMinutesPerApplicant: number
  processed: number
  notProcessed: number
  infiltratorsThrough: number
  infiltratorsStopped: number
  legitDenied: number
  events: string[]
  planIssues: string[]
}

// ---------- Planning ----------

export interface PlanRequest {
  briefing: DayBriefing
  // Observation of the day before, null on day 1
  previous: DayObservation | null
  history: DayObservation[]
}

export interface PlanResult {
  plan: DayPlan
  source: 'claude' | 'offline' | 'fallback'
  // Shown to the player when the plan had to fall back, for example after a network error
  notice: string | null
}

// ---------- Interrogation ----------

export interface PersonaDossier {
  applicantId: string
  kind: 'legit' | 'infiltrator'
  presentedName: string
  trueName: string
  trueNationality: string
  truePurpose: string
  occupation: string
  demeanor: Demeanor
  backstory: string
  coverStory: string
  privateIntent: string
  coordinationNote: string | null
  documents: string[]
  // What the inspector could find. The persona must never volunteer these.
  secrets: string[]
  techniques: string[]
  lever: LeverPlan
  scriptedLines: ScriptedLine[]
  openingLine: string
}

export interface TranscriptLine {
  speaker: 'inspector' | 'applicant'
  text: string
}

export interface InspectorQuestion {
  kind: StandardQuestion | 'discrepancy' | 'free'
  text: string
  // For discrepancy questions: what the inspector found
  discrepancy: string | null
}

export interface RespondRequest {
  dossier: PersonaDossier
  transcript: TranscriptLine[]
  question: InspectorQuestion
}

// ---------- The adversary ----------

export interface Adversary {
  readonly mode: AiMode
  planDay(request: PlanRequest): Promise<PlanResult>
  // Streams partial text through onText when supported, resolves with the full answer
  respond(request: RespondRequest, onText?: (partial: string) => void): Promise<string>
  exportMemory(): unknown
  importMemory(memory: unknown): void
}

export function presentedName(applicant: Applicant): string {
  const passport = applicant.documents.find((d) => d.type === 'passport')
  return passport && passport.type === 'passport' ? displayName(passport) : 'UNKNOWN'
}

export function buildDossier(applicant: Applicant, world: WorldState): PersonaDossier {
  const truth = world.persons[applicant.personId]
  if (!truth) throw new Error(`Unknown person ${applicant.personId}`)
  const plan = applicant.plan
  const documents = applicant.documents.map((doc) => {
    switch (doc.type) {
      case 'passport':
        return `Passport ${doc.number}: ${displayName(doc)}, ${countryName(doc.country)}, born ${formatDocDate(doc.dob)}, issued in ${doc.issuingCity}, expires ${formatDocDate(doc.expires)}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'entryPermit':
        return `Entry permit ${doc.number}: purpose ${doc.purpose}, ${doc.durationDays} days, valid until ${formatDocDate(doc.validUntil)}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'workPass':
        return `Work pass ${doc.number}: ${doc.employer}, ${doc.field}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'healthCert':
        return `Health certificate ${doc.number}: ${doc.vaccine} on ${formatDocDate(doc.vaccinatedOn)}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'idCard':
        return `Identity card ${doc.number}: district ${doc.district}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'diplomaticAuth':
        return `Diplomatic authorization ${doc.number}${doc.tamperNote ? ` [${doc.tamperNote}]` : ''}`
      case 'letter':
        return `Letter "${doc.title}" from ${doc.sender}${doc.authentic ? '' : ' [forged]'}`
    }
  })
  const extra = applicant.hidden.map((h) => `Concealed on the body: ${h.label}`)
  return {
    applicantId: applicant.id,
    kind: applicant.kind,
    presentedName: presentedName(applicant),
    trueName: displayName(truth),
    trueNationality: countryName(truth.nationality),
    truePurpose: truth.purpose,
    occupation: truth.occupation,
    demeanor: plan.persona.demeanor,
    backstory: plan.persona.backstory,
    coverStory: plan.persona.cover_story,
    privateIntent: plan.private_intent,
    coordinationNote: plan.coordination_note,
    documents: [
      ...documents,
      ...extra,
      `Luggage: ${applicant.appearance.luggage.map((l) => l.label).join(', ')}`,
    ],
    secrets: applicant.violations.map((v) => v.message),
    techniques: applicant.techniques.map((t) => `${t.type}: ${t.note}`),
    lever: plan.lever,
    scriptedLines: plan.scripted_lines,
    openingLine: plan.opening_line,
  }
}
