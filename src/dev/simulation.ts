// Complete games without an interface: the offline adversary against a bot player.

import { createOfflineAdversary } from '../ai/offlineAdversary'
import type { DifficultyId } from '../config'
import { DayLoop } from '../core/dayLoop'
import { createNewGame } from '../core/state'
import type { GameState } from '../core/types'
import type { BotKind } from './bots'
import { playShift } from './bots'

export interface GameSummary {
  seed: number
  difficulty: DifficultyId
  bot: BotKind
  daysPlayed: number
  daysTotal: number
  fired: boolean
  money: number
  applicants: number
  processed: number
  infiltratorsAttempted: number
  infiltratorsThrough: number
  infiltratorsStopped: number
  legitDenied: number
  deepChecks: number
  bribesTaken: number
  reports: number
  planIssues: number
  engineWarnings: number
  events: number
}

export interface SimulatedGame {
  summary: GameSummary
  state: GameState
}

export async function simulateGame(
  seed: number,
  difficulty: DifficultyId,
  bot: BotKind,
): Promise<SimulatedGame> {
  const state = createNewGame({ seed, difficulty, settings: { aiMode: 'offline' } })
  state.createdAt = '2041-03-04T06:00:00.000Z'
  const loop = new DayLoop(state, createOfflineAdversary(seed))
  while (state.phase === 'bulletin' || state.phase === 'evening') {
    await loop.startDay()
    await playShift(loop, bot, seed)
  }
  const summary: GameSummary = {
    seed,
    difficulty,
    bot,
    daysPlayed: state.days.length,
    daysTotal: state.daysTotal,
    fired: state.phase === 'gameover',
    money: state.economy.money,
    applicants: 0,
    processed: 0,
    infiltratorsAttempted: 0,
    infiltratorsThrough: 0,
    infiltratorsStopped: 0,
    legitDenied: 0,
    deepChecks: 0,
    bribesTaken: 0,
    reports: 0,
    planIssues: 0,
    engineWarnings: 0,
    events: 0,
  }
  for (const day of state.days) {
    summary.planIssues += day.plan.issues.length
    summary.events += day.events.length
    day.applicants.forEach((a, i) => {
      const o = day.outcomes[i]
      summary.applicants += 1
      if (a.notes.some((n) => n.startsWith('ENGINE WARNING'))) summary.engineWarnings += 1
      if (!a.admissible) summary.infiltratorsAttempted += 1
      if (!o) return
      if (o.decision !== 'none') summary.processed += 1
      if (!a.admissible && o.decision === 'approve') summary.infiltratorsThrough += 1
      if (!a.admissible && o.decision === 'deny') summary.infiltratorsStopped += 1
      if (a.admissible && o.decision === 'deny') summary.legitDenied += 1
      if (o.bribeAccepted) summary.bribesTaken += 1
      summary.reports += o.reported.length
      summary.deepChecks += o.actions.filter((x) => x.type === 'deepCheck').length
    })
  }
  return { summary, state }
}

export interface SimulationOptions {
  seeds: number[]
  difficulties: DifficultyId[]
  bots: BotKind[]
}

export async function runSimulation(options: SimulationOptions): Promise<GameSummary[]> {
  const results: GameSummary[] = []
  for (const difficulty of options.difficulties) {
    for (const bot of options.bots) {
      for (const seed of options.seeds) {
        results.push((await simulateGame(seed, difficulty, bot)).summary)
      }
    }
  }
  return results
}

export interface GroupTotals {
  difficulty: DifficultyId
  bot: BotKind
  games: number
  through: number
  attempted: number
  legitDenied: number
  fired: number
  averageMoney: number
  minMoney: number
  deepChecks: number
  notProcessed: number
  planIssues: number
}

export function totals(results: readonly GameSummary[]): GroupTotals[] {
  const groups = new Map<string, GameSummary[]>()
  for (const r of results) {
    const key = `${r.difficulty}|${r.bot}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()].map((list) => {
    const first = list[0] as GameSummary
    const sum = (f: (r: GameSummary) => number) => list.reduce((s, r) => s + f(r), 0)
    return {
      difficulty: first.difficulty,
      bot: first.bot,
      games: list.length,
      through: sum((r) => r.infiltratorsThrough),
      attempted: sum((r) => r.infiltratorsAttempted),
      legitDenied: sum((r) => r.legitDenied),
      fired: sum((r) => (r.fired ? 1 : 0)),
      averageMoney: Math.round(sum((r) => r.money) / list.length),
      minMoney: Math.min(...list.map((r) => r.money)),
      deepChecks: sum((r) => r.deepChecks),
      notProcessed: sum((r) => r.applicants - r.processed),
      planIssues: sum((r) => r.planIssues),
    }
  })
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width)
}

export function formatTotals(groups: readonly GroupTotals[]): string {
  const header = `${'difficulty'.padEnd(10)} ${'bot'.padEnd(9)} ${pad('games', 5)} ${pad('through', 13)} ${pad('legit denied', 12)} ${pad('fired', 5)} ${pad('avg money', 9)} ${pad('min money', 9)} ${pad('deep checks', 11)} ${pad('unprocessed', 11)} ${pad('plan issues', 11)}`
  const rows = groups.map(
    (g) =>
      `${g.difficulty.padEnd(10)} ${g.bot.padEnd(9)} ${pad(g.games, 5)} ${pad(`${g.through} / ${g.attempted}`, 13)} ${pad(g.legitDenied, 12)} ${pad(g.fired, 5)} ${pad(g.averageMoney, 9)} ${pad(g.minMoney, 9)} ${pad(g.deepChecks, 11)} ${pad(g.notProcessed, 11)} ${pad(g.planIssues, 11)}`,
  )
  return [header, ...rows].join('\n')
}
