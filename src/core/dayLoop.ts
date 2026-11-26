// The shift controller. It runs the days of a game without any DOM: morning, shift, evening.
// Time is counted in game minutes. The interface turns real seconds into game minutes and
// calls advanceClock. Every action with a fixed cost advances the clock itself.

import type {
  Adversary,
  DayObservation,
  InspectorQuestion,
  PersonaDossier,
  PlanResult,
  TranscriptLine,
} from '../ai/adversary'
import { buildDossier } from '../ai/adversary'
import { buildBriefing } from '../ai/briefing'
import { answerQuestion, defaultLeverLine, discrepancyQuestion } from '../ai/dialogueTemplates'
import type { DayPlan, LineTrigger } from '../ai/schema'
import { DayPlanSchema } from '../ai/schema'
import type { DeepToolId, ToolId } from '../config'
import {
  AI_BUDGET,
  CONSEQUENCES,
  DEEP_CHECK_MINUTES,
  DEEP_TOOL_IDS,
  FREE_QUESTION_MAX_LENGTH,
  INCIDENT_REPORT_MINUTES,
  INSPECT_MINUTES,
  QUESTION_MINUTES,
  SHIFT,
} from '../config'
import type { ConsequenceOdds } from './consequences'
import {
  DEFAULT_ODDS,
  applyDueConsequences,
  minutesLostFrom,
  resolveDayConsequences,
  sabotageFrom,
} from './consequences'
import type { FormKind, TypingResult } from './docLines'
import {
  INCIDENT_LABELS,
  REASON_CHOICES,
  buildDocLine,
  compareTyping,
  plainUpper,
  reasonFromCode,
  subjectName,
} from './docLines'
import type { Letter, NumberedDocument } from './documents'
import { isNumbered } from './documents'
import type { EveningReport } from './economy'
import { applyEventMoney, eveningReport, settleDay } from './economy'
import { observationHistory } from './observations'
import { findDocument } from './people'
import { rngFor } from './rng'
import { contextForDay, grantDailyBudget, prepareDay } from './state'
import type {
  Applicant,
  ApplicantOutcome,
  Bulletin,
  DayContext,
  DayRecord,
  Decision,
  Evidence,
  EvidenceTool,
  GameEvent,
  GameState,
  IncidentKind,
  PlayerAction,
  SabotageMode,
  StandardQuestion,
  Violation,
  ViolationCode,
} from './types'
import type { BodyScanReport, FingerprintReport, LetterReport, RegistryReport } from './validator'
import {
  bodyScanReport,
  fingerprintReport,
  matchInspection,
  registryReport,
  verifyLetterReport,
} from './validator'

// ---------- Public types ----------

export type SpeechTrigger = LineTrigger | 'opening' | 'lever' | 'answer'

export interface SpokenLine {
  trigger: SpeechTrigger
  text: string
}

export interface Discovery {
  code: ViolationCode
  violation: Violation
  via: EvidenceTool
  minute: number
}

export interface BribeOffer {
  amount: number
  accepted: boolean
  reported: boolean
}

// The person at the window. Holds the ground truth too: the interface must only show what
// the player has found out (discoveries, reports, answers).
export interface BoothSession {
  applicant: Applicant
  dossier: PersonaDossier
  calledAt: number
  actions: PlayerAction[]
  transcript: TranscriptLine[]
  discoveries: Discovery[]
  bribe: BribeOffer | null
  leverPresented: boolean
  reported: IncidentKind[]
  form: OpenForm | null
  decision: Decision | null
  closed: boolean
}

export interface OpenForm {
  id: string
  kind: FormKind
  docId: string | null
  incident: IncidentKind | null
  reason: string
  line: string
  openedAt: number
}

export type DeepCheckReport =
  | { tool: 'registry'; report: RegistryReport }
  | { tool: 'fingerprints'; report: FingerprintReport }
  | { tool: 'bodyScan'; report: BodyScanReport }
  | { tool: 'verifyLetter'; report: LetterReport }

export type ActionError =
  | 'wrong_phase'
  | 'shift_over'
  | 'no_applicant'
  | 'applicant_waiting'
  | 'queue_empty'
  | 'busy'
  | 'tool_locked'
  | 'tool_down'
  | 'needs_document'
  | 'no_letter'
  | 'unknown_discrepancy'
  | 'question_empty'
  | 'question_too_long'
  | 'no_form'
  | 'typing_incomplete'
  | 'no_bribe'

export interface Rejection {
  ok: false
  error: ActionError
  message: string
}

