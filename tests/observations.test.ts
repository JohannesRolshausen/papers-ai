import { describe, expect, it } from 'vitest'
import { buildObservation, observationHistory } from '../src/core/observations'
import { refKey } from '../src/core/refs'
import type { Applicant } from '../src/core/types'
import { NEVER, callFirst, decideFully, entry, setup, technique, typed } from './loopHelpers'

function inspectKeys(applicant: Applicant): string[] {
  for (const v of applicant.violations) {
    const e = v.evidence.find((x) => x.tool === 'inspect')
    if (e) return e.refs.map(refKey)
  }
  throw new Error('No inspect evidence')
}

describe('observations for the adversary', () => {
  it('reports decisions, results, time, tools, flags and levers of a day', async () => {
    const s = setup(
      (day) =>
        day === 1
          ? [
              entry({
                kind: 'infiltrator',
                base_problem: 'expired_passport',
                lever: { type: 'complaint', real: true, line: 'I complain!', amount: null },
              }),
              entry({
                kind: 'infiltrator',
                base_problem: 'expired_passport',
                techniques: [technique('clean_forgery', { target_doc: 'passport' })],
              }),
              entry({ legit_quirk: 'passport_expires_today' }),
              entry({ lever: { type: 'bribe', real: false, line: '', amount: 20 } }),
            ]
          : [],
      { loop: { odds: NEVER } },
    )
    await s.loop.startDay()
    // 1: caught in inspect mode after a question
    const first = callFirst(s.loop)
    await s.loop.ask({ kind: 'purpose' })
    s.loop.inspect(inspectKeys(first.applicant))
    s.loop.advanceClock(10)
    decideFully(s.loop, 'deny')
    // 2: slips through without a registry check
    s.loop.callNext()
    s.loop.advanceClock(5)
    decideFully(s.loop, 'approve')
    // 3: legit, denied by mistake after a registry check
    s.loop.callNext()
    const form = s.loop.openForm('registry')
    if (form.ok) s.loop.deepCheck(form.form, typed(form.form))
    decideFully(s.loop, 'deny')
    // 4: takes the envelope and approves
    s.loop.callNext()
    s.loop.acceptBribe()
    decideFully(s.loop, 'approve')
    s.loop.endShift()

    const obs = buildObservation(s.state.days[0]!)
    expect(obs.dayIndex).toBe(1)
    expect(obs.applicants.map((a) => a.result)).toEqual([
      'stopped',
      'got_through',
      'legit_denied',
      'legit_admitted',
      'not_processed',
      'not_processed',
    ])
    expect(obs.processed).toBe(4)
    expect(obs.notProcessed).toBe(2)
    expect(obs.infiltratorsThrough).toBe(1)
    expect(obs.infiltratorsStopped).toBe(1)
    expect(obs.legitDenied).toBe(1)
    expect(obs.toolUsage).toMatchObject({ inspect: 1, questions: 1, registry: 1, fingerprints: 0 })
    const [a, b, c, d] = obs.applicants
    expect(a?.flagged).toEqual(['PASSPORT_EXPIRED'])
    expect(a?.questions).toEqual(['What is the purpose of your visit?'])
    expect(a?.minutesSpent).toBeGreaterThanOrEqual(15)
    expect(a?.leverOutcome).toMatch(/documented \(PASSPORT_EXPIRED\)/)
    expect(b?.techniques).toEqual(['clean_forgery'])
    expect(b?.flagged).toEqual([])
    expect(c?.deepChecks).toEqual(['registry'])
    expect(c?.legitQuirk).toBe('passport_expires_today')
    expect(d?.bribeAccepted).toBe(true)
    expect(d?.leverOutcome).toMatch(/empty envelope/)
    expect(obs.averageMinutesPerApplicant).toBeGreaterThan(0)
    expect(obs.events.some((e) => e.includes('folded newspaper'))).toBe(true)
    expect(obs.planIssues.length).toBeGreaterThan(0)
    expect(observationHistory(s.state)).toEqual([obs])
  })

  it('only closed days are observed', async () => {
    const s = setup(() => [])
    await s.loop.startDay()
    expect(observationHistory(s.state)).toEqual([])
  })
})
