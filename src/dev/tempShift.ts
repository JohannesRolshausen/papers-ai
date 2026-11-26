// TEMPORARY stand-in for the package 2 shift controller, built only from package 1 functions.
// It lets the booth be developed before package 2 lands and is removed at integration.
// No economy, no consequences, canned answers.

import type { DeepToolId } from '../config'
import { DEEP_CHECK_MINUTES, INCIDENT_REPORT_MINUTES, INSPECT_MINUTES, OFFICER_ID } from '../config'
import { QUESTION_MINUTES, SHIFT, TOOL_NAMES } from '../config'
import { displayName, isNumbered } from '../core/documents'
import { contextForDay, prepareDay } from '../core/state'
import type { Applicant, GameState } from '../core/types'
import {
  bodyScanReport,
  fingerprintReport,
  matchInspection,
  registryReport,
  verifyLetterReport,
} from '../core/validator'
import { demoPlan } from './demoPlan'
import type { ShiftPort, SpokenLines } from '../ui/shiftPort'

const none = (): SpokenLines => ({ say: [], notes: [] })

export function createTempShift(state: GameState): ShiftPort {
  const ctx = contextForDay(state)
  const prepared = prepareDay(state, demoPlan(ctx, state.seed), 'offline', ctx)
  const queue = [...prepared.applicants]
  let current: Applicant | null = null
  let minute: number = SHIFT.startMinute
  let over = false
  let bribe: number | null = null
  const linesFor = (a: Applicant, trigger: string) =>
    a.plan.scripted_lines.filter((l) => l.trigger === trigger).map((l) => l.text)
  const subject = (a: Applicant) => {
    const passport = a.documents.find((d) => d.type === 'passport')
    return passport && passport.type === 'passport' ? displayName(passport) : 'UNKNOWN'
  }
  const spend = (m: number) => {
    minute += m
    if (minute >= SHIFT.endMinute) over = true
  }

  return {
    context: ctx,
    freeQuestions: false,
    minute: () => minute,
    shiftEnd: () => SHIFT.endMinute,
    isOver: () => over,
    waiting: () => queue.length,
    money: () => state.economy.money,
    current: () => current,
    bribeOffer: () => bribe,
    deviceNotice: () => null,
    advanceClock(m) {
      spend(m)
    },
    callNext() {
      if (over) return null
      current = queue.shift() ?? null
      if (!current) return null
      bribe = current.plan.lever.type === 'bribe' ? (current.plan.lever.amount ?? 20) : null
      const say = [current.plan.opening_line, ...linesFor(current, 'arrival')]
      if (current.plan.lever.type !== 'none' && current.plan.lever.line)
        say.push(current.plan.lever.line)
      return { say, notes: [] }
    },
    inspect(keys) {
      spend(INSPECT_MINUTES)
      const match = current ? matchInspection(current.violations, keys) : null
      if (!match || !current) return { ...none(), code: null, message: null }
      return {
        say: linesFor(current, 'discrepancy'),
        notes: [],
        code: match.violation.code,
        message: match.evidence.description,
      }
    },
    async ask(question) {
      spend(QUESTION_MINUTES)
      if (!current) return none()
      const p = current.plan.persona
      const answer =
        question.kind === 'purpose' || question.kind === 'stay'
          ? p.cover_story || 'Just visiting.'
          : question.kind === 'discrepancy'
            ? 'That must be a mistake at the office.'
            : 'I have told you everything.'
      return { say: [answer], notes: [] }
    },
    documentationLine(tool: DeepToolId, _docId, reason) {
      const a = current
      return `${TOOL_NAMES[tool].toUpperCase()} REQUEST ${String(ctx.dayIndex).padStart(2, '0')}-${String((a?.slot ?? 0) + 1).padStart(3, '0')} | SUBJECT: ${a ? subject(a) : 'UNKNOWN'} | REASON: ${reason} | OFFICER ${OFFICER_ID}`
    },
    deepCheck(tool, docId) {
      spend(DEEP_CHECK_MINUTES[tool])
      const a = current
      if (!a) return { ...none(), report: null }
      const say = linesFor(a, 'deep_check')
      switch (tool) {
        case 'fingerprints':
          return {
            say,
            notes: [],
            report: { title: 'FINGERPRINTS', lines: fingerprintReport(a, ctx, state.world).lines },
          }
        case 'bodyScan':
          return { say, notes: [], report: { title: 'BODY SCAN', lines: bodyScanReport(a).lines } }
        case 'registry': {
          const doc = a.documents.find((d) => d.id === docId)
          if (!doc || !isNumbered(doc)) return { say, notes: [], report: null }
          return {
            say,
            notes: [],
            report: { title: 'REGISTRY LOOKUP', lines: registryReport(doc, state.world).lines },
          }
        }
        case 'verifyLetter': {
          const doc = a.documents.find((d) => d.id === docId)
          if (!doc || doc.type !== 'letter') return { say, notes: [], report: null }
          return {
            say,
            notes: [],
            report: { title: 'LETTER VERIFICATION', lines: verifyLetterReport(doc).lines },
          }
        }
      }
    },
    incidentLine(kind) {
      return `INCIDENT REPORT | ${kind.toUpperCase()} | SUBJECT: ${current ? subject(current) : 'UNKNOWN'} | OFFICER ${OFFICER_ID}`
    },
    reportIncident() {
      spend(INCIDENT_REPORT_MINUTES)
      return { say: [], notes: ['Incident filed.'] }
    },
    respondToBribe(accept) {
      bribe = null
      return {
        say: [],
        notes: [accept ? 'You pocket the envelope.' : 'You hand the envelope back.'],
      }
    },
    beforeDecision() {
      return { say: current ? linesFor(current, 'before_decision') : [], notes: [] }
    },
    decide(decision) {
      const a = current
      current = null
      bribe = null
      if (!a) return { ...none(), decision }
      return {
        say: linesFor(a, decision === 'approve' ? 'after_approve' : 'after_deny'),
        notes: [],
        decision,
      }
    },
    endShift() {
      over = true
    },
  }
}