export type Result<T> = ({ ok: true; shiftOver: boolean } & T) | Rejection

export type ToolStatus = 'ok' | 'slow' | 'down' | 'locked'

export interface DayStart {
  record: DayRecord
  context: DayContext
  bulletin: Bulletin
  // Consequences that arrived this morning
  events: GameEvent[]
  notice: string | null
  // Supervisor reviews held this morning, with a line the interface may let the player type
  reviews: { event: GameEvent; line: string }[]
  shiftStartMinute: number
}

export type QuestionRequest =
  | { kind: StandardQuestion }
  | { kind: 'discrepancy'; code: ViolationCode }
  | { kind: 'free'; text: string }

export interface FormOptions {
  // Document for registry queries and letter checks. Defaults to the passport or the first letter.
  docId?: string
  // A discovered violation as the reason, otherwise `reason` or the first fixed reason
  code?: ViolationCode
  reason?: string
  incident?: IncidentKind
}

export type LoopEvent =
  | { type: 'day_started'; day: number; notice: string | null; events: GameEvent[] }
  | { type: 'shift_started'; day: number; minute: number }
  | { type: 'clock'; minute: number }
  | { type: 'applicant_called'; applicantId: string; slot: number; minute: number }
  | { type: 'speech'; applicantId: string; line: SpokenLine; minute: number }
  | { type: 'bribe_offered'; applicantId: string; amount: number; minute: number }
  | {
      type: 'inspection'
      applicantId: string
      keys: string[]
      found: ViolationCode | null
      minute: number
    }
  | { type: 'question'; applicantId: string; question: string; answer: string; minute: number }
  | {
      type: 'deep_check'
      applicantId: string
      tool: DeepToolId
      lines: string[]
      revealed: ViolationCode[]
      minute: number
    }
  | { type: 'incident_report'; applicantId: string; incident: IncidentKind; minute: number }
  | { type: 'bribe'; applicantId: string; accepted: boolean; minute: number }
  | { type: 'decision'; applicantId: string; decision: Decision; minute: number }
  | {
      type: 'applicant_left'
      applicantId: string
      reason: 'decided' | 'shift_over'
      minute: number
    }
  | { type: 'shift_over'; minute: number; notProcessed: number }
  | { type: 'day_closed'; report: EveningReport }

export type LoopListener = (event: LoopEvent) => void

export interface DayLoopOptions {
  // Planner and responder used when the main adversary fails, usually the offline adversary
  fallback?: Adversary
  // Chances behind consequences, only changed by tests
  odds?: ConsequenceOdds
}

export const STANDARD_QUESTIONS: Record<StandardQuestion, string> = {
  purpose: 'What is the purpose of your visit?',
  duration: 'How long will you stay?',
  stay: 'Where will you be staying?',
  occupation: 'What do you do for a living?',
  origin: 'Where are you travelling from?',
}

const ERROR_TEXT: Record<ActionError, string> = {
  wrong_phase: 'Not possible right now.',
  shift_over: 'The shift is over.',
  no_applicant: 'No one is at the window.',
  applicant_waiting: 'Decide on the person at the window first.',
  queue_empty: 'No one is left in the line.',
  busy: 'Wait for the answer first.',
  tool_locked: 'This tool is not available yet.',
  tool_down: 'This tool is out of order today.',
  needs_document: 'Choose a numbered document for the registry.',
  no_letter: 'There is no letter to verify.',
  unknown_discrepancy: 'Mark the discrepancy in inspect mode first.',
  question_empty: 'Type a question first.',
  question_too_long: `Questions can have at most ${FREE_QUESTION_MAX_LENGTH} characters.`,
  no_form: 'Open the form first.',
  typing_incomplete: 'The form still has typos or missing characters.',
  no_bribe: 'There is no envelope on the desk.',
}

function reject(error: ActionError): Rejection {
  return { ok: false, error, message: ERROR_TEXT[error] }
}

const DEEP_TOOLS = DEEP_TOOL_IDS as readonly string[]

function isDeepTool(kind: FormKind): kind is DeepToolId {
  return DEEP_TOOLS.includes(kind)
}

// ---------- Controller ----------

interface ShiftState {
  clock: number
  nextIndex: number
  over: boolean
  session: BoothSession | null
  outcomes: Map<string, ApplicantOutcome>
  serial: number
  fired: Set<string>
}

export class DayLoop {
  readonly state: GameState
  readonly adversary: Adversary
  private readonly fallback: Adversary | null
  private readonly odds: ConsequenceOdds
  private readonly listeners = new Set<LoopListener>()
  private events: LoopEvent[] = []
  private shift: ShiftState
  private planRequest: { day: number; promise: Promise<PlanResult> } | null = null
  private busy = false

