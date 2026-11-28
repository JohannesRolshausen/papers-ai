// Pure debrief computation and JSON export builder.
// Reads GameState after a completed or dismissed run and produces metrics, rating,
// day-by-day adversary strategies, per-applicant truth with used/unused evidence,
// recurring character arcs, and adversary planner logs.

import type { ApplicantResult } from '../ai/adversary'
import type { ClaudeDayLog, PlanFailure } from '../ai/claudeAdversary'
import { isClaudeMemory } from '../ai/claudeAdversary'
import type { CampaignPhase, OfflineJournalEntry } from '../ai/offlineAdversary'
import { isOfflineMemory } from '../ai/offlineAdversary'
import { BASE_PROBLEMS, QUIRKS, TECHNIQUES } from '../ai/schema'
import type { DifficultyId, ToolId } from '../config'
import { CONSEQUENCES, DEEP_CHECK_MINUTES, ECONOMY, TOOL_NAMES } from '../config'
import { leverOutcome, sabotageFrom } from './consequences'
import { charsPerMinute } from './docLines'
import { DOC_TITLES, displayName } from './documents'
import type { FaceSpec } from './faces'
import { applicantResult, emptyToolUsage, flaggedCodes } from './observations'
import { findDocument } from './people'
import type { SealDifference, SealSpec } from './seals'
import { AUTHORITY_NAMES, sealDifferences, sealMatchesAny } from './seals'
import type {
  AiMode,
  Applicant,
  ApplicantOutcome,
  CharacterAppearance,
  DayRecord,
  EvidenceDifficulty,
  EvidenceTool,
  GameEvent,
  GameState,
  IncidentKind,
  PersonTruth,
  StoredPlan,
  ViolationCode,
} from './types'

// ---------- Rating ----------

export type RatingGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

export interface DebriefRating {
  grade: RatingGrade
  title: string
  summary: string
  score: number
}

// ---------- Metrics ----------

export interface DebriefMetrics {
  daysPlayed: number
  daysTotal: number
  fired: boolean
  applicantsTotal: number
  processed: number
  notProcessed: number
  infiltratorsAttempted: number
  infiltratorsThrough: number
  infiltratorsStopped: number
  infiltratorsUnprocessed: number
  infiltratorsNeverCaughtInland: number
  legitTotal: number
  legitAdmitted: number
  legitDenied: number
  legitUnprocessed: number
  deepCheckCount: number
  deepCheckMinutes: number
  deepCheckTypingMs: number
  incidentReportCount: number
  typingForms: number
  typingChars: number
  typingTypos: number
  typingMs: number
  // chars / (chars + typos), or null when no forms were typed
  typingAccuracy: number | null
  // Characters per minute across all typed forms, or null when no timed typing occurred
  typingCpm: number | null
  toolUsage: Record<ToolId, number>
  startingMoney: number
  money: number
  totalIncome: number
  totalExpenses: number
  finesTotal: number
  bribesOffered: number
  bribesTaken: number
  bribesMoneyKept: number
  rating: DebriefRating
}

// ---------- Per-applicant truth ----------

export interface DebriefEvidence {
  violationCode: ViolationCode
  violationMessage: string
  docId: string | null
  tool: EvidenceTool
  toolLabel: string
  difficulty: EvidenceDifficulty
  description: string
  // True when the player used this evidence's tool and uncovered this violation (or questioned)
  used: boolean
  // True when the violation was uncovered by at least one tool
  violationFound: boolean
  // True when this is conclusive evidence that the player did not use
  unused: boolean
  // True when conclusive evidence was unused and either the violation went uncaught or infiltrator passed
  criticalMiss: boolean
}

export interface DebriefToolUse {
  tool: ToolId | 'report'
  label: string
  count: number
  detail: string | null
}

export interface DebriefSealComparison {
  docId: string
  docTitle: string
  authorityName: string
  forged: SealSpec
  valid: SealSpec[]
  differences: SealDifference[]
}

