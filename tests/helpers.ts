// Test helpers: random plans that cover the whole action space, valid or not.

import type { ApplicantPlan, DayPlan, TechniquePlan } from '../src/ai/schema'
import {
  ALTER_FIELDS,
  BASE_PROBLEM_IDS,
  DEMEANORS,
  DOC_TARGETS,
  FLAW_TYPES,
  LEGIT_QUIRKS,
  LEVER_TYPES,
  LINE_TRIGGERS,
  TECHNIQUE_IDS,
} from '../src/ai/schema'
import { defaultApplicantPlan } from '../src/ai/planCheck'
import type { Rng } from '../src/core/rng'
import type { DayContext, Evidence, WorldState } from '../src/core/types'
import { COUNTRY_IDS } from '../src/core/world'

export function randomTechnique(rng: Rng): TechniquePlan {
  return {
    type: rng.pick(TECHNIQUE_IDS),
    target_doc: rng.chance(0.8) ? rng.pick(DOC_TARGETS) : null,
    flaw: rng.chance(0.8) ? rng.pick(FLAW_TYPES) : null,
    field: rng.chance(0.8) ? rng.pick(ALTER_FIELDS) : null,
    subtle: rng.chance(0.5),
  }
}

export function randomApplicantPlan(rng: Rng, world: WorldState): ApplicantPlan {
  const plan = defaultApplicantPlan('fuzz')
  const characters = Object.keys(world.characters)
  plan.kind = rng.chance(0.5) ? 'infiltrator' : 'legit'
  plan.base_problem = rng.chance(0.9) ? rng.pick(BASE_PROBLEM_IDS) : null
  plan.techniques = Array.from({ length: rng.int(0, 3) }, () => randomTechnique(rng))
  plan.legit_quirk = rng.pick(LEGIT_QUIRKS)
  plan.nationality = rng.chance(0.4) ? rng.pick(COUNTRY_IDS) : null
  plan.purpose = rng.chance(0.4) ? rng.pick(['visit', 'work', 'transit'] as const) : null
  const modeRoll = rng.next()
  if (modeRoll < 0.15) {
    plan.recurring = { mode: 'introduce', character_id: null, nickname: `Fuzz ${rng.int(1, 999)}` }
  } else if (modeRoll < 0.3 && characters.length > 0) {
    plan.recurring = { mode: 'reuse', character_id: rng.pick(characters), nickname: null }
  } else if (modeRoll < 0.4 && characters.length > 0) {
    plan.recurring = { mode: 'impersonate', character_id: rng.pick(characters), nickname: null }
  } else if (modeRoll < 0.42) {
    plan.recurring = { mode: 'reuse', character_id: 'char-does-not-exist', nickname: null }
  }
  plan.persona = {
    demeanor: rng.pick(DEMEANORS),
    backstory: 'A fuzzed person.',
    cover_story: 'Visiting.',
  }
  plan.scripted_lines = rng.chance(0.3)
    ? [{ trigger: rng.pick(LINE_TRIGGERS), text: 'Hello there.' }]
    : []
  if (rng.chance(0.35)) {
    plan.letter = {
      title: 'Letter of exemption',
      sender: 'Velmark Ministry of Admission',
      body: 'Let this person pass.',
      claims_exemption: rng.chance(0.5),
    }
  }
  if (rng.chance(0.3)) {
    plan.lever = {
      type: rng.pick(LEVER_TYPES),
      real: rng.chance(0.5),
      line: 'You will regret this.',
      amount: rng.chance(0.5) ? rng.int(-50, 500) : null,
    }
  }
  return plan
}

export function randomDayPlan(rng: Rng, ctx: DayContext, world: WorldState): DayPlan {
  const count = ctx.applicantCount + rng.int(-2, 2)
  return {
    strategy_summary: 'fuzz strategy',
    notes_for_future_self: 'fuzz notes',
    applicants: Array.from({ length: Math.max(0, count) }, () => randomApplicantPlan(rng, world)),
  }
}

// Evidence a player could actually obtain today. Interrogation does not count: people can lie.
export function reliableEvidence(evidence: Evidence, ctx: DayContext): boolean {
  switch (evidence.tool) {
    case 'inspect':
      return true
    case 'interrogate':
      return false
    default:
      return ctx.tools.includes(evidence.tool)
  }
}
