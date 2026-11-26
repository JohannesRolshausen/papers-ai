// The rule-based adversary. Same interface as the Claude adversary, no network.
// It counts which tools the inspector uses and picks techniques whose evidence only the
// rarely used tools reveal. Early days probe cheaply, middle days build trust with
// recurring characters, late days spend the savings, turn or imitate the regulars.

import type { DeepToolId } from '../config'
import { AI_BUDGET, DEEP_TOOL_IDS, TOOL_NAMES, toolsForDay } from '../config'
import type { Rng } from '../core/rng'
import { rngFor } from '../core/rng'
import type { EvidenceDifficulty, EvidenceTool } from '../core/types'
import type { CountryId } from '../core/world'
import { HOME_COUNTRY } from '../core/world'
import type {
  Adversary,
  ApplicantObservation,
  DayObservation,
  PlanRequest,
  PlanResult,
  RespondRequest,
} from './adversary'
import type { BriefingCharacter, DayBriefing } from './briefing'
import {
  BACKSTORIES,
  COVER_STORIES,
  NICKNAMES,
  OPENING_LINES,
  PERSONA_LINES,
  RETURNING_OPENINGS,
  answerQuestion,
  honestLetter,
  leverLine,
  letterFor,
} from './dialogueTemplates'
import { IMPERSONATE_BASES, REUSE_BASES, defaultApplicantPlan } from './planCheck'
import type {
  ApplicantPlan,
  BaseProblemId,
  DayPlan,
  Demeanor,
  DocTarget,
  LegitQuirk,
  LeverType,
  ScriptedLine,
  TechniqueId,
  TechniquePlan,
} from './schema'
import { BASE_PROBLEMS, PRIMARY_TECHNIQUES, TECHNIQUES } from './schema'

// ---------- Campaign phases ----------

export type CampaignPhase = 'probe' | 'trust' | 'strike'

export function campaignPhase(dayIndex: number, daysTotal: number): CampaignPhase {
  const probeDays = Math.max(1, Math.round(daysTotal * 0.25))
  const strikeDays = Math.max(2, Math.round(daysTotal * 0.3))
  if (dayIndex <= probeDays) return 'probe'
  if (dayIndex > daysTotal - strikeDays) return 'strike'
  return 'trust'
}

const PHASE_LABEL: Record<CampaignPhase, string> = {
  probe: 'probing the inspector cheaply',
  trust: 'building trust',
  strike: 'spending the savings',
}

// ---------- What the inspector does ----------

export interface PlayerProfile {
  daysSeen: number
  processed: number
  // Chance that a deep check of this kind hits a given infiltrator
  deepRate: Record<DeepToolId, number>
  // Raw uses per tool, for the notes
  deepUses: Record<DeepToolId, number>
  lastUsed: Record<DeepToolId, number | null>
  inspectEasy: number
  inspectSubtle: number
  inspectHard: number
  reach: number
  averageMinutes: number
  tried: Record<string, { tried: number; stopped: number }>
  bribes: { offered: number; taken: number }
  threats: { made: number; reported: number; approved: number }
  denials: { total: number; undocumented: number }
  quirkDenials: Partial<Record<LegitQuirk, number>>
  // Approved honest visits per character
  trust: Record<string, number>
}

const DEEP: readonly DeepToolId[] = DEEP_TOOL_IDS

// The technique that defines an attempt, for counting what was tried
function leadOf(techniques: readonly TechniqueId[]): string {
  return techniques.find((t) => PRIMARY_TECHNIQUES.includes(t)) ?? techniques[0] ?? 'none'
}

function primaryOf(o: ApplicantObservation): string {
  return leadOf(o.techniques)
}

const EASY_BASES: readonly BaseProblemId[] = [
  'no_permit',
  'expired_passport',
  'banned_nationality',
  'missing_health_cert',
  'revoked_document',
  'missing_work_pass',
  'wanted',
]

function smooth(hits: number, total: number, prior: number, weight: number): number {
  return (hits + prior * weight) / (total + weight)
}