export interface DebriefApplicant {
  day: number
  slot: number
  applicant: Applicant
  outcome: ApplicantOutcome
  result: ApplicantResult
  shownName: string
  trueIdentity: PersonTruth | null
  trueName: string | null
  identityDiffers: boolean
  passportPhoto: FaceSpec | null
  forgedSeals: DebriefSealComparison[]
  character: {
    id: string
    nickname: string
    mode: CharacterAppearance['mode']
  } | null
  baseProblemLabel: string | null
  legitQuirkDescription: string | null
  techniques: {
    type: string
    label: string
    cost: number
    note: string
  }[]
  evidence: DebriefEvidence[]
  unusedEvidenceCount: number
  criticalMissCount: number
  toolsUsed: DebriefToolUse[]
  leverSummary: string | null
  consequences: GameEvent[]
  caughtInlandDay: number | null
}

// ---------- Per-day timeline ----------

export interface DebriefDay {
  dayIndex: number
  date: string
  headline: string
  rulesCount: number
  notice: string | null
  source: StoredPlan['source']
  model: string | null
  requestedModel: string | null
  serverFallback: boolean
  fallbackReason: PlanFailure | null
  offlinePhase: CampaignPhase | null
  strategySummary: string
  notesForFutureSelf: string
  costSpent: number
  issues: string[]
  events: GameEvent[]
  infiltratorsAttempted: number
  infiltratorsThrough: number
  infiltratorsStopped: number
  legitDenied: number
  processed: number
  notProcessed: number
  applicants: DebriefApplicant[]
}

// ---------- Recurring character arcs ----------

export interface DebriefCharacterAppearance {
  day: number
  applicantId: string
  mode: CharacterAppearance['mode']
  kind: 'legit' | 'infiltrator'
  decision: ApplicantOutcome['decision']
  result: ApplicantResult
  baseProblemLabel: string | null
  techniques: string[]
  privateIntent: string
  appearanceFace: FaceSpec | null
  caughtInlandDay: number | null
}

export interface DebriefCharacter {
  id: string
  nickname: string
  introducedDay: number
  truePerson: PersonTruth | null
  trueName: string
  appearances: DebriefCharacterAppearance[]
  arcSummary: string
}

// ---------- Adversary memory / log ----------

export interface ClaudeTurnSummary {
  turn: number
  day: number | null
  model: string | null
  thinking: string | null
  responsePreview: string
}

export interface DebriefAdversary {
  mode: AiMode
  model: string | null
  totalCostSpent: number
  fallbackDays: number
  claudeLog: ClaudeDayLog[]
  claudeTurns: ClaudeTurnSummary[]
  offlineJournal: OfflineJournalEntry[]
}

// ---------- Full debrief report ----------

export interface DebriefReport {
  seed: number
  difficulty: DifficultyId
  kind: 'final' | 'gameover'
  createdAt: string
  metrics: DebriefMetrics
  days: DebriefDay[]
  characters: DebriefCharacter[]
  adversary: DebriefAdversary
}

// ---------- Helpers ----------

export const EVIDENCE_TOOL_LABELS: Record<EvidenceTool, string> = {
  inspect: TOOL_NAMES.inspect,
  fingerprints: TOOL_NAMES.fingerprints,
  registry: TOOL_NAMES.registry,
  bodyScan: TOOL_NAMES.bodyScan,
  verifyLetter: TOOL_NAMES.verifyLetter,
  interrogate: TOOL_NAMES.questions,
}

const INCIDENT_SHORT: Record<IncidentKind, string> = {
  threat: 'threat',
  bribe: 'bribe',
  letter: 'letter',
}

function emptyOutcomeFor(applicant: Applicant): ApplicantOutcome {
  return {
    applicantId: applicant.id,
    decision: 'none',
    documentedReason: null,
    minutesSpent: 0,
    actions: [],
    bribeAccepted: false,
    reported: [],
    correct: null,
    leverPresented: false,
  }
}

function truePersonName(person: PersonTruth | null): string | null {
  return person ? `${person.surname.toUpperCase()}, ${person.given}` : null
}

function evidenceWasUsed(
  tool: EvidenceTool,
  violationCode: ViolationCode,
  docId: string | null,
  outcome: ApplicantOutcome,
): boolean {
  switch (tool) {
    case 'inspect':
      return outcome.actions.some((a) => a.type === 'inspect' && a.found === violationCode)
    case 'registry':
    case 'verifyLetter':
      return outcome.actions.some(
        (a) =>
          a.type === 'deepCheck' &&
          a.tool === tool &&
          (a.revealed.includes(violationCode) || (docId !== null && a.docId === docId)),
      )
    case 'fingerprints':
    case 'bodyScan':
      return outcome.actions.some((a) => a.type === 'deepCheck' && a.tool === tool)
    case 'interrogate':
      return outcome.actions.some((a) => a.type === 'question')
  }
}

