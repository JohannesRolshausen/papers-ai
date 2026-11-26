// What the adversary is told at the start of each day. Both adversaries plan from this.

import type { ToolId } from '../config'
import { TOOL_NAMES } from '../config'
import { displayName } from '../core/documents'
import { closedCountries, healthCountries } from '../core/rules'
import type { AdversaryResources, DayContext, WorldState } from '../core/types'
import type { CountryId } from '../core/world'
import { COUNTRIES, COUNTRY_IDS, countryName } from '../core/world'
import {
  FLAWS_BY_TARGET,
  baseProblemAvailable,
  forgeTargetAvailable,
  quirkAvailable,
  techniqueAvailable,
} from './planCheck'
import type {
  AlterField,
  BaseProblemId,
  DocTarget,
  FlawType,
  LegitQuirk,
  TechniqueId,
} from './schema'
import {
  BASE_PROBLEMS,
  BASE_PROBLEM_IDS,
  LEGIT_QUIRKS,
  QUIRKS,
  TECHNIQUES,
  TECHNIQUE_IDS,
} from './schema'

export interface BriefingBaseProblem {
  id: BaseProblemId
  label: string
  description: string
  available: boolean
  techniques: TechniqueId[]
  alterFields: AlterField[]
  forgeTargets: DocTarget[]
}

export interface BriefingTechnique {
  id: TechniqueId
  cost: number
  available: boolean
  description: string
  evidence: string
}

export interface BriefingCharacter {
  id: string
  nickname: string
  name: string
  nationality: CountryId
  introducedDay: number
  appearances: { day: number; kind: 'legit' | 'infiltrator'; mode: string }[]
}

export interface DayBriefing {
  dayIndex: number
  daysTotal: number
  daysRemaining: number
  date: string
  applicantCount: number
  infiltratorCap: number
  budget: number
  leverTokens: number
  tools: { id: ToolId; name: string }[]
  rules: { id: string; text: string }[]
  changes: string[]
  wanted: { name: string; nationality: string; reason: string }[]
  revokedCount: number
  closedCountries: string[]
  healthCountries: string[]
  countries: { id: CountryId; name: string; cities: string[] }[]
  baseProblems: BriefingBaseProblem[]
  techniques: BriefingTechnique[]
  flawsByTarget: Record<DocTarget, FlawType[]>
  quirks: { id: LegitQuirk; description: string; available: boolean }[]
  characters: BriefingCharacter[]
}

export function buildBriefing(
  ctx: DayContext,
  world: WorldState,
  resources: AdversaryResources,
): DayBriefing {
  return {
    dayIndex: ctx.dayIndex,
    daysTotal: ctx.daysTotal,
    daysRemaining: ctx.daysTotal - ctx.dayIndex,
    date: ctx.date,
    applicantCount: ctx.applicantCount,
    infiltratorCap: ctx.infiltratorCap,
    budget: resources.budget,
    leverTokens: resources.leverTokens,
    tools: ctx.tools.map((id) => ({ id, name: TOOL_NAMES[id] })),
    rules: ctx.bulletin.rules,
    changes: ctx.bulletin.changes,
    wanted: ctx.bulletin.wanted.map((w) => ({
      name: displayName(w),
      nationality: countryName(w.nationality),
      reason: w.reason,
    })),
    revokedCount: ctx.bulletin.revoked.length,
    closedCountries: closedCountries(ctx).map(countryName),
    healthCountries: healthCountries(ctx).map(countryName),
    countries: COUNTRY_IDS.map((id) => ({
      id,
      name: COUNTRIES[id].name,
      cities: [...COUNTRIES[id].cities],
    })),
    baseProblems: BASE_PROBLEM_IDS.map((id) => {
      const info = BASE_PROBLEMS[id]
      return {
        id,
        label: info.label,
        description: info.description,
        available: baseProblemAvailable(id, ctx),
        techniques: info.techniques.filter((t) => techniqueAvailable(t, ctx)),
        alterFields: [...info.alterFields],
        forgeTargets: info.forgeTargets.filter((d) => forgeTargetAvailable(d, ctx)),
      }
    }),
    techniques: TECHNIQUE_IDS.map((id) => ({
      id,
      cost: TECHNIQUES[id].cost,
      available: techniqueAvailable(id, ctx),
      description: TECHNIQUES[id].description,
      evidence: TECHNIQUES[id].evidence,
    })),
    flawsByTarget: Object.fromEntries(
      Object.entries(FLAWS_BY_TARGET).map(([k, v]) => [k, [...v]]),
    ) as Record<DocTarget, FlawType[]>,
    quirks: LEGIT_QUIRKS.map((id) => ({
      id,
      description: QUIRKS[id].description,
      available: quirkAvailable(id, ctx),
    })),
    characters: Object.values(world.characters).map((c) => {
      const person = world.persons[c.personId]
      return {
        id: c.id,
        nickname: c.nickname,
        name: person ? displayName(person) : c.nickname,
        nationality: person?.nationality ?? 'velmark',
        introducedDay: c.introducedDay,
        appearances: c.appearances.map((a) => ({ day: a.day, kind: a.kind, mode: a.mode })),
      }
    }),
  }
}