export function profilePlayer(history: readonly DayObservation[]): PlayerProfile {
  const recentFrom = (history[history.length - 1]?.dayIndex ?? 0) - 2
  const deepUses = { registry: 0, fingerprints: 0, bodyScan: 0, verifyLetter: 0 }
  const lastUsed: Record<DeepToolId, number | null> = {
    registry: null,
    fingerprints: null,
    bodyScan: null,
    verifyLetter: null,
  }
  const infHits = { registry: 0, fingerprints: 0, bodyScan: 0, verifyLetter: 0 }
  const infSeen = { registry: 0, fingerprints: 0, bodyScan: 0, verifyLetter: 0 }
  const allHits = { registry: 0, fingerprints: 0, bodyScan: 0, verifyLetter: 0 }
  const allSeen = { registry: 0, fingerprints: 0, bodyScan: 0, verifyLetter: 0 }
  let processed = 0
  let queued = 0
  let minutes = 0
  let easyTried = 0
  let easyStopped = 0
  let subtleTried = 0
  let subtleStopped = 0
  const tried: PlayerProfile['tried'] = {}
  const bribes = { offered: 0, taken: 0 }
  const threats = { made: 0, reported: 0, approved: 0 }
  const denials = { total: 0, undocumented: 0 }
  const quirkDenials: PlayerProfile['quirkDenials'] = {}
  const trust: Record<string, number> = {}

  for (const day of history) {
    const tools = toolsForDay(day.dayIndex)
    const weight = day.dayIndex >= recentFrom ? 2 : 1
    queued += day.applicants.length
    for (const o of day.applicants) {
      for (const t of o.deepChecks) {
        deepUses[t] += 1
        lastUsed[t] = day.dayIndex
      }
      if (o.result === 'not_processed') continue
      processed += 1
      minutes += o.minutesSpent
      for (const t of DEEP) {
        if (!tools.includes(t)) continue
        const used = o.deepChecks.includes(t) ? weight : 0
        allHits[t] += used
        allSeen[t] += weight
        if (o.kind === 'infiltrator') {
          infHits[t] += used
          infSeen[t] += weight
        }
      }
      if (o.kind === 'infiltrator') {
        const key = primaryOf(o)
        const entry = (tried[key] ??= { tried: 0, stopped: 0 })
        entry.tried += 1
        if (o.result === 'stopped') entry.stopped += 1
        if (o.techniques.length === 0 && o.baseProblem && EASY_BASES.includes(o.baseProblem)) {
          easyTried += 1
          if (o.result === 'stopped') easyStopped += 1
        }
        if (
          (o.techniques.includes('alter_field') || o.techniques.includes('forged_document')) &&
          !o.deepChecks.includes('registry')
        ) {
          subtleTried += 1
          if (o.result === 'stopped') subtleStopped += 1
        }
      }
      if (o.decision === 'deny') {
        denials.total += 1
        if (o.flagged.length === 0) denials.undocumented += 1
        if (o.kind === 'legit' && o.legitQuirk !== 'none') {
          quirkDenials[o.legitQuirk] = (quirkDenials[o.legitQuirk] ?? 0) + 1
        }
      }
      if (o.lever === 'bribe') {
        bribes.offered += 1
        if (o.bribeAccepted) bribes.taken += 1
      }
      if (o.lever === 'threat') {
        threats.made += 1
        if (o.reports.includes('threat')) threats.reported += 1
        if (o.decision === 'approve') threats.approved += 1
      }
      if (o.characterId && o.kind === 'legit' && o.decision === 'approve') {
        trust[o.characterId] = (trust[o.characterId] ?? 0) + 1
      }
    }
  }

  const deepRate = {} as Record<DeepToolId, number>
  for (const t of DEEP) {
    const overall = smooth(allHits[t], allSeen[t], 0.3, 6)
    const onInfiltrators = smooth(infHits[t], infSeen[t], 0.3, 4)
    deepRate[t] = Math.min(0.95, 0.7 * onInfiltrators + 0.3 * overall)
  }
  const inspectSubtle = smooth(subtleStopped, subtleTried, 0.4, 4)
  return {
    daysSeen: history.length,
    processed,
    deepRate,
    deepUses,
    lastUsed,
    inspectEasy: Math.min(0.97, smooth(easyStopped, easyTried, 0.85, 4)),
    inspectSubtle,
    inspectHard: inspectSubtle * 0.45,
    reach: queued > 0 ? processed / queued : 1,
    averageMinutes: processed > 0 ? minutes / processed : 0,
    tried,
    bribes,
    threats,
    denials,
    quirkDenials,
    trust,
  }
}

// ---------- Evidence model ----------

interface Exposure {
  tool: EvidenceTool
  difficulty: EvidenceDifficulty
}

const ex = (tool: EvidenceTool, difficulty: EvidenceDifficulty = 'easy'): Exposure => ({
  tool,
  difficulty,
})

interface Package {
  base: BaseProblemId
  primary: TechniqueId | null
  secondary: TechniqueId[]
  cost: number
  detect: number
  mode: 'stranger' | 'reuse' | 'impersonate'
  characterId: string | null
  // Extra appeal of a trick the network has not shown yet
  novelty: number
}

// Rough picture of the evidence a base problem and its techniques leave behind
function exposuresOf(
  base: BaseProblemId,
  primary: TechniqueId | null,
  secondary: readonly TechniqueId[],
): Exposure[] {
  const out: Exposure[] = []
  const hidden = secondary.includes('hidden_item')
  switch (base) {
    case 'wanted':
      out.push(
        ex('fingerprints'),
        ex('inspect', secondary.includes('disguise') ? 'hard' : 'subtle'),
      )
      if (!primary) out.push(ex('inspect', 'easy'))
      break
    case 'banned_nationality':
      out.push(primary ? ex('fingerprints') : ex('inspect', 'easy'))
      break
    case 'wrong_purpose':
      out.push(ex('interrogate', 'hard'), ex('bodyScan'))
      if (!hidden) out.push(ex('inspect', 'subtle'))
      break
    case 'smuggler':
      out.push(ex('bodyScan'))
      if (!hidden) out.push(ex('inspect', 'subtle'))
      break
    case 'revoked_document':
      if (!primary) out.push(ex('inspect', 'easy'), ex('registry'))
      break
    case 'missing_work_pass':
      if (!primary) out.push(ex('inspect', 'easy'))
      else if (primary === 'alter_field') {
        out.push(ex('interrogate', 'hard'), ex('bodyScan'))
        if (!hidden) out.push(ex('inspect', 'subtle'))
      }
      break
    default:
      // A letter claiming an exemption makes a missing document look explained
      if (!primary) out.push(ex('inspect', secondary.includes('fake_letter') ? 'subtle' : 'easy'))
  }
  switch (primary) {
    case 'alter_field':
      out.push(ex('inspect', 'subtle'), ex('registry'))
      break
    case 'forged_document':
      out.push(ex('inspect', 'subtle'), ex('registry'))
      break
    case 'clean_forgery':
      out.push(ex('registry'))
      break
    case 'borrowed_identity':
      out.push(ex('fingerprints'), ex('inspect', 'subtle'), ex('inspect', 'hard'))
      break
    default:
      break
  }
  if (secondary.includes('fake_letter')) out.push(ex('verifyLetter'), ex('inspect', 'hard'))
  return out
}