function summarizeToolsUsed(outcome: ApplicantOutcome): DebriefToolUse[] {
  const result: DebriefToolUse[] = []
  let inspectCount = 0
  let inspectHits = 0
  let questionCount = 0
  const deepCounts = new Map<ToolId, { count: number; revealed: number }>()
  const reports: IncidentKind[] = []

  for (const action of outcome.actions) {
    if (action.type === 'inspect') {
      inspectCount += 1
      if (action.found) inspectHits += 1
    } else if (action.type === 'question') {
      questionCount += 1
    } else if (action.type === 'deepCheck') {
      const entry = deepCounts.get(action.tool) ?? { count: 0, revealed: 0 }
      entry.count += 1
      entry.revealed += action.revealed.length
      deepCounts.set(action.tool, entry)
    } else if (action.type === 'report') {
      reports.push(action.incident)
    }
  }

  if (inspectCount > 0) {
    result.push({
      tool: 'inspect',
      label: TOOL_NAMES.inspect,
      count: inspectCount,
      detail: inspectHits > 0 ? `${inspectHits} hit${inspectHits === 1 ? '' : 's'}` : 'no hit',
    })
  }
  if (questionCount > 0) {
    result.push({
      tool: 'questions',
      label: TOOL_NAMES.questions,
      count: questionCount,
      detail: `${questionCount} asked`,
    })
  }
  for (const tool of ['registry', 'fingerprints', 'bodyScan', 'verifyLetter'] as const) {
    const entry = deepCounts.get(tool)
    if (!entry) continue
    result.push({
      tool,
      label: TOOL_NAMES[tool],
      count: entry.count,
      detail:
        entry.revealed > 0
          ? `${entry.revealed} finding${entry.revealed === 1 ? '' : 's'}`
          : 'clear',
    })
  }
  if (reports.length > 0) {
    result.push({
      tool: 'report',
      label: 'Incident Report',
      count: reports.length,
      detail: reports.map((r) => INCIDENT_SHORT[r]).join(', '),
    })
  }
  return result
}

function collectForgedSeals(day: DayRecord, applicant: Applicant): DebriefSealComparison[] {
  const result: DebriefSealComparison[] = []
  for (const doc of applicant.documents) {
    if (!doc.seal) continue
    const valid = day.context.validSeals[doc.seal.authority] ?? []
    if (valid.length === 0 || sealMatchesAny(doc.seal, valid)) continue
    const reference = valid[0] as SealSpec
    result.push({
      docId: doc.id,
      docTitle: doc.type === 'letter' ? doc.title : DOC_TITLES[doc.type],
      authorityName: AUTHORITY_NAMES[doc.seal.authority],
      forged: doc.seal,
      valid: [...valid],
      differences: sealDifferences(doc.seal, reference),
    })
  }
  return result
}

export function computeRating(input: {
  fired: boolean
  infiltratorsAttempted: number
  infiltratorsThrough: number
  legitTotal: number
  legitDenied: number
  processed: number
  applicantsTotal: number
  bribesTaken: number
}): DebriefRating {
  if (input.fired) {
    return {
      grade: 'F',
      title: 'DISMISSED',
      summary: 'Removed from Checkpoint Seven after consecutive days in debt.',
      score: 0,
    }
  }
  const catchRate =
    input.infiltratorsAttempted > 0
      ? (input.infiltratorsAttempted - input.infiltratorsThrough) / input.infiltratorsAttempted
      : 1
  const legitErrorRate = input.legitTotal > 0 ? input.legitDenied / input.legitTotal : 0
  const coverage = input.applicantsTotal > 0 ? input.processed / input.applicantsTotal : 1

  let score = 100
  score -= input.infiltratorsThrough * 18
  score -= input.legitDenied * 8
  score -= input.bribesTaken * 10
  score -= Math.round((1 - coverage) * 20)
  score = Math.max(0, Math.min(100, score))

  if (
    input.infiltratorsThrough === 0 &&
    input.legitDenied === 0 &&
    input.bribesTaken === 0 &&
    coverage >= 0.9
  ) {
    return {
      grade: 'S',
      title: 'EXEMPLARY',
      summary: 'No infiltrators admitted, no legitimate travelers turned away, clean conduct.',
      score,
    }
  }
  if (
    input.infiltratorsThrough === 0 &&
    input.legitDenied <= 1 &&
    legitErrorRate <= 0.05 &&
    input.bribesTaken === 0
  ) {
    return {
      grade: 'A',
      title: 'COMMENDABLE',
      summary: 'Every infiltrator was stopped with minimal disruption to legitimate travel.',
      score,
    }
  }
  if (
    (input.infiltratorsThrough <= 1 || catchRate >= 0.85) &&
    legitErrorRate <= 0.12 &&
    score >= 65
  ) {
    return {
      grade: 'B',
      title: 'SATISFACTORY',
      summary: 'Solid oversight overall, though a few blind spots remained for the adversary.',
      score,
    }
  }
  if (catchRate >= 0.65 && legitErrorRate <= 0.25 && score >= 40) {
    return {
      grade: 'C',
      title: 'UNDER REVIEW',
      summary: 'Notable breaches or false denials. The adversary found openings in your routine.',
      score,
    }
  }
  return {
    grade: 'D',
    title: 'COMPROMISED',
    summary: 'Heavy breaches at Checkpoint Seven. The network repeatedly bypassed inspection.',
    score,
  }
}

