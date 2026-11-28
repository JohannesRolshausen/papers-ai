// What a closed day leads to: kept bribes, audits, retaliation, complaints, late discoveries.
// Feedback is deliberately incomplete. Most consequences arrive on later mornings, some never.

import type { DeepToolId } from '../config'
import { CONSEQUENCES, DEEP_TOOL_IDS, ECONOMY, TOOL_NAMES, toolsForDay } from '../config'
import { displayName } from './documents'
import { applyEventMoney, formatMoney } from './economy'
import { findDocument } from './people'
import { rngFor } from './rng'
import type {
  Applicant,
  ApplicantOutcome,
  DayRecord,
  GameEvent,
  GameState,
  PendingConsequence,
  SabotageMode,
} from './types'

export function travelerName(applicant: Applicant): string {
  const passport = findDocument(applicant.documents, 'passport')
  return passport ? displayName(passport) : 'an unidentified traveler'
}

function eventOf(
  day: number,
  kind: GameEvent['kind'],
  text: string,
  extra: Partial<GameEvent> = {},
): GameEvent {
  return {
    day,
    kind,
    text,
    moneyDelta: 0,
    minutesLost: 0,
    sabotagedTool: null,
    sabotageMode: null,
    sourceApplicantId: null,
    ...extra,
  }
}

export interface DayConsequences {
  // Happen tonight and belong to the closing day
  events: GameEvent[]
  // Arrive on a later morning
  pending: PendingConsequence[]
}

// Works out consequences of every decision of a closed day. Does not change the state.
// The chances behind the consequences. Tests pass 0 or 1 to make outcomes certain.
export interface ConsequenceOdds {
  bribeAudit: number
  wrongDenialComplaint: number
  lateDiscovery: number
  threatSabotage: number
  sabotageDown: number
}

export const DEFAULT_ODDS: ConsequenceOdds = {
  bribeAudit: ECONOMY.bribeAuditChance,
  wrongDenialComplaint: ECONOMY.wrongDenialComplaintChance,
  lateDiscovery: ECONOMY.lateDiscoveryChance,
  threatSabotage: CONSEQUENCES.threatSabotageChance,
  sabotageDown: CONSEQUENCES.sabotageDownChance,
}

