// Tunable game constants. Gameplay code reads numbers from here, not from literals.

import type { Purpose } from './core/documents'

export type DifficultyId = 'easy' | 'normal' | 'hard'

export interface Difficulty {
  id: DifficultyId
  label: string
  days: number
  description: string
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    days: 7,
    description: 'One week. The network has little time to learn your habits.',
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    days: 14,
    description: 'Two weeks. Enough time to build trust and then abuse it.',
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    days: 28,
    description: 'Four weeks. Shifting rules, long cons and a patient adversary.',
  },
}

// Player tools. Deep checks cost time and a typed documentation line.
export type ToolId =
  'inspect' | 'questions' | 'registry' | 'fingerprints' | 'bodyScan' | 'verifyLetter'
export type DeepToolId = 'registry' | 'fingerprints' | 'bodyScan' | 'verifyLetter'

export const TOOL_IDS: readonly ToolId[] = [
  'inspect',
  'questions',
  'registry',
  'fingerprints',
  'bodyScan',
  'verifyLetter',
]
export const DEEP_TOOL_IDS: readonly DeepToolId[] = [
  'registry',
  'fingerprints',
  'bodyScan',
  'verifyLetter',
]

export const TOOL_NAMES: Record<ToolId, string> = {
  inspect: 'Inspect',
  questions: 'Interview',
  registry: 'Registry Lookup',
  fingerprints: 'Fingerprints',
  bodyScan: 'Body Scan',
  verifyLetter: 'Verify Letter',
}

export const TOOL_UNLOCK_DAY: Record<ToolId, number> = {
  inspect: 1,
  questions: 1,
  registry: 1,
  fingerprints: 2,
  bodyScan: 3,
  verifyLetter: 3,
}

export function toolsForDay(dayIndex: number): ToolId[] {
  return TOOL_IDS.filter((tool) => TOOL_UNLOCK_DAY[tool] <= dayIndex)
}

// Fixed game minutes per deep check, on top of the time spent typing
export const DEEP_CHECK_MINUTES: Record<DeepToolId, number> = {
  registry: 25,
  fingerprints: 40,
  bodyScan: 45,
  verifyLetter: 30,
}

export const QUESTION_MINUTES = 4
export const INSPECT_MINUTES = 1
export const INCIDENT_REPORT_MINUTES = 15

export const SHIFT = {
  startMinute: 6 * 60,
  endMinute: 18 * 60,
  defaultRealSeconds: 540,
} as const

// Applicants per day: 6 on day 1, then rising to 16
export function applicantsForDay(dayIndex: number): number {
  if (dayIndex <= 1) return 6
  return Math.min(16, 8 + Math.floor((dayIndex - 2) / 2))
}

export const MAX_INFILTRATOR_SHARE = 0.4

export function infiltratorCapForDay(applicantCount: number): number {
  return Math.max(1, Math.floor(applicantCount * MAX_INFILTRATOR_SHARE))
}

// Forging budget of the adversary. Unspent points carry over up to the bank limit.
export const AI_BUDGET = {
  start: 3,
  perDay: 2,
  maxBank: 14,
} as const

// Real levers (threats, bribes, complaints with consequences) for the whole game
export function leverTokensFor(days: number): number {
  return Math.ceil(days / 3)
}

export const ECONOMY = {
  startingMoney: 40,
  payPerApplicant: 6,
  errorFine: 20,
  livingCost: 25,
  debtDaysToFire: 2,
  bribeAuditChance: 0.35,
  bribeAuditFineFactor: 2,
  complaintMinutesLost: 30,
  // Chance per day that a wrongly admitted infiltrator is discovered and reported
  lateDiscoveryChance: 0.3,
  // Chance that a wrongly denied legit traveler files a complaint
  wrongDenialComplaintChance: 0.4,
} as const

export const TOLERANCE = {
  heightCm: 2,
  weightKg: 4,
} as const

export const PERMIT_MAX_DAYS: Record<Purpose, number> = {
  transit: 2,
  visit: 30,
  work: 365,
}

export const HEALTH_CERT_MAX_AGE_YEARS = 3

// Plan text limits. Longer strings from the adversary are cut.
export const TEXT_LIMITS = {
  opening: 220,
  line: 220,
  persona: 400,
  letterBody: 700,
  letterTitle: 80,
  strategy: 1500,
  notes: 1500,
  intent: 400,
  scriptedLines: 6,
} as const

export const OFFICER_ID = '4471'
export const BOOTH_ID = '7'

// Free questions are short, the interface enforces the same limit
export const FREE_QUESTION_MAX_LENGTH = 80

export const CONSEQUENCES = {
  // A real threat after an unreported denial: sabotage of a deep check tool, otherwise a fine
  threatSabotageChance: 0.65,
  // Share of sabotage that takes the tool out completely instead of slowing it down
  sabotageDownChance: 0.4,
  sabotageSlowFactor: 2,
  threatFine: 20,
  // Bonus awarded when Internal Affairs confirms a reported forged letter
  forgedLetterBonus: 10,
} as const
