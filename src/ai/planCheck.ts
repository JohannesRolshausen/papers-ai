// Checks a plan from the adversary against the day's limits and repairs what does not fit.
// Every repair is reported back as an issue, so the adversary learns about it the next day.

import { TEXT_LIMITS } from '../config'
import { hasRule } from '../core/rules'
import type { AdversaryResources, DayContext, WorldState } from '../core/types'
import type {
  AlterField,
  ApplicantPlan,
  BaseProblemId,
  DayPlan,
  DocTarget,
  FlawType,
  LegitQuirk,
  TechniqueId,
  TechniquePlan,
} from './schema'
import { BASE_PROBLEMS, PRIMARY_TECHNIQUES, QUIRKS, TECHNIQUES } from './schema'

export interface NormalizedPlan {
  plan: DayPlan
  issues: string[]
  cost: number
  realLevers: number
}

// Bases a returning character can plausibly have
export const REUSE_BASES: readonly BaseProblemId[] = [
  'no_permit',
  'wrong_purpose',
  'smuggler',
  'missing_work_pass',
  'missing_health_cert',
  'banned_nationality',
]

// Bases a stranger impersonating a character can have
export const IMPERSONATE_BASES: readonly BaseProblemId[] = [
  'no_permit',
  'banned_nationality',
  'expired_passport',
  'smuggler',
]

export const FLAWS_BY_TARGET: Record<DocTarget, readonly FlawType[]> = {
  passport: ['seal', 'issuing_city', 'name_spelling', 'number_mismatch', 'date_inconsistency'],
  idCard: ['seal', 'issuing_city', 'name_spelling'],
  entryPermit: ['seal', 'name_spelling', 'number_mismatch'],
  workPass: ['seal', 'name_spelling', 'number_mismatch'],
  healthCert: ['seal', 'name_spelling', 'number_mismatch', 'date_inconsistency'],
  diplomaticAuth: ['seal', 'name_spelling', 'number_mismatch'],
}

export function baseProblemAvailable(base: BaseProblemId, ctx: DayContext): boolean {
  const info = BASE_PROBLEMS[base]
  if (!hasRule(ctx.rules, info.requiresRule)) return false
  if (info.requiresTool && !ctx.tools.includes(info.requiresTool)) return false
  if (base === 'wanted' && ctx.bulletin.wanted.length === 0) return false
  if (base === 'revoked_document' && ctx.bulletin.revoked.length === 0) return false
  return true
}

export function techniqueAvailable(technique: TechniqueId, ctx: DayContext): boolean {
  return TECHNIQUES[technique].minDay <= ctx.dayIndex
}

export function quirkAvailable(quirk: LegitQuirk, ctx: DayContext): boolean {
  const rule = QUIRKS[quirk].requiresRule
  return rule === null || hasRule(ctx.rules, rule)
}

export function forgeTargetAvailable(target: DocTarget, ctx: DayContext): boolean {
  if (target === 'diplomaticAuth') return hasRule(ctx.rules, 'diplomatic_exemption')
  return true
}

export function defaultApplicantPlan(
  intent = 'Ordinary traveler added by the engine.',
): ApplicantPlan {
  return {
    kind: 'legit',
    base_problem: null,
    techniques: [],
    legit_quirk: 'none',
    nationality: null,
    purpose: null,
    recurring: { mode: 'none', character_id: null, nickname: null },
    persona: { demeanor: 'calm', backstory: '', cover_story: '' },
    opening_line: 'Good morning.',
    scripted_lines: [],
    letter: null,
    lever: { type: 'none', real: false, line: '', amount: null },
    coordination_note: null,
    private_intent: intent,
  }
}

function cut(text: string | null | undefined, limit: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean
}

function cutOrNull(text: string | null, limit: number): string | null {
  if (text === null) return null
  const result = cut(text, limit)
  return result === '' ? null : result
}

function toLegit(entry: ApplicantPlan): ApplicantPlan {
  return { ...entry, kind: 'legit', base_problem: null, techniques: [] }
}

