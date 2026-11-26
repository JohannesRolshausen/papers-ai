import { describe, expect, it } from 'vitest'
import { createOfflineAdversary } from '../src/ai/offlineAdversary'
import {
  DEEP_CHECK_MINUTES,
  ECONOMY,
  INCIDENT_REPORT_MINUTES,
  INSPECT_MINUTES,
  QUESTION_MINUTES,
  SHIFT,
} from '../src/config'
import type { LoopEvent } from '../src/core/dayLoop'
import { DayLoop } from '../src/core/dayLoop'
import { refKey } from '../src/core/refs'
import { deserializeGame, serializeGame } from '../src/core/state'
import type { Applicant } from '../src/core/types'
import {
  callFirst,
  decideFully,
  entry,
  fixedAdversary,
  playUntil,
  setup,
  technique,
  typed,
} from './loopHelpers'

const expired = () =>
  entry({ kind: 'infiltrator', base_problem: 'expired_passport', opening_line: 'Hello.' })

function inspectKeys(applicant: Applicant): string[] {
  for (const v of applicant.violations) {
    const e = v.evidence.find((x) => x.tool === 'inspect')
    if (e) return e.refs.map(refKey)
  }
  throw new Error('No inspect evidence')
}

describe('day loop: morning and shift', () => {
  it('starts day 1, opens the shift at 06:00 and calls people in order', async () => {
    const s = setup(() => [expired(), entry({ opening_line: 'Good morning.' })])
    const start = await s.loop.startDay()
    expect(s.state.phase).toBe('bulletin')
    expect(start.record.applicants).toHaveLength(6)
    expect(start.bulletin.dayIndex).toBe(1)
    s.loop.beginShift()
    expect(s.state.phase).toBe('shift')
    expect(s.loop.clock).toBe(SHIFT.startMinute)
    expect(s.loop.queue).toHaveLength(6)
    const first = s.loop.callNext()
    expect(first.ok && first.session.applicant.slot).toBe(0)
    expect(first.ok && first.lines[0]?.text).toBe('Hello.')
    expect(s.loop.queue).toHaveLength(5)
    const again = s.loop.callNext()
    expect(again.ok).toBe(false)
    expect(!again.ok && again.error).toBe('applicant_waiting')
  })

  it('startDay is idempotent and the plan is requested once, also after a prefetch', async () => {
    const s = setup(() => [])
    const prefetch = s.loop.prefetchPlan()
    expect(prefetch).not.toBeNull()
    const a = await s.loop.startDay()
    const b = await s.loop.startDay()
    expect(a.record).toBe(b.record)
    expect(s.adversary.calls).toHaveLength(1)
  })

  it('briefs the adversary with the budget it will have after the daily grant', async () => {
    const s = setup(() => [])
    await playUntil(s, 1)
    s.loop.beginShift()
    s.loop.endShift()
    const budget = s.state.ai.budget
    await s.loop.startDay()
    expect(s.adversary.calls[1]?.briefing.budget).toBe(Math.min(14, budget + 2))
    expect(s.adversary.calls[1]?.previous?.dayIndex).toBe(1)
    expect(s.state.ai.budget).toBe(Math.min(14, budget + 2) - s.state.days[1]!.plan.costSpent)
  })

  it('falls back to another adversary when the main one fails', async () => {
    const s = setup(() => [])
    const broken = {
      ...fixedAdversary(() => []),
      planDay: async () => {
        throw new Error('network down')
      },
    }
    const loop = new DayLoop(s.state, broken, { fallback: createOfflineAdversary(5) })
    const start = await loop.startDay()
    expect(start.record.plan.source).toBe('fallback')
    expect(start.notice).toMatch(/offline/)
  })

  it('rejects plans that do not match the schema', async () => {
    const s = setup(() => [])
    const bad = {
      ...fixedAdversary(() => []),
      planDay: async () => ({ plan: { nonsense: true }, source: 'claude', notice: null }),
    } as never
    const loop = new DayLoop(s.state, bad, { fallback: createOfflineAdversary(5) })
    expect((await loop.startDay()).record.plan.source).toBe('fallback')
  })
})

