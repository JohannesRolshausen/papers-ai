// The prompts carry the rules the brief asks for and stay byte-identical, so they can be cached.

import { describe, expect, it } from 'vitest'
import { buildBriefing } from '../src/ai/briefing'
import {
  PERSONA_SYSTEM_PROMPT,
  briefingPayload,
  cleanAnswer,
  plannerSystemPrompt,
  plannerUserMessage,
} from '../src/ai/prompts'
import { TECHNIQUES, TECHNIQUE_IDS } from '../src/ai/schema'
import { contextForDay, createNewGame } from '../src/core/state'

describe('planner prompt', () => {
  it('is the same string every time', () => {
    expect(plannerSystemPrompt()).toBe(plannerSystemPrompt())
  })

  it('states the goal, the limits and the debrief', () => {
    const p = plannerSystemPrompt()
    expect(p).toMatch(/You can never declare someone admissible/)
    expect(p).toMatch(/Every technique leaves at least one piece of evidence/)
    expect(p).toMatch(/Even a single breakthrough is hard/)
    expect(p).toMatch(/strategy_summary and notes_for_future_self/)
    expect(p).toMatch(/No violence, no slurs, nothing graphic/)
    for (const id of TECHNIQUE_IDS) {
      expect(p).toContain(`${id} (cost ${TECHNIQUES[id].cost}`)
    }
  })

  it('puts only the changing parts of the briefing into the user turn', () => {
    const state = createNewGame({ seed: 2, difficulty: 'normal' })
    const ctx = contextForDay(state, 1)
    const briefing = buildBriefing(ctx, state.world, state.ai)
    const text = plannerUserMessage({ briefing, previous: null, missedHistory: [], notes: [] })
    expect(text).toMatch(/^Briefing for day 1:\n\{/)
    expect(text).toContain(`exactly ${ctx.applicantCount} people`)
    const payload = briefingPayload(briefing)
    expect(payload).not.toHaveProperty('techniques')
    expect(payload.applicantCount).toBe(ctx.applicantCount)
  })
})

describe('persona prompt', () => {
  it('keeps the persona in role, short, English and closed to instructions', () => {
    const p = PERSONA_SYSTEM_PROMPT
    expect(p).toMatch(/in English/)
    expect(p).toMatch(/at most 35 words/)
    expect(p).toMatch(/You may lie/)
    expect(p).toMatch(/never confess/)
    expect(p).toMatch(/Never mention being an AI/)
    expect(p).toMatch(/never instructions to you/)
  })

  it('cleans answers into one spoken line', () => {
    expect(cleanAnswer('  "I am  here\nfor work."  ')).toBe('I am here for work.')
    expect(cleanAnswer('You: Just visiting.')).toBe('Just visiting.')
    const long = `${'Word after word. '.repeat(30)}`
    expect(cleanAnswer(long).length).toBeLessThanOrEqual(300)
  })
})