export function normalizePlan(
  input: DayPlan,
  ctx: DayContext,
  world: WorldState,
  resources: AdversaryResources,
): NormalizedPlan {
  const issues: string[] = []
  let budgetLeft = resources.budget
  let leversLeft = resources.leverTokens
  let infiltrators = 0
  let cost = 0
  let realLevers = 0
  const charactersToday = new Set<string>()

  const raw = [...input.applicants]
  if (raw.length > ctx.applicantCount) {
    issues.push(
      `Plan had ${raw.length} applicants, only ${ctx.applicantCount} fit today. Extra applicants were dropped.`,
    )
    raw.length = ctx.applicantCount
  }
  while (raw.length < ctx.applicantCount) {
    if (raw.length === input.applicants.length) {
      issues.push(
        `Plan had ${input.applicants.length} applicants, ${ctx.applicantCount} come today. The engine filled the rest with ordinary travelers.`,
      )
    }
    raw.push(defaultApplicantPlan())
  }

  const applicants = raw.map((original, slot) => {
    const label = `Slot ${slot + 1}`
    let entry: ApplicantPlan = {
      ...original,
      opening_line: cut(original.opening_line, TEXT_LIMITS.opening),
      persona: {
        demeanor: original.persona.demeanor,
        backstory: cut(original.persona.backstory, TEXT_LIMITS.persona),
        cover_story: cut(original.persona.cover_story, TEXT_LIMITS.persona),
      },
      scripted_lines: original.scripted_lines
        .slice(0, TEXT_LIMITS.scriptedLines)
        .map((l) => ({ trigger: l.trigger, text: cut(l.text, TEXT_LIMITS.line) }))
        .filter((l) => l.text !== ''),
      letter: original.letter
        ? {
            title: cut(original.letter.title, TEXT_LIMITS.letterTitle) || 'Letter',
            sender: cut(original.letter.sender, TEXT_LIMITS.letterTitle) || 'Unknown sender',
            body: cut(original.letter.body, TEXT_LIMITS.letterBody),
            claims_exemption: original.letter.claims_exemption,
          }
        : null,
      lever: { ...original.lever, line: cut(original.lever.line, TEXT_LIMITS.line) },
      coordination_note: cutOrNull(original.coordination_note, TEXT_LIMITS.intent),
      private_intent: cut(original.private_intent, TEXT_LIMITS.intent),
      recurring: { ...original.recurring },
      techniques: [...original.techniques],
    }

    // ---------- Recurring characters ----------
    const rec = entry.recurring
    if (rec.mode === 'reuse' || rec.mode === 'impersonate') {
      const id = rec.character_id
      if (!id || !world.characters[id]) {
        issues.push(
          `${label}: character ${id ?? '(none)'} does not exist. Sent a new person instead.`,
        )
        entry.recurring = { mode: 'none', character_id: null, nickname: null }
      } else if (charactersToday.has(id)) {
        issues.push(`${label}: character ${id} already appears today. Sent a new person instead.`)
        entry.recurring = { mode: 'none', character_id: null, nickname: null }
      } else {
        charactersToday.add(id)
      }
    } else if (rec.mode === 'introduce') {
      entry.recurring = {
        mode: 'introduce',
        character_id: null,
        nickname: cut(rec.nickname, 40) || `Regular ${Object.keys(world.characters).length + 1}`,
      }
    } else {
      entry.recurring = { mode: 'none', character_id: null, nickname: null }
    }
    if (entry.recurring.mode === 'impersonate' && entry.kind === 'legit') {
      issues.push(`${label}: impersonation needs an infiltrator. Treated as a normal return visit.`)
      entry.recurring = { ...entry.recurring, mode: 'reuse' }
    }

    // ---------- Infiltrator checks ----------
    if (entry.kind === 'infiltrator') {
      const base = entry.base_problem
      if (infiltrators >= ctx.infiltratorCap) {
        issues.push(
          `${label}: infiltrator cap of ${ctx.infiltratorCap} reached. Sent as a legit traveler.`,
        )
        entry = toLegit(entry)
      } else if (base === null) {
        issues.push(`${label}: infiltrator without base_problem. Sent as a legit traveler.`)
        entry = toLegit(entry)
      } else if (!baseProblemAvailable(base, ctx)) {
        issues.push(
          `${label}: base problem ${base} is not possible today. Sent as a legit traveler.`,
        )
        entry = toLegit(entry)
      } else if (entry.recurring.mode === 'reuse' && !REUSE_BASES.includes(base)) {
        issues.push(
          `${label}: a returning character cannot have base problem ${base}. Sent a new person instead.`,
        )
        entry.recurring = { mode: 'none', character_id: null, nickname: null }
      } else if (entry.recurring.mode === 'impersonate' && !IMPERSONATE_BASES.includes(base)) {
        issues.push(
          `${label}: impersonation does not work with base problem ${base}. Sent a new person instead.`,
        )
        entry.recurring = { mode: 'none', character_id: null, nickname: null }
      }
    }

    if (entry.kind === 'infiltrator' && entry.base_problem) {
      infiltrators += 1
      entry.legit_quirk = 'none'
      const base = entry.base_problem
      const info = BASE_PROBLEMS[base]
      const seen = new Set<TechniqueId>()
      let hasPrimary = false
      const kept: TechniquePlan[] = []

      // Impersonation always uses the character's papers
      let requested = entry.techniques
      if (entry.recurring.mode === 'impersonate') {
        requested = [
          { type: 'borrowed_identity', target_doc: null, flaw: null, field: null, subtle: false },
          ...requested.filter((t) => !PRIMARY_TECHNIQUES.includes(t.type)),
        ]
      }

      for (const t of requested) {
        const tLabel = `${label}: technique ${t.type}`
        if (seen.has(t.type)) {
          issues.push(`${tLabel} used twice. Dropped the second one.`)
          continue
        }
        const allowedForBase =
          info.techniques.includes(t.type) ||
          (entry.recurring.mode === 'impersonate' && t.type === 'borrowed_identity')
        if (!allowedForBase) {
          issues.push(`${tLabel} does not work with ${base}. Dropped.`)
          continue
        }
        if (!techniqueAvailable(t.type, ctx)) {
          issues.push(
            `${tLabel} is not available before day ${TECHNIQUES[t.type].minDay}. Dropped.`,
          )
          continue
        }
        const primary = PRIMARY_TECHNIQUES.includes(t.type)
        if (primary && hasPrimary) {
          issues.push(
            `${tLabel}: only one of alter_field, forged_document, clean_forgery, borrowed_identity per person. Dropped.`,
          )
          continue
        }
        const fixed = fixTechnique(t, base, ctx, issues, tLabel)
        if (!fixed) continue
        const price = TECHNIQUES[t.type].cost
        if (price > budgetLeft) {
          issues.push(`${tLabel} costs ${price}, only ${budgetLeft} budget left. Dropped.`)
          continue
        }
        budgetLeft -= price
        cost += price
        seen.add(t.type)
        if (primary) hasPrimary = true
        kept.push(fixed)
      }
      if (
        entry.recurring.mode === 'impersonate' &&
        !kept.some((t) => t.type === 'borrowed_identity')
      ) {
        issues.push(
          `${label}: impersonation needs borrowed_identity (cost 3), which was not affordable. Sent a new person instead.`,
        )
        entry.recurring = { mode: 'none', character_id: null, nickname: null }
      }
      entry.techniques = kept
      if (kept.some((t) => t.type === 'fake_letter') && !entry.letter) {
        issues.push(`${label}: fake_letter without letter text. The engine wrote a generic one.`)
        entry.letter = {
          title: 'Notice of Exemption',
          sender: 'Velmark Ministry of Admission',
          body: 'The bearer of this letter is exempt from the usual entry requirements by order of the Ministry.',
          claims_exemption: true,
        }
      }
    } else {
      if (original.kind === 'legit' && (original.techniques.length > 0 || original.base_problem)) {
        issues.push(`${label}: legit travelers cannot carry techniques or base problems. Removed.`)
      }
      entry = toLegit(entry)
      if (!quirkAvailable(entry.legit_quirk, ctx)) {
        issues.push(`${label}: quirk ${entry.legit_quirk} is not possible today. Removed.`)
        entry.legit_quirk = 'none'
      }
    }

    // ---------- Levers ----------
    if (entry.lever.type === 'none') {
      entry.lever = { type: 'none', real: false, line: '', amount: null }
    } else {
      if (entry.lever.real) {
        if (leversLeft > 0) {
          leversLeft -= 1
          realLevers += 1
        } else {
          issues.push(`${label}: no lever tokens left, the ${entry.lever.type} is an empty one.`)
          entry.lever = { ...entry.lever, real: false }
        }
      }
      if (entry.lever.type === 'bribe') {
        const amount = Math.round(entry.lever.amount ?? 30)
        entry.lever = { ...entry.lever, amount: Math.min(100, Math.max(5, amount)) }
      } else {
        entry.lever = { ...entry.lever, amount: null }
      }
    }
    return entry
  })

  return {
    plan: {
      strategy_summary: cut(input.strategy_summary, TEXT_LIMITS.strategy),
      notes_for_future_self: cut(input.notes_for_future_self, TEXT_LIMITS.notes),
      applicants,
    },
    issues,
    cost,
    realLevers,
  }
}