function extractClaudeTurns(
  state: GameState,
  claudeLog: readonly ClaudeDayLog[],
): ClaudeTurnSummary[] {
  if (!isClaudeMemory(state.adversaryMemory)) return []
  const claudeDays = claudeLog.filter((l) => l.source === 'claude')
  const turns: ClaudeTurnSummary[] = []
  const messages = state.adversaryMemory.messages
  for (let i = 1; i < messages.length; i += 2) {
    const assistant = messages[i]
    const turnIndex = (i - 1) / 2
    const logEntry = claudeDays[turnIndex]
    let thinking: string | null = null
    let responseText = ''
    if (assistant) {
      if (typeof assistant.content === 'string') {
        responseText = assistant.content
      } else if (Array.isArray(assistant.content)) {
        const thinkingParts: string[] = []
        const textParts: string[] = []
        for (const block of assistant.content) {
          if (!block || typeof block !== 'object') continue
          const b = block as { type?: string; thinking?: unknown; text?: unknown }
          if (b.type === 'thinking' && typeof b.thinking === 'string') {
            thinkingParts.push(b.thinking)
          } else if (b.type === 'text' && typeof b.text === 'string') {
            textParts.push(b.text)
          }
        }
        if (thinkingParts.length > 0) thinking = thinkingParts.join('\n\n')
        responseText = textParts.join('\n')
      }
    }
    turns.push({
      turn: turnIndex + 1,
      day: logEntry?.day ?? null,
      model: logEntry?.model ?? null,
      thinking,
      responsePreview: responseText.length > 800 ? `${responseText.slice(0, 800)}…` : responseText,
    })
  }
  return turns
}

function summarizeCharacterArc(appearances: readonly DebriefCharacterAppearance[]): string {
  if (appearances.length === 0) return 'Never appeared.'
  const honest = appearances.filter((a) => a.kind === 'legit').length
  const turned = appearances.filter((a) => a.mode === 'reuse' && a.kind === 'infiltrator')
  const impersonated = appearances.filter((a) => a.mode === 'impersonate')
  const parts: string[] = []
  if (honest > 0) parts.push(`${honest} honest ${honest === 1 ? 'visit' : 'visits'}`)
  for (const t of turned) {
    parts.push(
      `turned infiltrator on Day ${t.day} (${t.result === 'got_through' ? 'got through' : t.result === 'stopped' ? 'stopped' : 'unprocessed'})`,
    )
  }
  for (const imp of impersonated) {
    parts.push(
      `impersonated on Day ${imp.day} (${imp.result === 'got_through' ? 'got through' : imp.result === 'stopped' ? 'stopped' : 'unprocessed'})`,
    )
  }
  if (parts.length === 0) {
    const first = appearances[0] as DebriefCharacterAppearance
    parts.push(`appeared on Day ${first.day} as ${first.kind} (${first.result.replace(/_/g, ' ')})`)
  }
  return `${parts.join(', ')}.`
}

// ---------- Main builder ----------