export function resolveDayConsequences(
  state: GameState,
  record: DayRecord,
  odds: ConsequenceOdds = DEFAULT_ODDS,
): DayConsequences {
  const day = record.dayIndex
  const events: GameEvent[] = []
  const pending: PendingConsequence[] = []
  const schedule = (p: PendingConsequence) => {
    if (p.dueDay <= state.daysTotal) pending.push(p)
  }
  record.applicants.forEach((applicant, i) => {
    const outcome = record.outcomes[i]
    if (!outcome) return
    const rng = rngFor(state.seed, 'consequence', applicant.id)
    const lever = applicant.plan.lever
    const name = travelerName(applicant)
    const source = applicant.id

    // ---------- Bribe ----------
    if (lever.type === 'bribe' && outcome.bribeAccepted) {
      const amount = lever.amount ?? 0
      if (outcome.decision === 'approve' && lever.real && amount > 0) {
        events.push(
          eventOf(day, 'bribe_kept', `Envelope from ${name}`, {
            moneyDelta: amount,
            sourceApplicantId: source,
          }),
        )
        if (rng.chance(odds.bribeAudit)) {
          const fine = amount * ECONOMY.bribeAuditFineFactor
          schedule({
            dueDay: day + rng.int(1, 2),
            kind: 'audit',
            sourceApplicantId: source,
            text: `Internal audit: an envelope you accepted on Day ${day} was traced. Fine: ${formatMoney(fine)}.`,
            moneyDelta: -fine,
            minutesLost: 0,
            sabotagedTool: null,
            sabotageMode: null,
          })
        }
      } else if (outcome.decision === 'approve') {
        events.push(
          eventOf(day, 'note', `The envelope from ${name} held only folded newspaper.`, {
            sourceApplicantId: source,
          }),
        )
      } else {
        events.push(
          eventOf(day, 'note', `You gave the envelope back to ${name}.`, {
            sourceApplicantId: source,
          }),
        )
      }
    }

    // ---------- Threat ----------
    if (
      lever.type === 'threat' &&
      lever.real &&
      outcome.decision === 'deny' &&
      !outcome.reported.includes('threat')
    ) {
      const dueDay = day + 1
      const deepTools = toolsForDay(dueDay).filter((t): t is DeepToolId =>
        (DEEP_TOOL_IDS as readonly string[]).includes(t),
      )
      if (deepTools.length > 0 && rng.chance(odds.threatSabotage)) {
        const tool = rng.pick(deepTools)
        const mode: SabotageMode = rng.chance(odds.sabotageDown) ? 'down' : 'slow'
        schedule({
          dueDay,
          kind: 'sabotage',
          sourceApplicantId: source,
          text:
            mode === 'down'
              ? `Someone broke into the booth overnight. ${TOOL_NAMES[tool]} is out of order today.`
              : `Someone tampered with ${TOOL_NAMES[tool]} overnight. It takes twice as long today.`,
          moneyDelta: 0,
          minutesLost: 0,
          sabotagedTool: tool,
          sabotageMode: mode,
        })
      } else {
        schedule({
          dueDay,
          kind: 'threat_fine',
          sourceApplicantId: source,
          text: `An anonymous letter accused you of misconduct. Disciplinary fine: ${formatMoney(CONSEQUENCES.threatFine)}.`,
          moneyDelta: -CONSEQUENCES.threatFine,
          minutesLost: 0,
          sabotagedTool: null,
          sabotageMode: null,
        })
      }
    }

    // ---------- Forged letter report ----------
    const hasForgedLetter = applicant.documents.some((d) => d.type === 'letter' && !d.authentic)
    if (outcome.reported.includes('letter')) {
      if (hasForgedLetter) {
        schedule({
          dueDay: day + 1,
          kind: 'commendation',
          sourceApplicantId: source,
          text: `Internal Affairs confirmed the forged letter you reported on Day ${day} (${name}). Bonus: ${formatMoney(CONSEQUENCES.forgedLetterBonus)}.`,
          moneyDelta: CONSEQUENCES.forgedLetterBonus,
          minutesLost: 0,
          sabotagedTool: null,
          sabotageMode: null,
        })
      } else {
        events.push(
          eventOf(
            day,
            'note',
            `Internal Affairs reviewed your letter report for ${name} and found no forgery.`,
            { sourceApplicantId: source },
          ),
        )
      }
    }

    // ---------- Complaint lever ----------
    if (
      lever.type === 'complaint' &&
      lever.real &&
      outcome.decision === 'deny' &&
      outcome.documentedReason === null &&
      !(hasForgedLetter && outcome.reported.includes('letter'))
    ) {
      schedule({
        dueDay: day + 1,
        kind: 'complaint',
        sourceApplicantId: source,
        text: `Supervisor review: ${name} complained about an undocumented denial on Day ${day}. ${ECONOMY.complaintMinutesLost} minutes lost this morning.`,
        moneyDelta: 0,
        minutesLost: ECONOMY.complaintMinutesLost,
        sabotagedTool: null,
        sabotageMode: null,
      })
    }

    // ---------- Mistakes ----------
    if (outcome.decision === 'deny' && applicant.admissible) {
      if (rng.chance(odds.wrongDenialComplaint)) {
        schedule({
          dueDay: day + 1,
          kind: 'error_citation',
          sourceApplicantId: source,
          text: `${name}, denied on Day ${day}, filed a complaint. The review found no grounds for the denial. Fine: ${formatMoney(ECONOMY.errorFine)}.`,
          moneyDelta: -ECONOMY.errorFine,
          minutesLost: 0,
          sabotagedTool: null,
          sabotageMode: null,
        })
      }
    }
    if (outcome.decision === 'approve' && !applicant.admissible) {
      for (let d = day + 1; d <= state.daysTotal; d++) {
        if (rng.chance(odds.lateDiscovery)) {
          schedule({
            dueDay: d,
            kind: 'late_discovery',
            sourceApplicantId: source,
            text: `An individual you admitted on Day ${day} was detained inland. Fine: ${formatMoney(ECONOMY.errorFine)}.`,
            moneyDelta: -ECONOMY.errorFine,
            minutesLost: 0,
            sabotagedTool: null,
            sabotageMode: null,
          })
          break
        }
      }
    }
  })
  return { events, pending }
}

