import { describe, expect, it } from 'vitest'
import { CONSEQUENCES, ECONOMY } from '../src/config'
import { applyDueConsequences, leverOutcome } from '../src/core/consequences'
import { eveningReport, settleDay } from '../src/core/economy'
import { refKey } from '../src/core/refs'
import type { Applicant } from '../src/core/types'
import type { ConsequenceOdds } from '../src/core/consequences'
import {
  ALWAYS,
  NEVER,
  callFirst,
  decideFully,
  entry,
  playUntil,
  setup,
  typed,
} from './loopHelpers'

function inspectKeys(applicant: Applicant): string[] {
  for (const v of applicant.violations) {
    const e = v.evidence.find((x) => x.tool === 'inspect')
    if (e) return e.refs.map(refKey)
  }
  throw new Error('No inspect evidence')
}

const expired = (extra = {}) =>
  entry({ kind: 'infiltrator', base_problem: 'expired_passport', ...extra })

async function oneDecision(
  plan: ReturnType<typeof entry>,
  decision: 'approve' | 'deny',
  odds: ConsequenceOdds,
  act: (s: ReturnType<typeof setup>) => void = () => undefined,
) {
  const s = setup((day) => (day === 1 ? [plan] : []), { loop: { odds } })
  await s.loop.startDay()
  callFirst(s.loop)
  act(s)
  decideFully(s.loop, decision)
  const report = s.loop.endShift()
  return { s, report }
}

describe('economy', () => {
  it('pays wages per processed person and charges living costs', async () => {
    const s = setup(() => [])
    await s.loop.startDay()
    s.loop.beginShift()
    for (let i = 0; i < 4; i++) {
      s.loop.callNext()
      decideFully(s.loop, 'approve')
    }
    const report = s.loop.endShift()
    expect(report.processed).toBe(4)
    expect(report.notProcessed).toBe(2)
    expect(report.income).toBe(4 * ECONOMY.payPerApplicant)
    expect(report.expenses).toBe(-ECONOMY.livingCost)
    expect(report.money).toBe(
      ECONOMY.startingMoney + 4 * ECONOMY.payPerApplicant - ECONOMY.livingCost,
    )
  })

  it('fires after two days in debt in a row', async () => {
    const s = setup(() => [])
    s.state.economy.money = -10
    await s.loop.startDay()
    s.loop.beginShift()
    let report = s.loop.endShift()
    expect(report.daysInDebt).toBe(1)
    expect(report.warning).toMatch(/1 more day in debt/)
    expect(s.state.phase).toBe('evening')
    await s.loop.startDay()
    s.loop.beginShift()
    report = s.loop.endShift()
    expect(report.fired).toBe(true)
    expect(s.state.phase).toBe('gameover')
    await expect(s.loop.startDay()).rejects.toThrow()
  })

  it('a day out of debt resets the counter', () => {
    const s = setup(() => [])
    s.state.economy.daysInDebt = 1
    s.state.economy.money = 100
    const record = {
      dayIndex: 1,
      applicants: [],
      outcomes: [],
    } as unknown as Parameters<typeof settleDay>[1]
    const settlement = settleDay(s.state, record)
    expect(settlement.daysInDebt).toBe(0)
    expect(settlement.phase).toBe('evening')
  })

  it('the last day leads to the final phase', async () => {
    const s = setup(() => [], { difficulty: 'easy' })
    await playUntil(s, 7)
    s.loop.beginShift()
    const report = s.loop.endShift()
    expect(report.lastDay).toBe(true)
    expect(s.state.phase).toBe('final')
    expect(eveningReport(s.state, s.state.days[6]!).dayIndex).toBe(7)
  })
})