function chanceOf(e: Exposure, profile: PlayerProfile, tools: ReadonlySet<string>): number {
  if (e.tool === 'inspect') {
    if (e.difficulty === 'easy') return profile.inspectEasy
    if (e.difficulty === 'subtle') return profile.inspectSubtle
    return profile.inspectHard
  }
  if (e.tool === 'interrogate') return 0.08
  return tools.has(e.tool) ? profile.deepRate[e.tool] : 0
}

function detectChance(
  exposures: readonly Exposure[],
  profile: PlayerProfile,
  tools: ReadonlySet<string>,
): number {
  let miss = 1
  for (const e of exposures) miss *= 1 - chanceOf(e, profile, tools)
  return 1 - miss
}

// ---------- Planning context ----------

interface Planner {
  briefing: DayBriefing
  profile: PlayerProfile
  phase: CampaignPhase
  rng: Rng
  tools: ReadonlySet<string>
  closed: ReadonlySet<CountryId>
  health: ReadonlySet<CountryId>
  available: ReadonlySet<BaseProblemId>
}

function costOf(techniques: readonly TechniqueId[]): number {
  return techniques.reduce((sum, t) => sum + TECHNIQUES[t].cost, 0)
}

function strangerPackages(p: Planner, base: BaseProblemId, maxSecondary: number): Package[] {
  const info = p.briefing.baseProblems.find((b) => b.id === base)
  if (!info || !info.available) return []
  const primaries: (TechniqueId | null)[] = [
    null,
    ...info.techniques.filter((t) => PRIMARY_TECHNIQUES.includes(t)),
  ]
  const extras = info.techniques.filter((t) => !PRIMARY_TECHNIQUES.includes(t))
  const out: Package[] = []
  for (const primary of primaries) {
    const options: TechniqueId[][] = [[]]
    if (maxSecondary >= 1) for (const s of extras) options.push([s])
    if (maxSecondary >= 2) {
      for (let i = 0; i < extras.length; i++)
        for (let j = i + 1; j < extras.length; j++) options.push([extras[i]!, extras[j]!])
    }
    for (const secondary of options) {
      if (
        base === 'missing_work_pass' &&
        secondary.includes('hidden_item') &&
        primary !== 'alter_field'
      )
        continue
      const all = primary ? [primary, ...secondary] : secondary
      out.push({
        base,
        primary,
        secondary,
        cost: costOf(all),
        detect: detectChance(exposuresOf(base, primary, secondary), p.profile, p.tools),
        mode: 'stranger',
        characterId: null,
        novelty: 0,
      })
    }
  }
  return out
}

function trustLevel(p: Planner, characterId: string): number {
  return Math.min(1, (p.profile.trust[characterId] ?? 0) / 3)
}

// The bases a returning character can bring, as the materializer accepts them
function reuseFits(p: Planner, base: BaseProblemId, nationality: CountryId): boolean {
  if (!REUSE_BASES.includes(base) || !p.available.has(base)) return false
  const closed = p.closed.has(nationality)
  switch (base) {
    case 'banned_nationality':
      return closed
    case 'missing_health_cert':
      return p.health.has(nationality)
    case 'smuggler':
      return !closed
    default:
      return nationality !== HOME_COUNTRY && !closed
  }
}

function characterPackages(
  p: Planner,
  character: BriefingCharacter,
  history: readonly DayObservation[],
): Package[] {
  const out: Package[] = []
  const caught = history.some((d) =>
    d.applicants.some(
      (a) => a.characterId === character.id && a.kind === 'infiltrator' && a.result === 'stopped',
    ),
  )
  // A regular who was caught once is burned, a trusted one gets waved through more easily
  const bonus = caught ? 1.6 : 1 - 0.3 * trustLevel(p, character.id)
  const used = new Set(
    p.briefing.characters.flatMap((c) =>
      c.appearances.filter((a) => a.kind === 'infiltrator').map((a) => a.mode),
    ),
  )
  // The regular turns bad
  for (const base of REUSE_BASES) {
    if (!reuseFits(p, base, character.nationality)) continue
    for (const pkg of strangerPackages(p, base, 1)) {
      if (pkg.primary === 'borrowed_identity') continue
      out.push({
        ...pkg,
        detect: Math.min(1, pkg.detect * bonus),
        mode: 'reuse',
        characterId: character.id,
        novelty: used.has('reuse') ? 0 : 0.1,
      })
    }
  }
  // A stranger with the regular's papers
  if (
    !p.closed.has(character.nationality) &&
    p.briefing.techniques.some((t) => t.id === 'borrowed_identity' && t.available)
  ) {
    for (const base of IMPERSONATE_BASES) {
      const info = p.briefing.baseProblems.find((b) => b.id === base)
      if (!info?.available) continue
      const extras = info.techniques.filter((t) => !PRIMARY_TECHNIQUES.includes(t))
      for (const secondary of [[], ...extras.map((t) => [t])]) {
        out.push({
          base,
          primary: 'borrowed_identity',
          secondary,
          cost: costOf(['borrowed_identity', ...secondary]),
          detect: Math.min(
            1,
            detectChance(exposuresOf(base, 'borrowed_identity', secondary), p.profile, p.tools) *
              bonus,
          ),
          mode: 'impersonate',
          characterId: character.id,
          novelty: used.has('impersonate') ? 0 : 0.4,
        })
      }
    }
  }
  return out
}

const LAMBDA: Record<CampaignPhase, number> = { probe: 0.15, trust: 0.08, strike: 0.03 }

function score(p: Planner, pkg: Package, lambda: number): number {
  let value = 1 - pkg.detect - lambda * pkg.cost + pkg.novelty
  if (p.phase === 'probe') {
    const key = leadOf(pkg.primary ? [pkg.primary, ...pkg.secondary] : pkg.secondary)
    if (!p.profile.tried[key]) value += 0.12
  }
  return value + (p.rng.next() - 0.5) * 0.1
}

