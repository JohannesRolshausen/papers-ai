import { describe, expect, it } from 'vitest'
import type { ClaudeMemory } from '../src/ai/claudeAdversary'
import { CONSEQUENCES, DEEP_CHECK_MINUTES } from '../src/config'
import {
  buildDebrief,
  buildDebriefExport,
  computeRating,
  debriefFilename,
} from '../src/core/debrief'
import { charsPerMinute } from '../src/core/docLines'
import { simulateGame } from '../src/dev/simulation'

describe('debrief computation', () => {
  it('computes accurate metrics, evidence usage and rating for a completed perfect run', async () => {
    const { state, summary } = await simulateGame(7, 'easy', 'perfect')
    const report = buildDebrief(state)

    expect(report.kind).toBe('final')
    expect(report.metrics.daysPlayed).toBe(7)
    expect(report.metrics.daysTotal).toBe(7)
    expect(report.metrics.fired).toBe(false)
    expect(report.metrics.infiltratorsAttempted).toBe(summary.infiltratorsAttempted)
    expect(report.metrics.infiltratorsThrough).toBe(0)
    expect(report.metrics.infiltratorsStopped).toBe(summary.infiltratorsStopped)
    expect(report.metrics.legitDenied).toBe(0)
    expect(report.metrics.money).toBe(summary.money)
    expect(['S', 'A']).toContain(report.metrics.rating.grade)

    // Every day exposes the adversary's strategy and notes
    expect(report.days).toHaveLength(7)
    for (const day of report.days) {
      expect(day.strategySummary.length).toBeGreaterThan(10)
      expect(day.notesForFutureSelf.length).toBeGreaterThan(5)
      expect(day.applicants.length).toBeGreaterThan(0)
    }

    // Typing metrics agree with charsPerMinute over all typed forms
    if (report.metrics.typingForms > 0) {
      expect(report.metrics.typingAccuracy).toBeGreaterThan(0)
      expect(report.metrics.typingAccuracy).toBeLessThanOrEqual(1)
      expect(report.metrics.typingCpm).toBe(
        charsPerMinute(report.metrics.typingChars, report.metrics.typingMs),
      )
    }
  })

  it('marks unused evidence prominently when a careless player lets infiltrators through', async () => {
    const { state } = await simulateGame(7, 'normal', 'careless')
    const report = buildDebrief(state)

    expect(report.metrics.infiltratorsThrough).toBeGreaterThan(0)
    const admittedInfiltrators = report.days
      .flatMap((d) => d.applicants)
      .filter((a) => a.result === 'got_through')
    expect(admittedInfiltrators.length).toBe(report.metrics.infiltratorsThrough)

    // Every infiltrator who got through has unused conclusive evidence flagged as a critical miss
    for (const inf of admittedInfiltrators) {
      expect(inf.unusedEvidenceCount).toBeGreaterThan(0)
      expect(inf.criticalMissCount).toBeGreaterThan(0)
      expect(inf.evidence.some((e) => e.criticalMiss && !e.used)).toBe(true)
    }
  })

  it('accounts for sabotaged slow tools in deep check time', async () => {
    const { state } = await simulateGame(7, 'easy', 'perfect')
    const dayWithCheck = state.days.find((d) =>
      d.outcomes.some((o) => o.actions.some((a) => a.type === 'deepCheck')),
    )
    expect(dayWithCheck).toBeDefined()
    const baseMinutes = buildDebrief(state).metrics.deepCheckMinutes
    const action = dayWithCheck!.outcomes
      .flatMap((o) => o.actions)
      .find((a) => a.type === 'deepCheck')!
    const countOnDay = dayWithCheck!.outcomes
      .flatMap((o) => o.actions)
      .filter((a) => a.type === 'deepCheck' && a.tool === action.tool).length
    dayWithCheck!.events.push({
      day: dayWithCheck!.dayIndex,
      kind: 'sabotage',
      text: 'Tampered with overnight.',
      moneyDelta: 0,
      minutesLost: 0,
      sabotagedTool: action.tool,
      sabotageMode: 'slow',
      sourceApplicantId: null,
    })
    const slowedMinutes = buildDebrief(state).metrics.deepCheckMinutes
    const extra =
      countOnDay * DEEP_CHECK_MINUTES[action.tool] * (CONSEQUENCES.sabotageSlowFactor - 1)
    expect(slowedMinutes).toBe(baseMinutes + extra)
  })

  it('collects recurring character arcs across appearances', async () => {
    const { state } = await simulateGame(7, 'normal', 'perfect')
    const report = buildDebrief(state)
    expect(report.characters.length).toBeGreaterThan(0)
    for (const char of report.characters) {
      expect(char.appearances.length).toBeGreaterThan(0)
      expect(char.arcSummary.length).toBeGreaterThan(5)
      expect(char.truePerson).not.toBeNull()
    }
  })

  it('extracts Claude planner log and conversation turns without ever exporting an API key', async () => {
    const { state } = await simulateGame(7, 'easy', 'perfect')
    state.settings.aiMode = 'claude'
    state.settings.model = 'claude-opus-5-5'
    const memory: ClaudeMemory = {
      version: 1,
      kind: 'claude',
      messages: [
        { role: 'user', content: 'Day 1 briefing' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Probe the inspector with a cheap forged seal.',
              signature: 'sig',
            },
            { type: 'text', text: '{"strategy_summary":"Probe early"}' },
          ],
        },
      ] as ClaudeMemory['messages'],
      reported: [],
      notes: [],
      log: [
        { day: 1, source: 'claude', model: 'claude-sonnet-5-5', reason: null },
        { day: 2, source: 'fallback', model: null, reason: 'network' },
      ],
      offline: null,
    }
    state.adversaryMemory = memory
    state.days[0]!.plan.source = 'claude'
    state.days[1]!.plan.source = 'fallback'

    const report = buildDebrief(state)
    expect(report.days[0]?.model).toBe('claude-sonnet-5-5')
    expect(report.days[0]?.serverFallback).toBe(true)
    expect(report.days[1]?.fallbackReason).toBe('network')
    expect(report.adversary.fallbackDays).toBe(1)
    expect(report.adversary.claudeTurns).toHaveLength(1)
    expect(report.adversary.claudeTurns[0]?.thinking).toContain('Probe the inspector')

    const exported = buildDebriefExport(state, report)
    const json = JSON.stringify(exported)
    expect(json).not.toContain('sk-ant-')
    expect(debriefFilename(state)).toBe('oversight-debrief-easy-seed-7.json')
    expect(exported.game).toBe('OVERSIGHT')
    expect(Array.isArray(exported.days)).toBe(true)
  })

  it('assigns grade F on dismissal and S on a spotless shift', () => {
    expect(
      computeRating({
        fired: true,
        infiltratorsAttempted: 10,
        infiltratorsThrough: 0,
        legitTotal: 30,
        legitDenied: 0,
        processed: 40,
        applicantsTotal: 40,
        bribesTaken: 0,
      }).grade,
    ).toBe('F')

    expect(
      computeRating({
        fired: false,
        infiltratorsAttempted: 10,
        infiltratorsThrough: 0,
        legitTotal: 30,
        legitDenied: 0,
        processed: 40,
        applicantsTotal: 40,
        bribesTaken: 0,
      }).grade,
    ).toBe('S')

    expect(
      computeRating({
        fired: false,
        infiltratorsAttempted: 10,
        infiltratorsThrough: 6,
        legitTotal: 30,
        legitDenied: 5,
        processed: 40,
        applicantsTotal: 40,
        bribesTaken: 1,
      }).grade,
    ).toBe('D')
  })
})