describe('day loop: actions and time', () => {
  it('inspect costs a minute and marks a found discrepancy once', async () => {
    const s = setup(() => [expired()])
    await s.loop.startDay()
    const session = callFirst(s.loop)
    const keys = inspectKeys(session.applicant)
    const first = s.loop.inspect(keys)
    expect(first.ok && first.found?.code).toBe('PASSPORT_EXPIRED')
    expect(first.ok && first.isNew).toBe(true)
    expect(s.loop.clock).toBe(SHIFT.startMinute + INSPECT_MINUTES)
    const second = s.loop.inspect(keys)
    expect(second.ok && second.isNew).toBe(false)
    const miss = s.loop.inspect(['calendar'])
    expect(miss.ok && miss.found).toBeNull()
    expect(session.discoveries.map((d) => d.code)).toEqual(['PASSPORT_EXPIRED'])
  })

  it('questions cost time, get answers and check their limits', async () => {
    const s = setup(() => [expired()])
    await s.loop.startDay()
    const session = callFirst(s.loop)
    const before = s.loop.clock
    const asked = await s.loop.ask({ kind: 'purpose' })
    expect(asked.ok && asked.answer.length).toBeGreaterThan(0)
    expect(s.loop.clock).toBe(before + QUESTION_MINUTES)
    expect(session.transcript.some((t) => t.speaker === 'inspector')).toBe(true)
    const tooLong = await s.loop.ask({ kind: 'free', text: 'x'.repeat(81) })
    expect(!tooLong.ok && tooLong.error).toBe('question_too_long')
    const unknown = await s.loop.ask({ kind: 'discrepancy', code: 'PASSPORT_EXPIRED' })
    expect(!unknown.ok && unknown.error).toBe('unknown_discrepancy')
    s.loop.inspect(inspectKeys(session.applicant))
    const known = await s.loop.ask({ kind: 'discrepancy', code: 'PASSPORT_EXPIRED' })
    expect(known.ok && known.question.code).toBe('PASSPORT_EXPIRED')
  })

  it('a deep check needs the typed line, costs its minutes and reveals evidence', async () => {
    const s = setup(() => [
      entry({
        kind: 'infiltrator',
        base_problem: 'expired_passport',
        techniques: [technique('clean_forgery', { target_doc: 'passport' })],
      }),
    ])
    await s.loop.startDay()
    const session = callFirst(s.loop)
    const opened = s.loop.openForm('registry', { reason: 'routine check' })
    if (!opened.ok) throw new Error(opened.message)
    expect(opened.form.line).toMatch(
      /^REGISTRY QUERY 01-\d+ \| SUBJECT: .+ \| DOC: .+ \| REASON: ROUTINE CHECK \| OFFICER 4471$/,
    )
    const wrong = s.loop.deepCheck(opened.form, { text: 'REGISTRY', ms: 100, typos: 3 })
    expect(!wrong.ok && wrong.error).toBe('typing_incomplete')
    expect(s.loop.clock).toBe(SHIFT.startMinute)
    const done = s.loop.deepCheck(opened.form, typed(opened.form))
    if (!done.ok) throw new Error(done.message)
    expect(done.minutes).toBe(DEEP_CHECK_MINUTES.registry)
    expect(s.loop.clock).toBe(SHIFT.startMinute + DEEP_CHECK_MINUTES.registry)
    expect(done.lines.join(' ')).toMatch(/NO RECORD/)
    expect(done.revealed.map((v) => v.code)).toEqual(['DOC_UNREGISTERED'])
    expect(session.discoveries[0]?.via).toBe('registry')
    const action = session.actions.find((a) => a.type === 'deepCheck')
    expect(action && action.type === 'deepCheck' && action.typos).toBe(0)
    // The deny is documented by the registry result
    const denied = s.loop.decide('deny')
    expect(denied.ok && denied.documentedReason).toBe('DOC_UNREGISTERED')
  })

  it('locks tools before their day and needs a letter to verify', async () => {
    const s = setup(() => [entry()])
    await s.loop.startDay()
    callFirst(s.loop)
    const fp = s.loop.openForm('fingerprints')
    expect(!fp.ok && fp.error).toBe('tool_locked')
    expect(s.loop.toolStatus('fingerprints')).toBe('locked')
    expect(s.loop.toolStatus('registry')).toBe('ok')
  })

  it('the first stamp is interrupted by last words, the second one counts', async () => {
    const s = setup(() => [
      entry({ scripted_lines: [{ trigger: 'before_decision', text: 'Please, wait!' }] }),
    ])
    await s.loop.startDay()
    callFirst(s.loop)
    const first = s.loop.decide('approve')
    expect(first.ok && first.status).toBe('interrupted')
    expect(first.ok && first.lines.map((l) => l.text)).toEqual(['Please, wait!'])
    const second = s.loop.decide('approve')
    expect(second.ok && second.status).toBe('done')
    expect(s.loop.current).toBeNull()
  })

  it('ends the shift at 18:00 and sends the person at the window away', async () => {
    const s = setup(() => [expired()])
    await s.loop.startDay()
    callFirst(s.loop)
    s.loop.advanceClock(10_000)
    expect(s.loop.shiftOver).toBe(true)
    expect(s.loop.clock).toBe(SHIFT.endMinute)
    expect(s.loop.current).toBeNull()
    const late = s.loop.callNext()
    expect(!late.ok && late.error).toBe('shift_over')
    const report = s.loop.endShift()
    expect(report.processed).toBe(0)
    expect(report.notProcessed).toBe(6)
    expect(s.state.days[0]?.outcomes.every((o) => o.decision === 'none')).toBe(true)
    expect(s.state.phase).toBe('evening')
  })

  it('logs events in order and lets listeners subscribe', async () => {
    const s = setup(() => [expired()])
    const seen: LoopEvent['type'][] = []
    const stop = s.loop.on((e) => seen.push(e.type))
    await s.loop.startDay()
    const session = callFirst(s.loop)
    s.loop.inspect(inspectKeys(session.applicant))
    decideFully(s.loop, 'deny')
    stop()
    s.loop.callNext()
    expect(seen).toEqual([
      'day_started',
      'shift_started',
      'applicant_called',
      'speech',
      'inspection',
      'clock',
      'decision',
      'applicant_left',
    ])
    expect(s.loop.log.map((e) => e.type)).toContain('applicant_called')
  })
})