  constructor(state: GameState, adversary: Adversary, options: DayLoopOptions = {}) {
    this.state = state
    this.adversary = adversary
    this.fallback = options.fallback ?? null
    this.odds = options.odds ?? DEFAULT_ODDS
    if (state.adversaryMemory !== null) adversary.importMemory(state.adversaryMemory)
    // A save from the middle of a shift restarts that shift
    if (state.phase === 'shift') state.phase = 'bulletin'
    this.shift = this.freshShift()
  }

  // ---------- Reading ----------

  get phase(): GameState['phase'] {
    return this.state.phase
  }

  get record(): DayRecord | null {
    const last = this.state.days[this.state.days.length - 1]
    return last && last.dayIndex === this.state.dayIndex ? last : null
  }

  get context(): DayContext | null {
    return this.record?.context ?? null
  }

  get clock(): number {
    return this.shift.clock
  }

  get minutesLeft(): number {
    return Math.max(0, SHIFT.endMinute - this.shift.clock)
  }

  get shiftOver(): boolean {
    return this.shift.over
  }

  get current(): BoothSession | null {
    return this.shift.session
  }

  // People still waiting in line, in order
  get queue(): Applicant[] {
    return this.record?.applicants.slice(this.shift.nextIndex) ?? []
  }

  get log(): readonly LoopEvent[] {
    return this.events
  }