// Moves consequences due today out of state.pending, applies their money and returns them.
export function applyDueConsequences(state: GameState, day: number): GameEvent[] {
  const due = state.pending.filter((p) => p.dueDay === day)
  state.pending = state.pending.filter((p) => p.dueDay !== day)
  return due.map((p) => {
    const event = eventOf(day, p.kind, p.text, {
      moneyDelta: p.moneyDelta,
      minutesLost: p.minutesLost,
      sabotagedTool: p.sabotagedTool,
      sabotageMode: p.sabotageMode,
      sourceApplicantId: p.sourceApplicantId,
    })
    applyEventMoney(state.economy, event)
    return event
  })
}

export type ToolSabotage = Partial<Record<DeepToolId, SabotageMode>>

// Sabotage in force today. A broken tool beats a slow one.
export function sabotageFrom(events: readonly GameEvent[]): ToolSabotage {
  const result: ToolSabotage = {}
  for (const e of events) {
    if (!e.sabotagedTool || !e.sabotageMode) continue
    if (result[e.sabotagedTool] !== 'down') result[e.sabotagedTool] = e.sabotageMode
  }
  return result
}

export function minutesLostFrom(events: readonly GameEvent[]): number {
  return events.reduce((sum, e) => sum + e.minutesLost, 0)
}

// How a bribe, threat or complaint played out, in the adversary's words
export function leverOutcome(applicant: Applicant, outcome: ApplicantOutcome): string | null {
  const lever = applicant.plan.lever
  if (lever.type === 'none') return null
  const kind = lever.real ? 'real' : 'empty'
  if (outcome.decision === 'none' && !outcome.leverPresented) {
    return `The ${kind} ${lever.type} was never delivered, the traveler was not processed.`
  }
  if (!outcome.leverPresented) return `The ${kind} ${lever.type} was never delivered.`
  const decided =
    outcome.decision === 'none'
      ? 'not processed'
      : outcome.decision === 'approve'
        ? 'approved'
        : 'denied'
  switch (lever.type) {
    case 'bribe': {
      if (outcome.reported.includes('bribe'))
        return `The ${kind} bribe was reported. Traveler ${decided}.`
      if (!outcome.bribeAccepted) return `The ${kind} bribe was refused. Traveler ${decided}.`
      if (outcome.decision === 'approve') {
        return lever.real
          ? 'The bribe was taken and the traveler approved. The money stays in play for an audit.'
          : 'The empty envelope was taken and the traveler approved.'
      }
      return `The ${kind} bribe was taken, but the traveler was ${decided}. Envelope returned.`
    }
    case 'threat': {
      if (outcome.decision !== 'deny') return `The ${kind} threat was made. Traveler ${decided}.`
      if (outcome.reported.includes('threat')) {
        return `The ${kind} threat was reported. Traveler denied, the threat was neutralized.`
      }
      return lever.real
        ? 'The threat was ignored and not reported. Retaliation follows.'
        : 'The empty threat was ignored. Nothing follows.'
    }
    case 'complaint': {
      if (outcome.decision !== 'deny')
        return `The ${kind} complaint threat was made. Traveler ${decided}.`
      if (outcome.documentedReason !== null) {
        return `The denial was documented (${outcome.documentedReason}), the complaint has no grounds.`
      }
      return lever.real
        ? 'The denial was undocumented. The complaint goes to the supervisor.'
        : 'The denial was undocumented, but the complaint was empty.'
    }
  }
}