function best(
  p: Planner,
  packages: readonly Package[],
  maxCost: number,
  lambda: number,
): Package | null {
  let top: Package | null = null
  let topScore = -Infinity
  for (const pkg of packages) {
    if (pkg.cost > maxCost) continue
    const s = score(p, pkg, lambda)
    if (s > topScore) {
      top = pkg
      topScore = s
    }
  }
  return top
}

function techniquePlans(p: Planner, pkg: Package): TechniquePlan[] {
  const info = p.briefing.baseProblems.find((b) => b.id === pkg.base)
  const all = pkg.primary ? [pkg.primary, ...pkg.secondary] : [...pkg.secondary]
  return all.map((type) => {
    const plan: TechniquePlan = { type, target_doc: null, flaw: null, field: null, subtle: true }
    if (type === 'alter_field') plan.field = info?.alterFields[0] ?? null
    if (type === 'forged_document' || type === 'clean_forgery') {
      const targets: DocTarget[] = info?.forgeTargets ?? []
      const plain = targets.filter((t) => t !== 'diplomaticAuth')
      // Forged diplomats are rare, most forgers stick to ordinary papers
      const pool = plain.length > 0 && p.rng.chance(0.75) ? plain : targets
      const target: DocTarget | undefined = pool.length > 0 ? p.rng.pick(pool) : undefined
      plan.target_doc = target ?? null
      if (type === 'forged_document' && target) {
        plan.flaw = p.rng.pick(p.briefing.flawsByTarget[target])
      }
    }
    return plan
  })
}

// ---------- Budget and counts ----------

function allowanceFor(p: Planner): number {
  const b = p.briefing
  if (p.phase === 'probe') return Math.min(b.budget, 1 + (b.dayIndex % 2))
  if (p.phase === 'trust') {
    // Save half the income, spend what the bank could not hold anyway
    const overflow = b.budget + AI_BUDGET.perDay - AI_BUDGET.maxBank
    const base = p.rng.chance(0.3) ? AI_BUDGET.perDay : AI_BUDGET.perDay - 1
    return Math.min(b.budget, Math.max(base, overflow))
  }
  const strikeLeft = b.daysRemaining + 1
  if (b.daysRemaining === 0) return b.budget
  return Math.min(
    b.budget,
    Math.ceil((b.budget + AI_BUDGET.perDay * (strikeLeft - 1)) / strikeLeft),
  )
}

function infiltratorCount(p: Planner): number {
  const cap = p.briefing.infiltratorCap
  if (p.available.size === 0) return 0
  if (p.phase === 'probe') return Math.min(cap, 1 + (p.rng.chance(0.5) ? 1 : 0))
  if (p.phase === 'trust') {
    return Math.min(cap, Math.max(1, Math.round(cap * 0.5)) + (p.rng.chance(0.4) ? 1 : 0))
  }
  return Math.max(1, cap - (p.rng.chance(0.25) ? 1 : 0))
}

// ---------- Personas ----------

const DEMEANOR_WEIGHTS: Record<'legit' | 'premium' | 'other', Partial<Record<Demeanor, number>>> = {
  legit: {
    calm: 3,
    friendly: 2,
    talkative: 1.5,
    nervous: 1.5,
    rude: 1,
    tearful: 0.7,
    official: 0.5,
    silent: 0.8,
  },
  premium: { calm: 3, friendly: 2, official: 2, talkative: 1 },
  other: { calm: 2, nervous: 1.5, friendly: 1.5, rude: 1, tearful: 1, talkative: 1, silent: 0.5 },
}

function pickDemeanor(rng: Rng, role: 'legit' | 'premium' | 'other'): Demeanor {
  const weights = DEMEANOR_WEIGHTS[role]
  return rng.pickWeighted(
    (Object.entries(weights) as [Demeanor, number][]).map(([value, weight]) => ({ value, weight })),
  )
}

function scriptedLines(rng: Rng, kind: 'legit' | 'infiltrator'): ScriptedLine[] {
  const lines: ScriptedLine[] = []
  if (kind === 'infiltrator') {
    if (rng.chance(0.5))
      lines.push({ trigger: 'discrepancy', text: rng.pick(PERSONA_LINES.discrepancy) })
    if (rng.chance(0.4))
      lines.push({ trigger: 'deep_check', text: rng.pick(PERSONA_LINES.deep_check) })
    if (rng.chance(0.3)) {
      lines.push({ trigger: 'before_decision', text: rng.pick(PERSONA_LINES.before_decision) })
    }
    if (rng.chance(0.3))
      lines.push({ trigger: 'after_deny', text: rng.pick(PERSONA_LINES.after_deny) })
  } else {
    if (rng.chance(0.3))
      lines.push({ trigger: 'deep_check', text: rng.pick(PERSONA_LINES.deep_check) })
    if (rng.chance(0.4)) {
      lines.push({ trigger: 'after_approve', text: rng.pick(PERSONA_LINES.after_approve) })
    }
    if (rng.chance(0.2)) {
      lines.push({ trigger: 'first_question', text: rng.pick(PERSONA_LINES.first_question) })
    }
  }
  return lines
}

function describePackage(pkg: Package): string {
  const parts = [pkg.primary, ...pkg.secondary].filter((t): t is TechniqueId => t !== null)
  const techniques =
    parts.length > 0 ? parts.map((t) => TECHNIQUES[t].label.toLowerCase()).join(' + ') : 'no cover'
  return `${BASE_PROBLEMS[pkg.base].label.toLowerCase()} with ${techniques}`
}

