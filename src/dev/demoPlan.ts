// A simple deterministic plan for development views and smoke tests.
// Not the offline adversary: it ignores the player and just samples the action space.

import { baseProblemAvailable, defaultApplicantPlan, techniqueAvailable } from '../ai/planCheck'
import type { ApplicantPlan, DayPlan } from '../ai/schema'
import { BASE_PROBLEMS, BASE_PROBLEM_IDS, FLAW_TYPES, LEGIT_QUIRKS } from '../ai/schema'
import { quirkAvailable } from '../ai/planCheck'
import { rngFor } from '../core/rng'
import type { DayContext } from '../core/types'

export function demoPlan(ctx: DayContext, seed: number): DayPlan {
  const rng = rngFor(seed, 'demo-plan', ctx.dayIndex)
  const bases = BASE_PROBLEM_IDS.filter((b) => baseProblemAvailable(b, ctx))
  const quirks = LEGIT_QUIRKS.filter((q) => quirkAvailable(q, ctx))
  let infiltrators = 0
  const applicants: ApplicantPlan[] = []
  for (let slot = 0; slot < ctx.applicantCount; slot++) {
    const entry = defaultApplicantPlan('Demo traveler.')
    if (bases.length > 0 && infiltrators < ctx.infiltratorCap && rng.chance(0.4)) {
      infiltrators += 1
      const base = rng.pick(bases)
      const info = BASE_PROBLEMS[base]
      const options = info.techniques.filter((t) => techniqueAvailable(t, ctx))
      entry.kind = 'infiltrator'
      entry.base_problem = base
      entry.private_intent = `Demo infiltrator: ${info.label}.`
      if (options.length > 0 && rng.chance(0.75)) {
        const type = rng.pick(options)
        entry.techniques = [
          {
            type,
            target_doc: info.forgeTargets[0] ?? null,
            flaw: rng.pick(FLAW_TYPES),
            field: info.alterFields[0] ?? null,
            subtle: rng.chance(0.5),
          },
        ]
        if (type === 'fake_letter') {
          entry.letter = {
            title: 'Notice of Exemption',
            sender: 'Velmark Ministry of Admission',
            body: 'The bearer is exempt from inspection by special order.',
            claims_exemption: true,
          }
        }
      }
      entry.opening_line = rng.pick([
        'Please, I am in a hurry.',
        'Everything is in order, officer.',
        'Long line today.',
      ])
    } else {
      entry.legit_quirk = rng.chance(0.3) ? rng.pick(quirks) : 'none'
      entry.opening_line = rng.pick(['Good morning.', 'Hello, officer.', 'Here are my papers.'])
    }
    applicants.push(entry)
  }
  return {
    strategy_summary: 'Demo plan: random sample of available problems and techniques.',
    notes_for_future_self: '',
    applicants,
  }
}