describe('consequences of levers', () => {
  it('a real bribe pays on approve and can be audited later', async () => {
    const plan = entry({ lever: { type: 'bribe', real: true, line: '', amount: 30 } })
    const { s, report } = await oneDecision(plan, 'approve', ALWAYS, (x) => x.loop.acceptBribe())
    expect(report.income).toBe(30 + 6 * 0 + ECONOMY.payPerApplicant)
    const audit = s.state.pending.find((p) => p.kind === 'audit')
    expect(audit?.moneyDelta).toBe(-30 * ECONOMY.bribeAuditFineFactor)
  })

  it('an empty bribe pays nothing, a refused or reported one has no consequences', async () => {
    const empty = await oneDecision(
      entry({ lever: { type: 'bribe', real: false, line: '', amount: 30 } }),
      'approve',
      ALWAYS,
      (x) => x.loop.acceptBribe(),
    )
    expect(empty.report.events.map((e) => e.kind)).toEqual(['note'])
    expect(empty.s.state.pending).toEqual([])
    const reported = await oneDecision(
      entry({ lever: { type: 'bribe', real: true, line: '', amount: 30 } }),
      'approve',
      ALWAYS,
      (x) => {
        x.loop.acceptBribe()
        const form = x.loop.openForm('incident', { incident: 'bribe' })
        if (form.ok) x.loop.reportIncident(form.form, typed(form.form))
      },
    )
    expect(reported.report.events).toEqual([])
    expect(reported.s.state.pending).toEqual([])
  })

  it('money from a bribe is only kept with APPROVE', async () => {
    const { report, s } = await oneDecision(
      expired({ lever: { type: 'bribe', real: true, line: '', amount: 30 } }),
      'deny',
      ALWAYS,
      (x) => x.loop.acceptBribe(),
    )
    expect(report.events.map((e) => e.kind)).toEqual(['note'])
    expect(s.state.pending.filter((p) => p.kind === 'audit')).toEqual([])
  })

  it('a real threat after an unreported denial is punished, a report neutralizes it', async () => {
    const threat = { type: 'threat' as const, real: true, line: 'Careful.', amount: null }
    const fine = await oneDecision(expired({ lever: threat }), 'deny', {
      ...NEVER,
      threatSabotage: 0,
    })
    expect(fine.s.state.pending.map((p) => [p.kind, p.moneyDelta])).toEqual([
      ['threat_fine', -CONSEQUENCES.threatFine],
    ])
    const reported = await oneDecision(expired({ lever: threat }), 'deny', ALWAYS, (x) => {
      x.loop.inspect(inspectKeys(x.loop.current!.applicant))
      const form = x.loop.openForm('incident', { incident: 'threat' })
      if (form.ok) x.loop.reportIncident(form.form, typed(form.form))
    })
    expect(reported.s.state.pending).toEqual([])
    const approved = await oneDecision(expired({ lever: threat }), 'approve', {
      ...ALWAYS,
      lateDiscovery: 0,
    })
    expect(approved.s.state.pending).toEqual([])
  })

  it('empty levers never have consequences', async () => {
    for (const type of ['threat', 'complaint'] as const) {
      const { s } = await oneDecision(
        expired({ lever: { type, real: false, line: 'x', amount: null } }),
        'deny',
        { ...ALWAYS, lateDiscovery: 0 },
      )
      expect(s.state.pending).toEqual([])
    }
  })

  it('a documented denial makes a real complaint harmless', async () => {
    const complaint = { type: 'complaint' as const, real: true, line: 'I complain!', amount: null }
    const documented = await oneDecision(expired({ lever: complaint }), 'deny', ALWAYS, (x) => {
      x.loop.inspect(inspectKeys(x.loop.current!.applicant))
    })
    expect(documented.s.state.pending).toEqual([])
    expect(documented.s.state.days[0]?.outcomes[0]?.documentedReason).toBe('PASSPORT_EXPIRED')
    const undocumented = await oneDecision(expired({ lever: complaint }), 'deny', ALWAYS)
    expect(undocumented.s.state.pending.map((p) => [p.kind, p.minutesLost])).toEqual([
      ['complaint', ECONOMY.complaintMinutesLost],
    ])
  })
})