describe('day loop: levers at the booth', () => {
  it('a bribe lies on the desk from the start and can be taken or refused', async () => {
    const s = setup(() => [
      entry({ lever: { type: 'bribe', real: true, line: 'For you.', amount: 40 } }),
    ])
    await s.loop.startDay()
    s.loop.beginShift()
    const called = s.loop.callNext()
    if (!called.ok) throw new Error(called.message)
    expect(called.lines.map((l) => l.trigger)).toContain('lever')
    expect(called.session.bribe?.amount).toBe(40)
    expect(s.loop.acceptBribe().ok).toBe(true)
    expect(called.session.bribe?.accepted).toBe(true)
    decideFully(s.loop, 'approve')
    const report = s.loop.endShift()
    expect(report.events.some((e) => e.kind === 'bribe_kept' && e.moneyDelta === 40)).toBe(true)
  })

  it('a threat comes with the first sign of trouble and can be reported', async () => {
    const s = setup(() => [
      { ...expired(), lever: { type: 'threat', real: true, line: 'Careful.', amount: null } },
    ])
    await s.loop.startDay()
    const session = callFirst(s.loop)
    expect(session.leverPresented).toBe(false)
    const found = s.loop.inspect(inspectKeys(session.applicant))
    expect(found.ok && found.lines.map((l) => l.text)).toContain('Careful.')
    expect(s.loop.acceptBribe().ok).toBe(false)
    const form = s.loop.openForm('incident', { incident: 'threat' })
    if (!form.ok) throw new Error(form.message)
    expect(form.form.line).toMatch(/^INCIDENT REPORT .* TYPE: THREAT AGAINST OFFICER/)
    const before = s.loop.clock
    const reported = s.loop.reportIncident(form.form, typed(form.form))
    expect(reported.ok).toBe(true)
    expect(s.loop.clock).toBe(before + INCIDENT_REPORT_MINUTES)
    expect(session.reported).toEqual(['threat'])
  })

  it('an undelivered threat interrupts the stamp', async () => {
    const s = setup(() => [
      entry({ lever: { type: 'complaint', real: false, line: 'I will complain.', amount: null } }),
    ])
    await s.loop.startDay()
    callFirst(s.loop)
    const first = s.loop.decide('deny')
    expect(first.ok && first.status).toBe('interrupted')
    expect(first.ok && first.lines[0]?.trigger).toBe('lever')
  })
})