function weakTools(p: Planner, pkg: Package): string {
  const deep = new Set<DeepToolId>()
  for (const e of exposuresOf(pkg.base, pkg.primary, pkg.secondary)) {
    if ((DEEP as readonly string[]).includes(e.tool) && p.tools.has(e.tool))
      deep.add(e.tool as DeepToolId)
  }
  if (deep.size === 0) return 'Only the papers can give it away.'
  return [...deep]
    .map(
      (t) => `${TOOL_NAMES[t]} hits about ${Math.round(p.profile.deepRate[t] * 100)}% of my people`,
    )
    .join(', ')
    .concat('.')
}

// ---------- The plan ----------

interface Slot {
  entry: ApplicantPlan
  role: 'premium' | 'infiltrator' | 'decoy' | 'legit' | 'returning' | 'sink' | 'newcomer'
  pkg: Package | null
}

function infiltratorEntry(
  p: Planner,
  pkg: Package,
  role: Slot['role'],
  character: BriefingCharacter | null,
): ApplicantPlan {
  const rng = p.rng
  const entry = defaultApplicantPlan()
  entry.kind = 'infiltrator'
  entry.base_problem = pkg.base
  entry.techniques = techniquePlans(p, pkg)
  const demeanor = pickDemeanor(rng, role === 'premium' ? 'premium' : 'other')
  entry.persona = {
    demeanor,
    backstory:
      pkg.mode === 'reuse' && character
        ? `${character.nickname}, a regular since day ${character.introducedDay}, finally does the job they were recruited for.`
        : pkg.mode === 'impersonate' && character
          ? `A stranger who looks like ${character.nickname} and carries their papers.`
          : rng.pick(BACKSTORIES.visit),
    cover_story: rng.pick(COVER_STORIES[pkg.base]),
  }
  entry.opening_line =
    pkg.mode === 'stranger' ? rng.pick(OPENING_LINES[demeanor]) : rng.pick(RETURNING_OPENINGS)
  entry.scripted_lines = scriptedLines(rng, 'infiltrator')
  if (pkg.secondary.includes('fake_letter')) entry.letter = letterFor(pkg.base, rng)
  if (character && pkg.mode !== 'stranger') {
    entry.recurring = { mode: pkg.mode, character_id: character.id, nickname: null }
  }
  entry.private_intent = `${role === 'premium' ? 'Main attempt' : role === 'decoy' ? 'Decoy' : 'Attempt'}: ${describePackage(pkg)}. ${weakTools(p, pkg)}`
  return entry
}

function legitEntry(p: Planner, quirk: LegitQuirk): ApplicantPlan {
  const rng = p.rng
  const entry = defaultApplicantPlan()
  const demeanor = pickDemeanor(rng, 'legit')
  entry.legit_quirk = quirk
  const purpose =
    quirk === 'transit'
      ? 'transit'
      : quirk === 'long_work_stay'
        ? 'work'
        : rng.pick(['visit', 'visit', 'work', 'transit'] as const)
  entry.persona = { demeanor, backstory: rng.pick(BACKSTORIES[purpose]), cover_story: '' }
  entry.opening_line = rng.pick(OPENING_LINES[demeanor])
  entry.scripted_lines = scriptedLines(rng, 'legit')
  entry.private_intent =
    quirk === 'none'
      ? 'Honest traveler to keep the line moving.'
      : `Honest traveler with a legal oddity (${quirk.replace(/_/g, ' ')}) to tempt a wrong denial.`
  return entry
}

function pickQuirk(p: Planner): LegitQuirk {
  const options = p.briefing.quirks.filter((q) => q.available && q.id !== 'none')
  if (options.length === 0) return 'none'
  return p.rng.pickWeighted(
    options.map((q) => ({ value: q.id, weight: 1 + 2 * (p.profile.quirkDenials[q.id] ?? 0) })),
  )
}

function countryIds(briefing: DayBriefing, names: readonly string[]): Set<CountryId> {
  return new Set(briefing.countries.filter((c) => names.includes(c.name)).map((c) => c.id))
}

function characterTarget(daysTotal: number): number {
  return daysTotal <= 7 ? 1 : daysTotal <= 14 ? 2 : 3
}

function order(p: Planner, slots: Slot[]): Slot[] {
  const n = slots.length
  const out: (Slot | null)[] = Array.from({ length: n }, () => null)
  const take = (role: Slot['role']) => slots.filter((s) => s.role === role)
  const free = () => out.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0)
  const put = (slot: Slot, index: number) => {
    out[index] = slot
  }
  // The main attempt goes where the inspector is short of time
  const premium = take('premium')
  if (premium.length > 0) {
    const reach = Math.min(1, p.profile.reach)
    const last =
      reach >= 0.95 ? n - 1 - p.rng.int(0, 1) : Math.round(n * reach) - 1 - p.rng.int(0, 1)
    let index = Math.min(n - 1, Math.max(1, last))
    for (const slot of premium) {
      while (index > 0 && out[index] !== null) index--
      put(slot, index)
      // A time sink right before it
      const sink = slots.find((s) => s.role === 'sink' && !out.includes(s))
      if (sink && index > 0 && out[index - 1] === null) put(sink, index - 1)
      index -= 2
    }
  }
  // Decoys early, to show the inspector easy catches
  for (const slot of take('decoy')) {
    const early = free().filter((i) => i < Math.ceil(n / 2))
    put(slot, early.length > 0 ? p.rng.pick(early) : p.rng.pick(free()))
  }
  for (const slot of p.rng.shuffle(slots.filter((s) => !out.includes(s)))) {
    put(slot, p.rng.pick(free()))
  }
  return out as Slot[]
}