describe('consequences of mistakes', () => {
  it('a wrongly denied traveler may complain the next day', async () => {
    const { s } = await oneDecision(entry(), 'deny', ALWAYS)
    expect(s.state.pending.map((p) => [p.kind, p.dueDay, p.moneyDelta])).toEqual([
      ['error_citation', 2, -ECONOMY.errorFine],
    ])
    const lucky = await oneDecision(entry(), 'deny', NEVER)
    expect(lucky.s.state.pending).toEqual([])
  })

  it('an admitted infiltrator may be detained inland on a later day', async () => {
    const { s } = await oneDecision(expired(), 'approve', ALWAYS)
    const late = s.state.pending.find((p) => p.kind === 'late_discovery')
    expect(late?.dueDay).toBe(2)
    expect(late?.text).toMatch(/An individual you admitted on Day 1 was detained inland/)
    const money = s.state.economy.money
    const events = applyDueConsequences(s.state, 2)
    expect(events.map((e) => e.kind)).toEqual(['late_discovery'])
    expect(s.state.economy.money).toBe(money - ECONOMY.errorFine)
    expect(s.state.pending).toEqual([])
    const hidden = await oneDecision(expired(), 'approve', NEVER)
    expect(hidden.s.state.pending).toEqual([])
  })

  it('describes how a lever played out for the adversary', async () => {
    const { s } = await oneDecision(
      expired({ lever: { type: 'threat', real: true, line: 'x', amount: null } }),
      'deny',
      NEVER,
      (x) => x.loop.inspect(inspectKeys(x.loop.current!.applicant)),
    )
    const day = s.state.days[0]!
    expect(leverOutcome(day.applicants[0]!, day.outcomes[0]!)).toMatch(/Retaliation follows/)
    expect(leverOutcome(day.applicants[1]!, day.outcomes[1]!)).toBeNull()
  })

  it('awards a bonus and neutralizes a complaint when a forged letter is reported', async () => {
    const s = setup(
      (day) =>
        day === 3
          ? [
              entry({
                kind: 'infiltrator',
                base_problem: 'expired_passport',
                techniques: [
                  {
                    type: 'fake_letter',
                    target_doc: null,
                    flaw: null,
                    field: null,
                    subtle: true,
                  },
                ],
                letter: {
                  title: 'Ministry Waiver',
                  sender: 'Ministry Office',
                  body: 'Admit bearer without delay.',
                  claims_exemption: true,
                },
                lever: { type: 'complaint', real: true, line: 'I will report you.', amount: null },
              }),
            ]
          : [],
      { loop: { odds: NEVER } },
    )
    await playUntil(s, 3)
    callFirst(s.loop)
    const form = s.loop.openForm('incident', { incident: 'letter' })
    expect(form.ok).toBe(true)
    if (form.ok) s.loop.reportIncident(form.form, typed(form.form))
    decideFully(s.loop, 'deny')
    s.loop.endShift()

    // Forged letter confirmed for day 4 bonus, and complaint lever neutralized despite no inspect
    expect(s.state.pending.some((p) => p.kind === 'complaint')).toBe(false)
    const bonus = s.state.pending.find((p) => p.kind === 'commendation')
    expect(bonus?.dueDay).toBe(4)
    expect(bonus?.moneyDelta).toBe(CONSEQUENCES.forgedLetterBonus)
  })

  it('notes when a reported letter turns out not to be forged', async () => {
    const { report, s } = await oneDecision(entry(), 'approve', NEVER, (x) => {
      const form = x.loop.openForm('incident', { incident: 'letter' })
      if (form.ok) x.loop.reportIncident(form.form, typed(form.form))
    })
    expect(report.events.some((e) => e.kind === 'note' && /no forgery/i.test(e.text))).toBe(true)
    expect(s.state.pending.some((p) => p.kind === 'commendation')).toBe(false)
  })
})