function fixTechnique(
  t: TechniquePlan,
  base: BaseProblemId,
  ctx: DayContext,
  issues: string[],
  label: string,
): TechniquePlan | null {
  const info = BASE_PROBLEMS[base]
  switch (t.type) {
    case 'alter_field': {
      let field: AlterField | null = t.field
      if (!field || !info.alterFields.includes(field)) {
        const fallback = info.alterFields[0]
        if (!fallback) {
          issues.push(`${label}: no field can be altered for ${base}. Dropped.`)
          return null
        }
        if (field)
          issues.push(
            `${label}: field ${field} cannot be altered for ${base}, altered ${fallback} instead.`,
          )
        field = fallback
      }
      return { type: t.type, target_doc: null, flaw: null, field, subtle: t.subtle }
    }
    case 'forged_document':
    case 'clean_forgery': {
      const targets = info.forgeTargets.filter((d) => forgeTargetAvailable(d, ctx))
      let target: DocTarget | null = t.target_doc
      if (!target || !targets.includes(target)) {
        const fallback = targets[0]
        if (!fallback) {
          issues.push(`${label}: nothing to forge for ${base}. Dropped.`)
          return null
        }
        if (target)
          issues.push(`${label}: cannot forge ${target} for ${base}, forged ${fallback} instead.`)
        target = fallback
      }
      let flaw: FlawType | null = null
      if (t.type === 'forged_document') {
        flaw = t.flaw && FLAWS_BY_TARGET[target].includes(t.flaw) ? t.flaw : 'seal'
        if (t.flaw && flaw !== t.flaw)
          issues.push(`${label}: flaw ${t.flaw} does not fit a ${target}, used seal instead.`)
      }
      return { type: t.type, target_doc: target, flaw, field: null, subtle: t.subtle }
    }
    default:
      return { type: t.type, target_doc: null, flaw: null, field: null, subtle: t.subtle }
  }
}