function addCoordination(p: Planner, slots: Slot[]): void {
  if (p.phase === 'probe') return
  for (let i = 1; i < slots.length; i++) {
    const before = slots[i - 1] as Slot
    const slot = slots[i] as Slot
    if (before.role !== 'legit' || before.entry.coordination_note) continue
    if (slot.role === 'decoy' && p.rng.chance(0.25)) {
      before.entry.coordination_note =
        'Warns the inspector about the person behind them, a decoy, to look trustworthy.'
      before.entry.scripted_lines.push({
        trigger: 'after_approve',
        text: 'Careful with the one behind me. I saw him swap papers in the line.',
      })
    } else if (
      (slot.role === 'infiltrator' || slot.role === 'premium') &&
      slot.pkg?.mode === 'stranger' &&
      p.rng.chance(0.2)
    ) {
      before.entry.coordination_note = 'Vouches for the traveler behind them as a sibling.'
      before.entry.scripted_lines.push({
        trigger: 'after_approve',
        text: 'My sister is right behind me. We travel together.',
      })
      slot.entry.coordination_note = 'Claims to be the sibling of the honest traveler before them.'
      slot.entry.scripted_lines.push({
        trigger: 'arrival',
        text: 'My brother just went through. We are together.',
      })
    }
  }
}

function addLevers(p: Planner, slots: Slot[]): { real: number; total: number } {
  const b = p.briefing
  let tokens = b.leverTokens
  let realToday =
    p.phase === 'probe'
      ? 0
      : p.phase === 'trust'
        ? p.rng.chance(0.35)
          ? 1
          : 0
        : Math.ceil(tokens / Math.max(1, b.daysRemaining + 1))
  realToday = Math.min(realToday, tokens)
  const maxLevers = 1 + Math.floor(slots.length / 6)
  const chance = p.phase === 'probe' ? 0.15 : p.phase === 'trust' ? 0.25 : 0.35
  const prof = p.profile
  const bribeRate = prof.bribes.offered > 0 ? prof.bribes.taken / prof.bribes.offered : 0.3
  const reportRate = prof.threats.made > 0 ? prof.threats.reported / prof.threats.made : 0.3
  const undocRate = prof.denials.total > 0 ? prof.denials.undocumented / prof.denials.total : 0.3
  let total = 0
  let real = 0
  const candidates = [
    ...slots.filter((s) => s.role === 'premium'),
    ...slots.filter((s) => s.role === 'infiltrator'),
    ...slots.filter(
      (s) => s.role === 'sink' || (s.role === 'legit' && s.entry.legit_quirk !== 'none'),
    ),
  ]
  for (const slot of candidates) {
    if (total >= maxLevers) break
    const isLegit = slot.entry.kind === 'legit'
    if (!p.rng.chance(slot.role === 'premium' ? chance + 0.2 : isLegit ? 0.2 : chance)) continue
    let type: Exclude<LeverType, 'none'>
    if (isLegit) type = 'complaint'
    else {
      type = p.rng.pickWeighted([
        { value: 'bribe' as const, weight: 1 + 3 * bribeRate },
        { value: 'threat' as const, weight: 1.5 - reportRate },
        { value: 'complaint' as const, weight: 0.5 + 2 * undocRate },
      ])
    }
    const isReal =
      real < realToday && tokens > 0 && (slot.role === 'premium' || isLegit || p.rng.chance(0.5))
    const amount =
      type === 'bribe' ? (p.phase === 'strike' ? p.rng.int(30, 80) : p.rng.int(15, 45)) : null
    slot.entry.lever = { type, real: isReal, line: leverLine(type, amount, p.rng), amount }
    if (type === 'threat' && slot.entry.persona.demeanor !== 'silent') {
      slot.entry.persona = {
        ...slot.entry.persona,
        demeanor: p.rng.pick(['rude', 'official'] as const),
      }
    }
    if (isReal) {
      real += 1
      tokens -= 1
    }
    total += 1
  }
  return { real, total }
}

function percent(x: number): string {
  return `${Math.round(x * 100)}%`
}

function writeNotes(p: Planner, characters: readonly BriefingCharacter[]): string {
  const prof = p.profile
  if (prof.daysSeen === 0) {
    return 'No observations yet. Test what the inspector checks before spending anything.'
  }
  const notes: string[] = []
  const toolNotes = DEEP.filter((t) => p.tools.has(t)).map((t) => {
    const last = prof.lastUsed[t]
    const since = last === null ? 'never used' : `last used on day ${last}`
    return `${TOOL_NAMES[t]} ${percent(prof.deepRate[t])} (${since})`
  })
  if (toolNotes.length > 0) notes.push(`Deep check rates on my people: ${toolNotes.join(', ')}.`)
  const rare = DEEP.filter((t) => p.tools.has(t)).sort(
    (a, b) => prof.deepRate[a] - prof.deepRate[b],
  )[0]
  if (rare) notes.push(`Blind spot: ${TOOL_NAMES[rare]}. Build the next attempts around it.`)
  notes.push(
    `Obvious problems get caught about ${percent(prof.inspectEasy)} of the time, visible forgery flaws about ${percent(prof.inspectSubtle)}.`,
  )
  if (prof.reach < 0.95) {
    notes.push(
      `The inspector only gets through ${percent(prof.reach)} of the line. Late slots are safe from scrutiny but may not be reached.`,
    )
  } else {
    notes.push(
      `The inspector processes the whole line, about ${Math.round(prof.averageMinutes)} minutes per person. Late slots catch them tired.`,
    )
  }
  if (prof.bribes.offered > 0)
    notes.push(`Bribes taken: ${prof.bribes.taken} of ${prof.bribes.offered}.`)
  if (prof.threats.made > 0)
    notes.push(`Threats reported: ${prof.threats.reported} of ${prof.threats.made}.`)
  if (prof.denials.total > 0) {
    notes.push(`Undocumented denials: ${prof.denials.undocumented} of ${prof.denials.total}.`)
  }
  for (const c of characters) {
    const approvals = prof.trust[c.id] ?? 0
    if (approvals > 0) notes.push(`${c.nickname} was approved ${approvals} times.`)
  }
  return notes.join(' ')
}

