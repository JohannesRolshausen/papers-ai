// What the adversary learns about a closed day: every decision, the time it took and the
// tools the inspector used. Built from the DayRecord, so it can be rebuilt after loading a save.

import type { ApplicantObservation, ApplicantResult, DayObservation } from '../ai/adversary'
import type { DeepToolId, ToolId } from '../config'
import { TOOL_IDS } from '../config'
import { leverOutcome } from './consequences'
import type { Applicant, ApplicantOutcome, DayRecord, GameState, ViolationCode } from './types'

export function applicantResult(applicant: Applicant, outcome: ApplicantOutcome): ApplicantResult {
  if (outcome.decision === 'none') return 'not_processed'
  if (applicant.admissible)
    return outcome.decision === 'approve' ? 'legit_admitted' : 'legit_denied'
  return outcome.decision === 'approve' ? 'got_through' : 'stopped'
}

export function emptyToolUsage(): Record<ToolId, number> {
  return Object.fromEntries(TOOL_IDS.map((t) => [t, 0])) as Record<ToolId, number>
}

export function toolUsageOf(outcomes: readonly ApplicantOutcome[]): Record<ToolId, number> {
  const usage = emptyToolUsage()
  for (const outcome of outcomes) {
    for (const action of outcome.actions) {
      if (action.type === 'inspect') usage.inspect += 1
      else if (action.type === 'question') usage.questions += 1
      else if (action.type === 'deepCheck') usage[action.tool] += 1
    }
  }
  return usage
}

// Codes the inspector exposed, by inspect mode or by a deep check
export function flaggedCodes(outcome: ApplicantOutcome): ViolationCode[] {
  const codes: ViolationCode[] = []
  for (const action of outcome.actions) {
    if (action.type === 'inspect' && action.found) codes.push(action.found)
    if (action.type === 'deepCheck') codes.push(...action.revealed)
  }
  return [...new Set(codes)]
}

export function observeApplicant(
  applicant: Applicant,
  outcome: ApplicantOutcome,
): ApplicantObservation {
  const deepChecks: DeepToolId[] = []
  const questions: string[] = []
  let inspections = 0
  for (const action of outcome.actions) {
    if (action.type === 'inspect') inspections += 1
    if (action.type === 'question') questions.push(action.text)
    if (action.type === 'deepCheck') deepChecks.push(action.tool)
  }
  return {
    slot: applicant.slot,
    applicantId: applicant.id,
    kind: applicant.kind,
    baseProblem: applicant.baseProblem,
    techniques: applicant.techniques.map((t) => t.type),
    characterId: applicant.characterId,
    decision: outcome.decision,
    result: applicantResult(applicant, outcome),
    minutesSpent: outcome.minutesSpent,
    inspections,
    flagged: flaggedCodes(outcome),
    questions,
    deepChecks,
    reports: [...outcome.reported],
    bribeAccepted: outcome.bribeAccepted,
    legitQuirk: applicant.plan.legit_quirk,
    lever: applicant.plan.lever.type,
    leverReal: applicant.plan.lever.real,
    leverOutcome: leverOutcome(applicant, outcome),
  }
}

export function buildObservation(record: DayRecord): DayObservation {
  const applicants = record.applicants.map((a, i) => {
    const outcome = record.outcomes[i]
    if (!outcome) throw new Error(`Day ${record.dayIndex} has no outcome for ${a.id}`)
    return observeApplicant(a, outcome)
  })
  const processed = applicants.filter((a) => a.result !== 'not_processed')
  const minutes = processed.reduce((sum, a) => sum + a.minutesSpent, 0)
  return {
    dayIndex: record.dayIndex,
    applicants,
    toolUsage: toolUsageOf(record.outcomes),
    averageMinutesPerApplicant: processed.length > 0 ? Math.round(minutes / processed.length) : 0,
    processed: processed.length,
    notProcessed: applicants.length - processed.length,
    infiltratorsThrough: applicants.filter((a) => a.result === 'got_through').length,
    infiltratorsStopped: applicants.filter((a) => a.result === 'stopped').length,
    legitDenied: applicants.filter((a) => a.result === 'legit_denied').length,
    events: record.events.map((e) => e.text),
    planIssues: [...record.plan.issues],
  }
}

// Observations of every closed day, oldest first
export function observationHistory(state: GameState): DayObservation[] {
  return state.days.filter((d) => d.closed).map(buildObservation)
}