export function buildDebrief(state: GameState): DebriefReport {
  const closedDays = state.days.filter((d) => d.closed)
  const daysSource = closedDays.length > 0 ? closedDays : state.days

  // Index all events across all days by their sourceApplicantId
  const eventsByApplicant = new Map<string, GameEvent[]>()
  for (const day of state.days) {
    for (const event of day.events) {
      if (!event.sourceApplicantId) continue
      const list = eventsByApplicant.get(event.sourceApplicantId) ?? []
      list.push(event)
      eventsByApplicant.set(event.sourceApplicantId, list)
    }
  }

  // Adversary logs from memory
  const claudeLog: ClaudeDayLog[] = isClaudeMemory(state.adversaryMemory)
    ? [...state.adversaryMemory.log]
    : []
  const claudeLogByDay = new Map<number, ClaudeDayLog>(claudeLog.map((l) => [l.day, l]))

  const offlineJournal: OfflineJournalEntry[] = isOfflineMemory(state.adversaryMemory)
    ? [...state.adversaryMemory.journal]
    : isClaudeMemory(state.adversaryMemory) && isOfflineMemory(state.adversaryMemory.offline)
      ? [...state.adversaryMemory.offline.journal]
      : []
  const offlineByDay = new Map<number, OfflineJournalEntry>(offlineJournal.map((j) => [j.day, j]))

  // Map applicantId -> character appearance mode
  const charAppearanceByApplicant = new Map<
    string,
    { id: string; nickname: string; mode: CharacterAppearance['mode'] }
  >()
  for (const char of Object.values(state.world.characters)) {
    for (const app of char.appearances) {
      charAppearanceByApplicant.set(app.applicantId, {
        id: char.id,
        nickname: char.nickname,
        mode: app.mode,
      })
    }
  }

  const toolUsage = emptyToolUsage()
  let applicantsTotal = 0
  let processed = 0
  let infiltratorsAttempted = 0
  let infiltratorsThrough = 0
  let infiltratorsStopped = 0
  let infiltratorsUnprocessed = 0
  let infiltratorsNeverCaughtInland = 0
  let legitTotal = 0
  let legitAdmitted = 0
  let legitDenied = 0
  let legitUnprocessed = 0
  let deepCheckCount = 0
  let deepCheckMinutes = 0
  let deepCheckTypingMs = 0
  let incidentReportCount = 0
  let typingForms = 0
  let typingChars = 0
  let typingTypos = 0
  let typingMs = 0
  let bribesOffered = 0
  let bribesTaken = 0
  let bribesMoneyKept = 0
  let totalCostSpent = 0
  let fallbackDays = 0

  const applicantIndex = new Map<string, DebriefApplicant>()
  const days: DebriefDay[] = []

  for (const day of daysSource) {
    const sabotage = sabotageFrom(day.events)
    const logEntry = claudeLogByDay.get(day.dayIndex) ?? null
    const offlineEntry = offlineByDay.get(day.dayIndex) ?? null
    totalCostSpent += day.plan.costSpent
    if (day.plan.source === 'fallback') fallbackDays += 1

    let dayInfAttempted = 0
    let dayInfThrough = 0
    let dayInfStopped = 0
    let dayLegitDenied = 0
    let dayProcessed = 0
    const debriefApplicants: DebriefApplicant[] = []

    day.applicants.forEach((applicant, idx) => {
      const outcome = day.outcomes[idx] ?? emptyOutcomeFor(applicant)
      const result = applicantResult(applicant, outcome)
      applicantsTotal += 1
      if (outcome.decision !== 'none') {
        processed += 1
        dayProcessed += 1
      }

      if (applicant.plan.lever.type === 'bribe') bribesOffered += 1
      if (outcome.bribeAccepted && outcome.decision === 'approve') {
        bribesTaken += 1
        if (applicant.plan.lever.real && applicant.plan.lever.amount) {
          bribesMoneyKept += applicant.plan.lever.amount
        }
      }

      const consequences = eventsByApplicant.get(applicant.id) ?? []
      const inlandEvent = consequences.find((e) => e.kind === 'late_discovery')
      const caughtInlandDay = inlandEvent?.day ?? null

      if (!applicant.admissible) {
        infiltratorsAttempted += 1
        dayInfAttempted += 1
        if (result === 'got_through') {
          infiltratorsThrough += 1
          dayInfThrough += 1
          if (caughtInlandDay === null) infiltratorsNeverCaughtInland += 1
        } else if (result === 'stopped') {
          infiltratorsStopped += 1
          dayInfStopped += 1
        } else {
          infiltratorsUnprocessed += 1
        }
      } else {
        legitTotal += 1
        if (result === 'legit_admitted') legitAdmitted += 1
        else if (result === 'legit_denied') {
          legitDenied += 1
          dayLegitDenied += 1
        } else legitUnprocessed += 1
      }

      for (const action of outcome.actions) {
        if (action.type === 'inspect') {
          toolUsage.inspect += 1
        } else if (action.type === 'question') {
          toolUsage.questions += 1
        } else if (action.type === 'deepCheck') {
          toolUsage[action.tool] += 1
          deepCheckCount += 1
          const mult = sabotage[action.tool] === 'slow' ? CONSEQUENCES.sabotageSlowFactor : 1
          deepCheckMinutes += DEEP_CHECK_MINUTES[action.tool] * mult
          deepCheckTypingMs += action.typedMs
          typingForms += 1
          typingChars += action.chars
          typingTypos += action.typos
          typingMs += action.typedMs
        } else if (action.type === 'report') {
          incidentReportCount += 1
          typingForms += 1
          typingChars += action.chars
          typingTypos += action.typos
          typingMs += action.typedMs
        }
      }

      const foundCodes = new Set(flaggedCodes(outcome))
      const evidence: DebriefEvidence[] = []
      for (const v of applicant.violations) {
        const violationFound = foundCodes.has(v.code)
        for (const e of v.evidence) {
          const used = evidenceWasUsed(e.tool, v.code, v.docId, outcome)
          const unused = !used && e.tool !== 'interrogate'
          const criticalMiss = unused && (!violationFound || result === 'got_through')
          evidence.push({
            violationCode: v.code,
            violationMessage: v.message,
            docId: v.docId,
            tool: e.tool,
            toolLabel: EVIDENCE_TOOL_LABELS[e.tool],
            difficulty: e.difficulty,
            description: e.description,
            used,
            violationFound,
            unused,
            criticalMiss,
          })
        }
      }

      const passport = findDocument(applicant.documents, 'passport')
      const trueIdentity = state.world.persons[applicant.personId] ?? null
      const trueName = truePersonName(trueIdentity)
      const shownName = passport ? displayName(passport) : (trueName ?? 'Unidentified traveler')
      const identityDiffers =
        trueIdentity !== null &&
        ((passport !== undefined &&
          (passport.surname !== trueIdentity.surname || passport.given !== trueIdentity.given)) ||
          applicant.techniques.some((t) => t.type === 'borrowed_identity') ||
          applicant.plan.recurring.mode === 'impersonate')

      const charInfo = charAppearanceByApplicant.get(applicant.id) ?? null
      const baseProblemLabel = applicant.baseProblem
        ? BASE_PROBLEMS[applicant.baseProblem].label
        : null
      const legitQuirkDescription =
        applicant.kind === 'legit' && applicant.plan.legit_quirk !== 'none'
          ? QUIRKS[applicant.plan.legit_quirk].description
          : null

      const entry: DebriefApplicant = {
        day: day.dayIndex,
        slot: applicant.slot,
        applicant,
        outcome,
        result,
        shownName,
        trueIdentity,
        trueName,
        identityDiffers,
        passportPhoto: passport?.photo ?? null,
        forgedSeals: collectForgedSeals(day, applicant),
        character: charInfo,
        baseProblemLabel,
        legitQuirkDescription,
        techniques: applicant.techniques.map((t) => ({
          type: t.type,
          label: TECHNIQUES[t.type].label,
          cost: t.cost,
          note: t.note,
        })),
        evidence,
        unusedEvidenceCount: evidence.filter((e) => e.unused).length,
        criticalMissCount: evidence.filter((e) => e.criticalMiss).length,
        toolsUsed: summarizeToolsUsed(outcome),
        leverSummary: leverOutcome(applicant, outcome),
        consequences,
        caughtInlandDay,
      }
      applicantIndex.set(applicant.id, entry)
      debriefApplicants.push(entry)
    })

    const requestedModel = state.settings.aiMode === 'claude' ? state.settings.model : null
    const actualModel = logEntry?.model ?? (day.plan.source === 'claude' ? requestedModel : null)
    days.push({
      dayIndex: day.dayIndex,
      date: day.context.date,
      headline: day.context.bulletin.headline,
      rulesCount: day.context.rules.length,
      notice: day.notice,
      source: day.plan.source,
      model: actualModel,
      requestedModel,
      serverFallback:
        actualModel !== null && requestedModel !== null && actualModel !== requestedModel,
      fallbackReason: logEntry?.reason ?? null,
      offlinePhase: offlineEntry?.phase ?? null,
      strategySummary: day.plan.plan.strategy_summary,
      notesForFutureSelf: day.plan.plan.notes_for_future_self,
      costSpent: day.plan.costSpent,
      issues: [...day.plan.issues],
      events: [...day.events],
      infiltratorsAttempted: dayInfAttempted,
      infiltratorsThrough: dayInfThrough,
      infiltratorsStopped: dayInfStopped,
      legitDenied: dayLegitDenied,
      processed: dayProcessed,
      notProcessed: day.applicants.length - dayProcessed,
      applicants: debriefApplicants,
    })
  }

  // Economy totals
  const totalIncome = state.economy.ledger
    .filter((l) => l.amount > 0)
    .reduce((sum, l) => sum + l.amount, 0)
  const totalExpenses = state.economy.ledger
    .filter((l) => l.amount < 0)
    .reduce((sum, l) => sum + Math.abs(l.amount), 0)
  const finesTotal = state.days
    .flatMap((d) => d.events)
    .filter((e) => e.moneyDelta < 0)
    .reduce((sum, e) => sum + Math.abs(e.moneyDelta), 0)

  const typingAccuracy = typingChars > 0 ? typingChars / (typingChars + typingTypos) : null
  const typingCpm = typingChars > 0 && typingMs > 0 ? charsPerMinute(typingChars, typingMs) : null
  const fired = state.phase === 'gameover'

  const rating = computeRating({
    fired,
    infiltratorsAttempted,
    infiltratorsThrough,
    legitTotal,
    legitDenied,
    processed,
    applicantsTotal,
    bribesTaken,
  })

  // Recurring character arcs
  const characters: DebriefCharacter[] = Object.values(state.world.characters)
    .sort((a, b) => a.introducedDay - b.introducedDay || a.id.localeCompare(b.id))
    .map((char) => {
      const truePerson = state.world.persons[char.personId] ?? null
      const appearances: DebriefCharacterAppearance[] = char.appearances.map((app) => {
        const entry = applicantIndex.get(app.applicantId)
        return {
          day: app.day,
          applicantId: app.applicantId,
          mode: app.mode,
          kind: app.kind,
          decision: entry?.outcome.decision ?? 'none',
          result: entry?.result ?? 'not_processed',
          baseProblemLabel: entry?.baseProblemLabel ?? null,
          techniques: entry?.techniques.map((t) => t.label) ?? [],
          privateIntent: entry?.applicant.plan.private_intent ?? '',
          appearanceFace: entry?.applicant.appearance.face ?? null,
          caughtInlandDay: entry?.caughtInlandDay ?? null,
        }
      })
      return {
        id: char.id,
        nickname: char.nickname,
        introducedDay: char.introducedDay,
        truePerson,
        trueName: truePersonName(truePerson) ?? char.nickname,
        appearances,
        arcSummary: summarizeCharacterArc(appearances),
      }
    })

  const adversary: DebriefAdversary = {
    mode: state.settings.aiMode,
    model: state.settings.aiMode === 'claude' ? state.settings.model : null,
    totalCostSpent,
    fallbackDays,
    claudeLog,
    claudeTurns: extractClaudeTurns(state, claudeLog),
    offlineJournal,
  }

  return {
    seed: state.seed,
    difficulty: state.difficulty,
    kind: fired ? 'gameover' : 'final',
    createdAt: state.createdAt,
    metrics: {
      daysPlayed: days.length,
      daysTotal: state.daysTotal,
      fired,
      applicantsTotal,
      processed,
      notProcessed: applicantsTotal - processed,
      infiltratorsAttempted,
      infiltratorsThrough,
      infiltratorsStopped,
      infiltratorsUnprocessed,
      infiltratorsNeverCaughtInland,
      legitTotal,
      legitAdmitted,
      legitDenied,
      legitUnprocessed,
      deepCheckCount,
      deepCheckMinutes,
      deepCheckTypingMs,
      incidentReportCount,
      typingForms,
      typingChars,
      typingTypos,
      typingMs,
      typingAccuracy,
      typingCpm,
      toolUsage,
      startingMoney: ECONOMY.startingMoney,
      money: state.economy.money,
      totalIncome,
      totalExpenses,
      finesTotal,
      bribesOffered,
      bribesTaken,
      bribesMoneyKept,
      rating,
    },
    days,
    characters,
    adversary,
  }
}