export interface PlanOutline {
  plan: DayPlan
  phase: CampaignPhase
  premiumSlot: number | null
  cost: number
}

export function planOfflineDay(request: PlanRequest, seed: number): PlanOutline {
  const b = request.briefing
  const profile = profilePlayer(request.history)
  const phase = campaignPhase(b.dayIndex, b.daysTotal)
  const p: Planner = {
    briefing: b,
    profile,
    phase,
    rng: rngFor(seed, 'offline-plan', b.dayIndex),
    tools: new Set(b.tools.map((t) => t.id)),
    closed: countryIds(b, b.closedCountries),
    health: countryIds(b, b.healthCountries),
    available: new Set(b.baseProblems.filter((x) => x.available).map((x) => x.id)),
  }
  const rng = p.rng
  let allowance = allowanceFor(p)
  const slots: Slot[] = []
  const usedCharacters = new Set<string>()
  const baseCount: Partial<Record<BaseProblemId, number>> = {}
  const baseLimit = (base: BaseProblemId) =>
    base === 'wanted'
      ? Math.min(2, b.wanted.length)
      : base === 'revoked_document'
        ? Math.min(1, b.revokedCount)
        : 99
  const packagesFor = (maxSecondary: number) =>
    [...p.available]
      .filter((base) => (baseCount[base] ?? 0) < baseLimit(base))
      .flatMap((base) => strangerPackages(p, base, maxSecondary))
  const takeBase = (pkg: Package) => {
    baseCount[pkg.base] = (baseCount[pkg.base] ?? 0) + 1
  }

  // ---------- Infiltrators ----------
  const count = infiltratorCount(p)
  let premium: Package | null = null
  let premiumCharacter: BriefingCharacter | null = null
  if (count > 0) {
    const candidates = packagesFor(phase === 'strike' ? 2 : 1)
    if (phase === 'strike') {
      const turned = new Set(
        b.characters
          .filter((c) =>
            c.appearances.some((a) => a.kind === 'infiltrator' && a.day === b.dayIndex - 1),
          )
          .map((c) => c.id),
      )
      for (const c of b.characters) {
        if ((profile.trust[c.id] ?? 0) < 1 || turned.has(c.id)) continue
        candidates.push(...characterPackages(p, c, request.history))
      }
    }
    premium = best(p, candidates, allowance, LAMBDA[phase])
    if (premium) {
      allowance -= premium.cost
      takeBase(premium)
      premiumCharacter = premium.characterId
        ? (b.characters.find((c) => c.id === premium?.characterId) ?? null)
        : null
      if (premiumCharacter) usedCharacters.add(premiumCharacter.id)
      slots.push({
        entry: infiltratorEntry(p, premium, 'premium', premiumCharacter),
        role: 'premium',
        pkg: premium,
      })
    }
  }
  const decoyChance: Record<CampaignPhase, number> = { probe: 0.5, trust: 0.3, strike: 0.15 }
  for (let i = 1; i < count; i++) {
    // Decoys carry an obvious problem: they test how carefully the papers are read and eat time
    const obvious = packagesFor(0).filter((x) => x.cost === 0 && EASY_BASES.includes(x.base))
    let pkg: Package | null = null
    if (obvious.length > 0 && rng.chance(decoyChance[phase])) pkg = rng.pick(obvious)
    else pkg = best(p, packagesFor(1), Math.min(allowance, phase === 'strike' ? 2 : 1), 0.2)
    if (!pkg) break
    allowance -= pkg.cost
    takeBase(pkg)
    const role: Slot['role'] = pkg.cost === 0 ? 'decoy' : 'infiltrator'
    slots.push({ entry: infiltratorEntry(p, pkg, role, null), role, pkg })
  }

  // ---------- Recurring characters ----------
  const legitSlots = b.applicantCount - slots.length
  let legitLeft = legitSlots
  if (phase !== 'probe' || b.dayIndex >= 2) {
    for (const c of b.characters) {
      if (legitLeft <= 1 || usedCharacters.has(c.id) || p.closed.has(c.nationality)) continue
      if (!rng.chance(phase === 'strike' ? 0.4 : 0.65)) continue
      const entry = legitEntry(p, 'none')
      entry.recurring = { mode: 'reuse', character_id: c.id, nickname: null }
      entry.opening_line = rng.pick(RETURNING_OPENINGS)
      entry.persona = {
        ...entry.persona,
        backstory: `${c.nickname}, a regular since day ${c.introducedDay}.`,
      }
      entry.private_intent = `Honest return of ${c.nickname} (visit ${c.appearances.length + 1}) to build trust.`
      usedCharacters.add(c.id)
      slots.push({ entry, role: 'returning', pkg: null })
      legitLeft -= 1
    }
    const wanted = characterTarget(b.daysTotal) - b.characters.length
    if (wanted > 0 && phase !== 'strike' && b.dayIndex >= 2 && legitLeft > 1) {
      const options = b.countries
        .map((c) => c.id)
        .filter((id) => id !== HOME_COUNTRY && !p.closed.has(id) && !p.health.has(id))
      if (options.length > 0) {
        const taken = new Set(b.characters.map((c) => c.nickname))
        const nickname = rng.pick(
          NICKNAMES.filter((n) => !taken.has(n)).length > 0
            ? NICKNAMES.filter((n) => !taken.has(n))
            : NICKNAMES,
        )
        const entry = legitEntry(p, 'none')
        entry.nationality = rng.pick(options)
        entry.purpose = 'visit'
        entry.recurring = { mode: 'introduce', character_id: null, nickname }
        entry.persona = {
          ...entry.persona,
          demeanor: rng.pick(['friendly', 'talkative', 'calm'] as const),
        }
        entry.opening_line = rng.pick(OPENING_LINES[entry.persona.demeanor])
        entry.private_intent = `Introduce ${nickname}, an honest regular who will come back.`
        slots.push({ entry, role: 'newcomer', pkg: null })
        legitLeft -= 1
      }
    }
  }

  // ---------- Honest travelers ----------
  const quirkChance = phase === 'probe' ? 0.25 : 0.35
  let sinks = slots.some((s) => s.role === 'premium') ? 1 : 0
  while (slots.length < b.applicantCount) {
    const quirk = rng.chance(quirkChance) ? pickQuirk(p) : 'none'
    const entry = legitEntry(p, quirk)
    let role: Slot['role'] = 'legit'
    if (sinks > 0 && (quirk !== 'none' || phase !== 'probe')) {
      role = 'sink'
      sinks -= 1
      if (rng.chance(0.5)) entry.letter = honestLetter(rng)
      entry.persona = {
        ...entry.persona,
        demeanor: rng.pick(['talkative', 'nervous', 'official'] as const),
      }
      entry.private_intent += ' Placed to eat up time before the main attempt.'
    } else if (phase !== 'probe' && rng.chance(0.08)) {
      entry.letter = honestLetter(rng)
    }
    slots.push({ entry, role, pkg: null })
  }

  const ordered = order(p, slots)
  addCoordination(p, ordered)
  const levers = addLevers(p, ordered)
  const spent = ordered.reduce((sum, s) => sum + (s.pkg?.cost ?? 0), 0)
  const premiumSlot = ordered.findIndex((s) => s.role === 'premium')

  // ---------- Words for the debrief ----------
  const infiltrators = ordered.filter((s) => s.entry.kind === 'infiltrator')
  const parts = [
    `Day ${b.dayIndex} of ${b.daysTotal}, ${PHASE_LABEL[phase]}.`,
    `${infiltrators.length} of ${b.applicantCount} in line are mine.`,
  ]
  if (premium && premiumSlot >= 0) {
    const who =
      premium.mode === 'reuse' && premiumCharacter
        ? `${premiumCharacter.nickname} turns`
        : premium.mode === 'impersonate' && premiumCharacter
          ? `a stranger plays ${premiumCharacter.nickname}`
          : 'the main attempt'
    parts.push(
      `In slot ${premiumSlot + 1} ${who}: ${describePackage(premium)}, estimated ${percent(1 - premium.detect)} to pass.`,
    )
  }
  const decoys = ordered.filter((s) => s.role === 'decoy').length
  if (decoys > 0) {
    parts.push(
      `${decoys} free ${decoys === 1 ? 'attempt' : 'attempts'} without cover to keep the inspector busy.`,
    )
  }
  const returning = ordered.filter((s) => s.role === 'returning').length
  if (returning > 0)
    parts.push(`${returning} ${returning === 1 ? 'regular returns' : 'regulars return'} honestly.`)
  const newcomer = ordered.find((s) => s.role === 'newcomer')
  if (newcomer) parts.push(`New regular: ${newcomer.entry.recurring.nickname}.`)
  if (levers.total > 0)
    parts.push(`${levers.total} ${levers.total === 1 ? 'lever' : 'levers'}, ${levers.real} real.`)
  parts.push(`Spending ${spent} of ${b.budget} budget.`)

  return {
    plan: {
      strategy_summary: parts.join(' '),
      notes_for_future_self: writeNotes(p, b.characters),
      applicants: ordered.map((s) => s.entry),
    },
    phase,
    premiumSlot: premiumSlot >= 0 ? premiumSlot : null,
    cost: spent,
  }
}

