// What the booth screen needs from the shift controller. The UI only talks to this interface,
// the game logic lives behind it.

import type { DeepToolId } from '../config'
import type {
  Applicant,
  DayContext,
  Decision,
  IncidentKind,
  StandardQuestion,
  ViolationCode,
} from '../core/types'

export interface SpokenLines {
  // Lines the person at the window says, in order
  say: string[]
  // Short notes for the transcript, for example "The envelope stays on the desk."
  notes: string[]
}

export interface InspectOutcome extends SpokenLines {
  code: ViolationCode | null
  message: string | null
}

export interface PrintedReport {
  title: string
  lines: string[]
}

export interface DeepCheckOutcome extends SpokenLines {
  // Null when the device failed (sabotage)
  report: PrintedReport | null
}

export interface DecisionOutcome extends SpokenLines {
  decision: Decision
}

export interface ShiftQuestion {
  kind: StandardQuestion | 'discrepancy' | 'free'
  text: string
  discrepancy: string | null
}

export interface ShiftPort {
  readonly context: DayContext
  readonly freeQuestions: boolean
  minute(): number
  shiftEnd(): number
  isOver(): boolean
  waiting(): number
  money(): number
  current(): Applicant | null
  // Amount in an envelope the current person put on the desk, null if none or already handled
  bribeOffer(): number | null
  // Sabotaged or slowed devices today, shown on the tool buttons
  deviceNotice(tool: DeepToolId): string | null

  advanceClock(minutes: number): void
  callNext(): SpokenLines | null
  inspect(keys: string[]): InspectOutcome
  ask(question: ShiftQuestion, onText?: (partial: string) => void): Promise<SpokenLines>
  documentationLine(tool: DeepToolId, docId: string | null, reason: string): string
  deepCheck(
    tool: DeepToolId,
    docId: string | null,
    typing: { typedMs: number; typos: number },
  ): DeepCheckOutcome
  incidentLine(kind: IncidentKind): string
  reportIncident(kind: IncidentKind, typing: { typedMs: number; typos: number }): SpokenLines
  respondToBribe(accept: boolean): SpokenLines
  beforeDecision(): SpokenLines
  decide(decision: Decision): DecisionOutcome
  // Called once when the clock reaches the end of the shift or the player ends it
  endShift(): void
}

export const STANDARD_QUESTIONS: { kind: StandardQuestion; label: string; text: string }[] = [
  { kind: 'purpose', label: 'Purpose', text: 'What is the purpose of your visit?' },
  { kind: 'duration', label: 'Length of stay', text: 'How long will you stay?' },
  { kind: 'stay', label: 'Accommodation', text: 'Where will you be staying?' },
  { kind: 'occupation', label: 'Occupation', text: 'What do you do for a living?' },
  { kind: 'origin', label: 'Coming from', text: 'Where are you travelling from?' },
]

export const DEEP_CHECK_REASONS = [
  'ROUTINE CHECK',
  'PHOTO MISMATCH',
  'DOCUMENT DOUBT',
  'SEAL DOUBT',
  'NAME MISMATCH',
  'BEHAVIOUR',
] as const