  on(listener: LoopListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  history(): DayObservation[] {
    return observationHistory(this.state)
  }

  toolStatus(tool: ToolId): ToolStatus {
    const ctx = this.context
    if (!ctx || !ctx.tools.includes(tool)) return 'locked'
    if (!DEEP_TOOLS.includes(tool)) return 'ok'
    const mode: SabotageMode | undefined = sabotageFrom(this.record?.events ?? [])[
      tool as DeepToolId
    ]
    return mode ?? 'ok'
  }

  // Fixed game minutes a deep check costs today, null if the tool cannot be used
  deepCheckMinutes(tool: DeepToolId): number | null {
    const status = this.toolStatus(tool)
    if (status === 'locked' || status === 'down') return null
    return DEEP_CHECK_MINUTES[tool] * (status === 'slow' ? CONSEQUENCES.sabotageSlowFactor : 1)
  }

  // ---------- Morning ----------

  // The day that startDay would prepare, or null if the game is over or a day is running
  nextDayIndex(): number | null {
    const s = this.state
    if (s.phase === 'evening') return s.dayIndex + 1
    if (s.phase === 'bulletin' && !this.record) return s.dayIndex
    return null
  }

  // Ask the adversary for the next plan without changing the state, to hide its latency.
  // startDay uses the same request.
  prefetchPlan(): Promise<PlanResult> | null {
    const day = this.nextDayIndex()
    return day === null ? null : this.requestPlan(day)
  }

  async startDay(): Promise<DayStart> {
    const s = this.state
    const existing = this.record
    if (s.phase === 'bulletin' && existing && !existing.closed) return this.dayStart(existing)
    const day = this.nextDayIndex()
    if (day === null) throw new Error(`Cannot start a day in phase ${s.phase}`)
    const result = await this.requestPlan(day)
    if (this.nextDayIndex() !== day) {
      const again = this.record
      if (again && again.dayIndex === day) return this.dayStart(again)
      throw new Error('The game moved on while the plan was loading')
    }
    this.planRequest = null
    s.dayIndex = day
    if (day > 1) grantDailyBudget(s)
    const ctx = contextForDay(s)
    const prepared = prepareDay(s, result.plan, result.source, ctx)
    const morning = applyDueConsequences(s, day)
    const record: DayRecord = {
      dayIndex: day,
      context: ctx,
      plan: prepared.plan,
      applicants: prepared.applicants,
      outcomes: [],
      events: morning,
      notice: result.notice,
      closed: false,
    }
    s.days.push(record)
    s.phase = 'bulletin'
    s.adversaryMemory = this.adversary.exportMemory()
    this.shift = this.freshShift()
    this.events = []
    this.emit({ type: 'day_started', day, notice: result.notice, events: morning })
    return this.dayStart(record)
  }

  beginShift(): void {
    const record = this.record
    if (this.state.phase !== 'bulletin' || !record || record.closed) {
      throw new Error(`Cannot begin a shift in phase ${this.state.phase}`)
    }
    this.shift = this.freshShift()
    this.shift.clock = SHIFT.startMinute + minutesLostFrom(record.events)
    this.state.phase = 'shift'
    this.emit({ type: 'shift_started', day: record.dayIndex, minute: this.shift.clock })
    if (this.shift.clock >= SHIFT.endMinute) this.overByClock()
  }

  // ---------- Clock ----------

  advanceClock(minutes: number): void {
    if (this.state.phase !== 'shift' || this.shift.over || !(minutes > 0)) return
    this.shift.clock = Math.min(SHIFT.endMinute, this.shift.clock + minutes)
    this.emit({ type: 'clock', minute: this.shift.clock })
    if (this.shift.clock >= SHIFT.endMinute) this.overByClock()
  }

  // ---------- The line ----------

  callNext(): Result<{ session: BoothSession; lines: SpokenLine[] }> {
    const blocked = this.shiftBlocked()
    if (blocked) return blocked
    const record = this.record as DayRecord
    if (this.shift.session) return reject('applicant_waiting')
    const applicant = record.applicants[this.shift.nextIndex]
    if (!applicant) return reject('queue_empty')
    this.shift.nextIndex += 1
    const lever = applicant.plan.lever
    const session: BoothSession = {
      applicant,
      dossier: buildDossier(applicant, this.state.world),
      calledAt: this.shift.clock,
      actions: [],
      transcript: [],
      discoveries: [],
      bribe:
        lever.type === 'bribe'
          ? { amount: lever.amount ?? 0, accepted: false, reported: false }
          : null,
      leverPresented: false,
      reported: [],
      form: null,
      decision: null,
      closed: false,
    }
    this.shift.session = session
    this.shift.fired = new Set()
    this.emit({
      type: 'applicant_called',
      applicantId: applicant.id,
      slot: applicant.slot,
      minute: this.shift.clock,
    })
    const lines: SpokenLine[] = []
    this.say(session, { trigger: 'opening', text: applicant.plan.opening_line }, lines)
    this.fire(session, 'arrival', lines)
    if (lever.type === 'bribe') this.presentLever(session, lines)
    return { ok: true, shiftOver: this.shift.over, session, lines }
  }

  // ---------- Inspect mode ----------

  inspect(keys: string[]): Result<{
    found: Violation | null
    evidence: Evidence | null
    isNew: boolean
    lines: SpokenLine[]
  }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    const match = matchInspection(s.applicant.violations, keys)
    this.record_(s, {
      type: 'inspect',
      refs: [...keys],
      found: match?.violation.code ?? null,
      minute: this.shift.clock,
    })
    this.emit({
      type: 'inspection',
      applicantId: s.applicant.id,
      keys: [...keys],
      found: match?.violation.code ?? null,
      minute: this.shift.clock,
    })
    const lines: SpokenLine[] = []
    let isNew = false
    if (match) {
      isNew = this.discover(s, match.violation, 'inspect')
      if (isNew) this.fire(s, 'discrepancy', lines)
      this.presentLever(s, lines)
    }
    this.charge(INSPECT_MINUTES)
    return {
      ok: true,
      shiftOver: this.shift.over,
      found: match?.violation ?? null,
      evidence: match?.evidence ?? null,
      isNew,
      lines,
    }
  }

  // ---------- Questions ----------