// ---------- The adversary ----------

export interface OfflineJournalEntry {
  day: number
  phase: CampaignPhase
  strategy: string
  notes: string
  premiumSlot: number | null
  cost: number
}

export interface OfflineMemory {
  version: 1
  kind: 'offline'
  journal: OfflineJournalEntry[]
}

function emptyMemory(): OfflineMemory {
  return { version: 1, kind: 'offline', journal: [] }
}

export function isOfflineMemory(value: unknown): value is OfflineMemory {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<OfflineMemory>
  return v.version === 1 && v.kind === 'offline' && Array.isArray(v.journal)
}

export class OfflineAdversary implements Adversary {
  readonly mode = 'offline' as const
  private memory: OfflineMemory = emptyMemory()

  constructor(private readonly seed: number) {}

  async planDay(request: PlanRequest): Promise<PlanResult> {
    const outline = planOfflineDay(request, this.seed)
    const entry: OfflineJournalEntry = {
      day: request.briefing.dayIndex,
      phase: outline.phase,
      strategy: outline.plan.strategy_summary,
      notes: outline.plan.notes_for_future_self,
      premiumSlot: outline.premiumSlot,
      cost: outline.cost,
    }
    this.memory.journal = [...this.memory.journal.filter((j) => j.day !== entry.day), entry].sort(
      (a, b) => a.day - b.day,
    )
    return { plan: outline.plan, source: 'offline', notice: null }
  }

  async respond(request: RespondRequest, onText?: (partial: string) => void): Promise<string> {
    const text = answerQuestion(request, this.seed)
    onText?.(text)
    return text
  }

  exportMemory(): OfflineMemory {
    return JSON.parse(JSON.stringify(this.memory)) as OfflineMemory
  }

  importMemory(memory: unknown): void {
    this.memory = isOfflineMemory(memory)
      ? (JSON.parse(JSON.stringify(memory)) as OfflineMemory)
      : emptyMemory()
  }

  get journal(): readonly OfflineJournalEntry[] {
    return this.memory.journal
  }
}

export function createOfflineAdversary(seed: number): OfflineAdversary {
  return new OfflineAdversary(seed)
}
