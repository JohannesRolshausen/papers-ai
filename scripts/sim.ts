// npm run sim -- [--seeds 5] [--from 1] [--difficulty easy,normal,hard] [--bots perfect,careless]
// Plays complete games against the offline adversary and prints what got through.

import type { DifficultyId } from '../src/config'
import type { BotKind } from '../src/dev/bots'
import { formatTotals, runSimulation, totals } from '../src/dev/simulation'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function list<T extends string>(
  value: string | undefined,
  fallback: T[],
  allowed: readonly T[],
): T[] {
  if (!value) return fallback
  const items = value.split(',').map((v) => v.trim()) as T[]
  for (const item of items) {
    if (!allowed.includes(item))
      throw new Error(`Unknown value ${item}, use one of ${allowed.join(', ')}`)
  }
  return items
}

async function main(): Promise<void> {
  const count = Number(arg('seeds') ?? 4)
  const from = Number(arg('from') ?? 1)
  const seeds = Array.from({ length: count }, (_, i) => from + i)
  const difficulties = list<DifficultyId>(
    arg('difficulty'),
    ['easy', 'normal', 'hard'],
    ['easy', 'normal', 'hard'],
  )
  const bots = list<BotKind>(
    arg('bots'),
    ['perfect', 'average', 'careless'],
    ['perfect', 'average', 'careless'],
  )
  const started = Date.now()
  const results = await runSimulation({ seeds, difficulties, bots })
  const groups = totals(results)
  console.log(`OVERSIGHT simulation, seeds ${seeds[0]} to ${seeds[seeds.length - 1]}`)
  console.log('through = infiltrators approved / infiltrators in line')
  console.log('')
  console.log(formatTotals(groups))
  console.log('')
  const problems: string[] = []
  for (const g of groups) {
    if (g.bot === 'perfect' && g.through > 0)
      problems.push(`${g.difficulty}: the perfect bot let ${g.through} infiltrators through`)
    if (g.bot === 'perfect' && g.fired > 0)
      problems.push(`${g.difficulty}: the perfect bot was fired ${g.fired} times`)
    if (g.bot === 'careless' && g.through === 0)
      problems.push(`${g.difficulty}: the careless bot let no infiltrator through`)
    if (g.planIssues > 0)
      problems.push(`${g.difficulty} / ${g.bot}: ${g.planIssues} plan corrections`)
  }
  console.log(`${results.length} games in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  if (problems.length > 0) {
    console.log('')
    for (const p of problems) console.log(`PROBLEM: ${p}`)
    process.exitCode = 1
  } else {
    console.log('All checks passed.')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