// ---------- JSON Export ----------

export function debriefFilename(state: Pick<GameState, 'seed' | 'difficulty'>): string {
  return `oversight-debrief-${state.difficulty}-seed-${state.seed}.json`
}

// Builds a clean, self-contained JSON payload for download. Never includes any API key.
export function buildDebriefExport(
  state: GameState,
  report: DebriefReport = buildDebrief(state),
): Record<string, unknown> {
  return {
    game: 'OVERSIGHT',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    meta: {
      seed: state.seed,
      difficulty: state.difficulty,
      daysPlayed: report.metrics.daysPlayed,
      daysTotal: state.daysTotal,
      outcome: report.kind,
      aiMode: state.settings.aiMode,
      model: state.settings.aiMode === 'claude' ? state.settings.model : null,
      shiftRealSeconds: state.settings.shiftRealSeconds,
      createdAt: state.createdAt,
    },
    metrics: report.metrics,
    days: report.days.map((d) => ({
      dayIndex: d.dayIndex,
      date: d.date,
      headline: d.headline,
      source: d.source,
      model: d.model,
      serverFallback: d.serverFallback,
      fallbackReason: d.fallbackReason,
      offlinePhase: d.offlinePhase,
      costSpent: d.costSpent,
      strategySummary: d.strategySummary,
      notesForFutureSelf: d.notesForFutureSelf,
      issues: d.issues,
      notice: d.notice,
      events: d.events,
      applicants: d.applicants.map((a) => ({
        id: a.applicant.id,
        slot: a.slot,
        shownName: a.shownName,
        trueName: a.trueName,
        identityDiffers: a.identityDiffers,
        kind: a.applicant.kind,
        admissible: a.applicant.admissible,
        baseProblem: a.applicant.baseProblem,
        baseProblemLabel: a.baseProblemLabel,
        legitQuirk: a.applicant.plan.legit_quirk,
        character: a.character,
        techniques: a.techniques,
        notes: a.applicant.notes,
        privateIntent: a.applicant.plan.private_intent,
        coordinationNote: a.applicant.plan.coordination_note,
        lever: a.applicant.plan.lever,
        leverSummary: a.leverSummary,
        documents: a.applicant.documents.map((doc) => ({
          id: doc.id,
          type: doc.type,
          provenance: doc.provenance,
          tamperNote: doc.tamperNote,
        })),
        evidence: a.evidence,
        decision: a.outcome.decision,
        documentedReason: a.outcome.documentedReason,
        result: a.result,
        minutesSpent: a.outcome.minutesSpent,
        bribeAccepted: a.outcome.bribeAccepted,
        reported: a.outcome.reported,
        toolsUsed: a.toolsUsed,
        actions: a.outcome.actions,
        caughtInlandDay: a.caughtInlandDay,
        consequences: a.consequences,
      })),
    })),
    characters: report.characters.map((c) => ({
      id: c.id,
      nickname: c.nickname,
      trueName: c.trueName,
      introducedDay: c.introducedDay,
      arcSummary: c.arcSummary,
      appearances: c.appearances.map((a) => ({
        day: a.day,
        applicantId: a.applicantId,
        mode: a.mode,
        kind: a.kind,
        decision: a.decision,
        result: a.result,
        baseProblemLabel: a.baseProblemLabel,
        techniques: a.techniques,
        privateIntent: a.privateIntent,
        caughtInlandDay: a.caughtInlandDay,
      })),
    })),
    adversary: {
      mode: report.adversary.mode,
      model: report.adversary.model,
      totalCostSpent: report.adversary.totalCostSpent,
      fallbackDays: report.adversary.fallbackDays,
      claudeLog: report.adversary.claudeLog,
      offlineJournal: report.adversary.offlineJournal,
      claudeConversation: isClaudeMemory(state.adversaryMemory)
        ? state.adversaryMemory.messages
        : null,
    },
  }
}
