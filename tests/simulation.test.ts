import { describe, expect, it } from 'vitest'
import { runSimulation, simulateGame, totals } from '../src/dev/simulation'

describe('simulation against the offline adversary', () => {
  it('the perfect bot stops every infiltrator and keeps the job', async () => {
    const results = await runSimulation({
      seeds: [1, 2],
      difficulties: ['easy', 'normal', 'hard'],
      bots: ['perfect'],
    })
    for (const r of results) {
      expect(r.infiltratorsThrough, `${r.difficulty} seed ${r.seed}`).toBe(0)
      expect(r.legitDenied).toBe(0)
      expect(r.fired).toBe(false)
      expect(r.daysPlayed).toBe(r.daysTotal)
      expect(r.infiltratorsAttempted).toBeGreaterThan(0)
    }
  })

  it('the careless bot lets infiltrators through', async () => {
    const groups = totals(
      await runSimulation({
        seeds: [1, 2],
        difficulties: ['easy', 'normal', 'hard'],
        bots: ['careless'],
      }),
    )
    for (const g of groups) expect(g.through, g.difficulty).toBeGreaterThan(0)
  })

  it('the same seed gives the same simulation', async () => {
    const a = await simulateGame(7, 'easy', 'average')
    const b = await simulateGame(7, 'easy', 'average')
    expect(a.summary).toEqual(b.summary)
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })
})