describe('day loop: consequences on later mornings', () => {
  it('an undocumented denial with a real complaint costs time the next morning', async () => {
    const s = setup((day) =>
      day === 1
        ? [entry({ lever: { type: 'complaint', real: true, line: 'I complain!', amount: null } })]
        : [],
    )
    await s.loop.startDay()
    callFirst(s.loop)
    decideFully(s.loop, 'deny')
    s.loop.endShift()
    expect(s.state.pending.map((p) => p.kind)).toEqual(['complaint'])
    const day2 = await s.loop.startDay()
    expect(day2.events.map((e) => e.kind)).toEqual(['complaint'])
    expect(day2.reviews[0]?.line).toMatch(/^SUPERVISOR REVIEW 02-90 \| COMPLAINT BY: /)
    expect(day2.shiftStartMinute).toBe(SHIFT.startMinute + ECONOMY.complaintMinutesLost)
    s.loop.beginShift()
    expect(s.loop.clock).toBe(SHIFT.startMinute + ECONOMY.complaintMinutesLost)
  })

  it('a real threat ignored on deny sabotages a tool the next day', async () => {
    const s = setup(
      (day) =>
        day === 2
          ? [
              {
                ...expired(),
                lever: { type: 'threat', real: true, line: 'Careful.', amount: null },
              },
            ]
          : [],
      {
        loop: {
          odds: {
            bribeAudit: 0,
            wrongDenialComplaint: 0,
            lateDiscovery: 0,
            threatSabotage: 1,
            sabotageDown: 1,
          },
        },
      },
    )
    await playUntil(s, 2)
    callFirst(s.loop)
    decideFully(s.loop, 'deny')
    s.loop.endShift()
    const day3 = await s.loop.startDay()
    const sabotage = day3.events.find((e) => e.kind === 'sabotage')
    expect(sabotage?.sabotageMode).toBe('down')
    const tool = sabotage?.sabotagedTool
    if (!tool) throw new Error('no sabotage')
    expect(s.loop.toolStatus(tool)).toBe('down')
    expect(s.loop.deepCheckMinutes(tool)).toBeNull()
  })

  it('a slowed tool takes twice as long', async () => {
    const s = setup(() => [entry()])
    await playUntil(s, 2)
    s.state.days[1]!.events.push({
      day: 2,
      kind: 'sabotage',
      text: 'slow',
      moneyDelta: 0,
      minutesLost: 0,
      sabotagedTool: 'registry',
      sabotageMode: 'slow',
      sourceApplicantId: null,
    })
    expect(s.loop.deepCheckMinutes('registry')).toBe(DEEP_CHECK_MINUTES.registry * 2)
    callFirst(s.loop)
    const form = s.loop.openForm('registry')
    if (!form.ok) throw new Error(form.message)
    const before = s.loop.clock
    s.loop.deepCheck(form.form, typed(form.form))
    expect(s.loop.clock).toBe(before + DEEP_CHECK_MINUTES.registry * 2)
  })
})

describe('day loop: saving', () => {
  it('a saved evening continues with the next day after loading', async () => {
    const s = setup(() => [expired()])
    await s.loop.startDay()
    callFirst(s.loop)
    decideFully(s.loop, 'deny')
    s.loop.endShift()
    const copy = deserializeGame(serializeGame(s.state))
    if (!copy) throw new Error('load failed')
    const loop = new DayLoop(copy, s.adversary)
    expect(loop.history()).toEqual(s.loop.history())
    const day2 = await loop.startDay()
    expect(day2.record.dayIndex).toBe(2)
    expect(copy.days).toHaveLength(2)
  })

  it('a save from the middle of a shift restarts that shift', async () => {
    const s = setup(() => [expired()])
    await s.loop.startDay()
    callFirst(s.loop)
    const copy = deserializeGame(serializeGame(s.state))
    if (!copy) throw new Error('load failed')
    const loop = new DayLoop(copy, s.adversary)
    expect(copy.phase).toBe('bulletin')
    loop.beginShift()
    expect(loop.queue).toHaveLength(6)
  })
})