  async ask(
    request: QuestionRequest,
    onText?: (partial: string) => void,
  ): Promise<Result<{ question: InspectorQuestion; answer: string; lines: SpokenLine[] }>> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    if (this.busy) return reject('busy')
    let question: InspectorQuestion
    if (request.kind === 'free') {
      const text = request.text.replace(/\s+/g, ' ').trim()
      if (!text) return reject('question_empty')
      if (text.length > FREE_QUESTION_MAX_LENGTH) return reject('question_too_long')
      question = { kind: 'free', text, discrepancy: null, code: null }
    } else if (request.kind === 'discrepancy') {
      const found = s.discoveries.find((d) => d.code === request.code)
      if (!found) return reject('unknown_discrepancy')
      question = discrepancyQuestion(found.violation)
    } else {
      question = {
        kind: request.kind,
        text: STANDARD_QUESTIONS[request.kind],
        discrepancy: null,
        code: null,
      }
    }
    const lines: SpokenLine[] = []
    const firstQuestion = !s.actions.some((a) => a.type === 'question')
    const transcript = [...s.transcript]
    this.busy = true
    let answer: string
    try {
      answer = await this.respond(s, transcript, question, onText)
    } finally {
      this.busy = false
    }
    if (s.closed) {
      return { ok: true, shiftOver: this.shift.over, question, answer, lines }
    }
    s.transcript.push({ speaker: 'inspector', text: question.text })
    if (firstQuestion) this.fire(s, 'first_question', lines)
    this.say(s, { trigger: 'answer', text: answer }, lines)
    this.record_(s, {
      type: 'question',
      kind: question.kind,
      text: question.text,
      answer,
      minute: this.shift.clock,
    })
    this.emit({
      type: 'question',
      applicantId: s.applicant.id,
      question: question.text,
      answer,
      minute: this.shift.clock,
    })
    this.presentLever(s, lines)
    this.charge(QUESTION_MINUTES)
    return { ok: true, shiftOver: this.shift.over, question, answer, lines }
  }

  // ---------- Forms: deep checks and incident reports ----------

  openForm(kind: FormKind, options: FormOptions = {}): Result<{ form: OpenForm }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    const ctx = this.context as DayContext
    if (kind === 'review') return reject('wrong_phase')
    let docId: string | null = null
    let documentNumber: string | null = null
    let reason: string
    const passport = findDocument(s.applicant.documents, 'passport')
    if (isDeepTool(kind)) {
      const status = this.toolStatus(kind)
      if (status === 'locked') return reject('tool_locked')
      if (status === 'down') return reject('tool_down')
      if (kind === 'registry') {
        const doc = options.docId
          ? s.applicant.documents.find((d) => d.id === options.docId)
          : passport
        if (!doc || !isNumbered(doc)) return reject('needs_document')
        docId = doc.id
        documentNumber = doc.number
      } else if (kind === 'verifyLetter') {
        const letters = s.applicant.documents.filter((d): d is Letter => d.type === 'letter')
        const letter = options.docId ? letters.find((d) => d.id === options.docId) : letters[0]
        if (!letter) return reject('no_letter')
        docId = letter.id
      }
      if (documentNumber === null && passport) documentNumber = passport.number
      if (options.code) {
        if (!s.discoveries.some((d) => d.code === options.code)) {
          return reject('unknown_discrepancy')
        }
        reason = reasonFromCode(options.code)
      } else {
        reason = plainUpper(options.reason ?? '') || (REASON_CHOICES[kind][0] as string)
      }
    } else {
      const incident = options.incident ?? 'threat'
      reason = INCIDENT_LABELS[incident]
      documentNumber = passport?.number ?? null
    }
    this.shift.serial += 1
    const form: OpenForm = {
      id: `${ctx.dayIndex}-${this.shift.serial}`,
      kind,
      docId,
      incident: kind === 'incident' ? (options.incident ?? 'threat') : null,
      reason,
      line: buildDocLine({
        kind,
        day: ctx.dayIndex,
        serial: this.shift.serial,
        subject: subjectName(passport ?? null),
        reason,
        minute: this.shift.clock,
        documentNumber,
      }),
      openedAt: this.shift.clock,
    }
    s.form = form
    return { ok: true, shiftOver: this.shift.over, form }
  }

  deepCheck(
    form: OpenForm,
    typing: TypingResult,
  ): Result<{
    check: DeepCheckReport
    lines: string[]
    revealed: Violation[]
    minutes: number
    spoken: SpokenLine[]
  }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    if (!s.form || s.form.id !== form.id || !isDeepTool(s.form.kind)) return reject('no_form')
    const open = s.form
    const tool = open.kind as DeepToolId
    const minutes = this.deepCheckMinutes(tool)
    if (minutes === null) return reject('tool_down')
    if (!compareTyping(open.line, typing.text).complete) return reject('typing_incomplete')
    const applicant = s.applicant
    const ctx = this.context as DayContext
    const world = this.state.world
    let check: DeepCheckReport
    if (tool === 'registry') {
      const doc = applicant.documents.find((d) => d.id === open.docId) as NumberedDocument
      check = { tool, report: registryReport(doc, world) }
    } else if (tool === 'fingerprints') {
      check = { tool, report: fingerprintReport(applicant, ctx, world) }
    } else if (tool === 'bodyScan') {
      check = { tool, report: bodyScanReport(applicant) }
    } else {
      const letter = applicant.documents.find((d) => d.id === open.docId) as Letter
      check = { tool, report: verifyLetterReport(letter) }
    }
    const docSpecific = tool === 'registry' || tool === 'verifyLetter'
    const revealed = applicant.violations.filter(
      (v) => v.evidence.some((e) => e.tool === tool) && (!docSpecific || v.docId === open.docId),
    )
    const spoken: SpokenLine[] = []
    const firstCheck = !s.actions.some((a) => a.type === 'deepCheck')
    let anyNew = false
    for (const v of revealed) if (this.discover(s, v, tool)) anyNew = true
    this.record_(s, {
      type: 'deepCheck',
      tool,
      docId: open.docId,
      revealed: revealed.map((v) => v.code),
      chars: open.line.length,
      typedMs: typing.ms,
      typos: typing.typos,
      minute: this.shift.clock,
    })
    s.form = null
    this.emit({
      type: 'deep_check',
      applicantId: applicant.id,
      tool,
      lines: check.report.lines,
      revealed: revealed.map((v) => v.code),
      minute: this.shift.clock,
    })
    if (firstCheck) this.fire(s, 'deep_check', spoken)
    if (anyNew) this.fire(s, 'discrepancy', spoken)
    this.presentLever(s, spoken)
    this.charge(minutes)
    return {
      ok: true,
      shiftOver: this.shift.over,
      check,
      lines: check.report.lines,
      revealed,
      minutes,
      spoken,
    }
  }

  reportIncident(form: OpenForm, typing: TypingResult): Result<{ incident: IncidentKind }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    if (!s.form || s.form.id !== form.id || s.form.kind !== 'incident' || !s.form.incident) {
      return reject('no_form')
    }
    if (!compareTyping(s.form.line, typing.text).complete) return reject('typing_incomplete')
    const incident = s.form.incident
    if (!s.reported.includes(incident)) s.reported.push(incident)
    if (incident === 'bribe' && s.bribe) {
      s.bribe.accepted = false
      s.bribe.reported = true
    }
    this.record_(s, {
      type: 'report',
      incident,
      chars: s.form.line.length,
      typedMs: typing.ms,
      typos: typing.typos,
      minute: this.shift.clock,
    })
    s.form = null
    this.emit({
      type: 'incident_report',
      applicantId: s.applicant.id,
      incident,
      minute: this.shift.clock,
    })
    this.charge(INCIDENT_REPORT_MINUTES)
    return { ok: true, shiftOver: this.shift.over, incident }
  }

  cancelForm(): void {
    if (this.shift.session) this.shift.session.form = null
  }

  // ---------- Envelopes ----------

  acceptBribe(): Result<{ bribe: BribeOffer }> {
    return this.handleBribe(true)
  }

  refuseBribe(): Result<{ bribe: BribeOffer }> {
    return this.handleBribe(false)
  }

  // ---------- Stamps ----------

  // The first stamp attempt can be interrupted once: the person says their last lines
  // (before_decision, an undelivered threat). Stamp again to decide.
  decide(
    decision: Decision,
    options: { reason?: ViolationCode } = {},
  ): Result<{
    status: 'interrupted' | 'done'
    lines: SpokenLine[]
    documentedReason: ViolationCode | null
  }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    if (this.busy) return reject('busy')
    const lines: SpokenLine[] = []
    const lever = s.applicant.plan.lever
    const interrupt =
      !this.shift.fired.has('interrupted') &&
      ((lever.type !== 'none' && !s.leverPresented) ||
        s.applicant.plan.scripted_lines.some(
          (l) => l.trigger === 'before_decision' && !this.shift.fired.has('before_decision'),
        ))
    if (interrupt) {
      this.shift.fired.add('interrupted')
      this.fire(s, 'before_decision', lines)
      this.presentLever(s, lines)
      return {
        ok: true,
        shiftOver: this.shift.over,
        status: 'interrupted',
        lines,
        documentedReason: null,
      }
    }
    let documentedReason: ViolationCode | null = null
    if (decision === 'deny') {
      const chosen = options.reason && s.discoveries.find((d) => d.code === options.reason)
      documentedReason = chosen ? chosen.code : (s.discoveries[0]?.code ?? null)
    }
    s.decision = decision
    this.record_(s, { type: 'decision', decision, minute: this.shift.clock })
    this.emit({
      type: 'decision',
      applicantId: s.applicant.id,
      decision,
      minute: this.shift.clock,
    })
    this.fire(s, decision === 'approve' ? 'after_approve' : 'after_deny', lines)
    this.closeSession(s, 'decided', documentedReason)
    return { ok: true, shiftOver: this.shift.over, status: 'done', lines, documentedReason }
  }

  // ---------- Evening ----------

  // Ends the shift (if the clock has not already) and closes the day.
  endShift(): EveningReport {
    const record = this.record
    if (this.state.phase !== 'shift' || !record) {
      throw new Error(`Cannot end a shift in phase ${this.state.phase}`)
    }
    if (!this.shift.over) this.markOver()
    record.outcomes = record.applicants.map(
      (a) => this.shift.outcomes.get(a.id) ?? this.emptyOutcome(a),
    )
    const consequences = resolveDayConsequences(this.state, record, this.odds)
    for (const e of consequences.events) {
      applyEventMoney(this.state.economy, e)
      record.events.push(e)
    }
    const settlement = settleDay(this.state, record)
    this.state.pending.push(...consequences.pending)
    record.closed = true
    this.state.phase = settlement.phase
    this.state.adversaryMemory = this.adversary.exportMemory()
    const report = eveningReport(this.state, record)
    this.emit({ type: 'day_closed', report })
    return report
  }

  // ---------- Internals ----------

  private freshShift(): ShiftState {
    return {
      clock: SHIFT.startMinute,
      nextIndex: 0,
      over: false,
      session: null,
      outcomes: new Map(),
      serial: rngFor(this.state.seed, 'forms', this.state.dayIndex).int(100, 480),
      fired: new Set(),
    }
  }

  private dayStart(record: DayRecord): DayStart {
    const morning = record.events.filter((e) => e.kind !== 'bribe_kept' && e.kind !== 'note')
    const reviews = morning
      .filter((e) => e.kind === 'complaint' && e.minutesLost > 0)
      .map((event, i) => {
        const source = this.findApplicant(event.sourceApplicantId)
        const passport = source ? findDocument(source.documents, 'passport') : undefined
        return {
          event,
          line: buildDocLine({
            kind: 'review',
            day: record.dayIndex,
            serial: 90 + i,
            subject: subjectName(passport ?? null),
            reason: `DENIAL OF DAY ${source?.day ?? record.dayIndex - 1}`,
            minute: SHIFT.startMinute,
            documentNumber: passport?.number ?? null,
          }),
        }
      })
    return {
      record,
      context: record.context,
      bulletin: record.context.bulletin,
      events: morning,
      notice: record.notice,
      reviews,
      shiftStartMinute: SHIFT.startMinute + minutesLostFrom(record.events),
    }
  }

  private findApplicant(id: string | null): Applicant | undefined {
    if (!id) return undefined
    for (const day of this.state.days) {
      const found = day.applicants.find((a) => a.id === id)
      if (found) return found
    }
    return undefined
  }

  private requestPlan(day: number): Promise<PlanResult> {
    if (this.planRequest && this.planRequest.day === day) return this.planRequest.promise
    const s = this.state
    const ctx = contextForDay(s, day)
    const resources =
      day > 1
        ? {
            budget: Math.min(AI_BUDGET.maxBank, s.ai.budget + AI_BUDGET.perDay),
            leverTokens: s.ai.leverTokens,
          }
        : { ...s.ai }
    const briefing = buildBriefing(ctx, s.world, resources)
    const history = observationHistory(s)
    const request = { briefing, previous: history[history.length - 1] ?? null, history }
    const fallback = this.fallback
    const checked = (result: PlanResult): PlanResult => {
      const parsed = DayPlanSchema.safeParse(result.plan)
      if (!parsed.success) throw new Error('The plan does not match the schema')
      return { ...result, plan: parsed.data as DayPlan }
    }
    const promise = this.adversary
      .planDay(request)
      .then(checked)
      .catch(async (error: unknown) => {
        if (!fallback) throw error
        const result = checked(await fallback.planDay(request))
        return {
          plan: result.plan,
          source: 'fallback' as const,
          notice: 'The adversary could not be reached. Today the line was planned offline.',
        }
      })
    this.planRequest = { day, promise }
    promise.catch(() => {
      if (this.planRequest?.promise === promise) this.planRequest = null
    })
    return promise
  }

  private async respond(
    session: BoothSession,
    transcript: TranscriptLine[],
    question: InspectorQuestion,
    onText?: (partial: string) => void,
  ): Promise<string> {
    const request = { dossier: session.dossier, transcript, question }
    try {
      const answer = (await this.adversary.respond(request, onText)).trim()
      if (answer) return answer
    } catch {
      // Fall through to the backup responder
    }
    if (this.fallback) {
      try {
        const answer = (await this.fallback.respond(request, onText)).trim()
        if (answer) return answer
      } catch {
        // Fall through to the template answer
      }
    }
    const text = answerQuestion(request, this.state.seed)
    onText?.(text)
    return text
  }

  private shiftBlocked(): Rejection | null {
    if (this.state.phase !== 'shift' || !this.record) return reject('wrong_phase')
    if (this.shift.over) return reject('shift_over')
    return null
  }

  private activeSession(): { ok: true; session: BoothSession } | Rejection {
    const blocked = this.shiftBlocked()
    if (blocked) return blocked
    const session = this.shift.session
    if (!session || session.closed) return reject('no_applicant')
    return { ok: true, session }
  }

  private handleBribe(accept: boolean): Result<{ bribe: BribeOffer }> {
    const session = this.activeSession()
    if (!session.ok) return session
    const s = session.session
    if (!s.bribe || !s.leverPresented || s.bribe.reported) return reject('no_bribe')
    s.bribe.accepted = accept
    this.record_(s, { type: 'bribe', accepted: accept, minute: this.shift.clock })
    this.emit({
      type: 'bribe',
      applicantId: s.applicant.id,
      accepted: accept,
      minute: this.shift.clock,
    })
    return { ok: true, shiftOver: this.shift.over, bribe: { ...s.bribe } }
  }

  private record_(session: BoothSession, action: PlayerAction): void {
    session.actions.push(action)
  }

  private discover(session: BoothSession, violation: Violation, via: EvidenceTool): boolean {
    if (session.discoveries.some((d) => d.violation === violation)) return false
    session.discoveries.push({ code: violation.code, violation, via, minute: this.shift.clock })
    return true
  }

  private say(session: BoothSession, line: SpokenLine, out: SpokenLine[]): void {
    const text = line.text.trim()
    if (!text) return
    const spoken = { trigger: line.trigger, text }
    out.push(spoken)
    session.transcript.push({ speaker: 'applicant', text })
    this.emit({
      type: 'speech',
      applicantId: session.applicant.id,
      line: spoken,
      minute: this.shift.clock,
    })
  }

  // Speaks the scripted lines of a trigger, once per person
  private fire(session: BoothSession, trigger: LineTrigger, out: SpokenLine[]): void {
    if (this.shift.fired.has(trigger)) return
    this.shift.fired.add(trigger)
    for (const line of session.applicant.plan.scripted_lines) {
      if (line.trigger === trigger) this.say(session, { trigger, text: line.text }, out)
    }
  }

  // Bribes come with the papers, threats and complaints at the first sign of trouble
  private presentLever(session: BoothSession, out: SpokenLine[]): void {
    const lever = session.applicant.plan.lever
    if (lever.type === 'none' || session.leverPresented) return
    session.leverPresented = true
    const text = lever.line.trim() || defaultLeverLine(lever.type, lever.amount)
    this.say(session, { trigger: 'lever', text }, out)
    if (lever.type === 'bribe' && session.bribe) {
      this.emit({
        type: 'bribe_offered',
        applicantId: session.applicant.id,
        amount: session.bribe.amount,
        minute: this.shift.clock,
      })
    }
  }

  private charge(minutes: number): void {
    this.advanceClock(minutes)
  }

  private overByClock(): void {
    if (this.shift.over) return
    this.markOver()
  }

  private markOver(): void {
    this.shift.over = true
    const session = this.shift.session
    if (session && !session.closed) this.closeSession(session, 'shift_over', null)
    const record = this.record
    const decided = [...this.shift.outcomes.values()].filter((o) => o.decision !== 'none').length
    this.emit({
      type: 'shift_over',
      minute: this.shift.clock,
      notProcessed: (record?.applicants.length ?? 0) - decided,
    })
  }

  private closeSession(
    session: BoothSession,
    reason: 'decided' | 'shift_over',
    documentedReason: ViolationCode | null,
  ): void {
    session.closed = true
    session.form = null
    const applicant = session.applicant
    const decision = session.decision ?? 'none'
    this.shift.outcomes.set(applicant.id, {
      applicantId: applicant.id,
      decision,
      documentedReason,
      minutesSpent: Math.max(0, this.shift.clock - session.calledAt),
      actions: session.actions,
      bribeAccepted: session.bribe?.accepted ?? false,
      reported: [...session.reported],
      correct: decision === 'none' ? null : (decision === 'approve') === applicant.admissible,
      leverPresented: session.leverPresented,
    })
    this.shift.session = null
    this.emit({
      type: 'applicant_left',
      applicantId: applicant.id,
      reason,
      minute: this.shift.clock,
    })
  }

  private emptyOutcome(applicant: Applicant): ApplicantOutcome {
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

  private emit(event: LoopEvent): void {
    this.events.push(event)
    for (const listener of this.listeners) listener(event)
  }
}

export function createDayLoop(
  state: GameState,
  adversary: Adversary,
  options: DayLoopOptions = {},
): DayLoop {
  return new DayLoop(state, adversary, options)
}
