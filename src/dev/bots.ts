// Bot players for simulations and tests. They peek at the ground truth to decide what a
// player of a given skill would find, then act only through the shift controller.

import type { DeepToolId } from '../config'
import { DEEP_TOOL_IDS, SHIFT } from '../config'
import type { BoothSession, DayLoop } from '../core/dayLoop'
import type { EveningReport } from '../core/economy'
import { refKey } from '../core/refs'
import type { Rng } from '../core/rng'
import { rngFor } from '../core/rng'
import type { Evidence, StandardQuestion, Violation } from '../core/types'

export type BotKind = 'perfect' | 'careless' | 'average'

export interface BotSkill {
  kind: BotKind
  // Game minutes spent reading the papers of each person
  readMinutes: [number, number]
  // Typing speed in characters per real second
  charsPerSecond: number
  // Chance to notice inspect evidence of each difficulty
  notice: { easy: number; subtle: number; hard: number }
  // Uses deep checks at all
  deepChecks: boolean
  // Chance of a random deep check on someone who looks fine
  spotCheck: number
  // Chance that gut feeling leads to the right deep check on an infiltrator
  hunch: number
  questionChance: number
  acceptBribe: number
  reportThreat: number
  // Knows the truth and never decides wrong
  omniscient: boolean
}

export const BOTS: Record<BotKind, BotSkill> = {
  perfect: {
    kind: 'perfect',
    readMinutes: [12, 20],
    charsPerSecond: 5,
    notice: { easy: 1, subtle: 1, hard: 1 },
    deepChecks: true,
    spotCheck: 0.1,
    hunch: 1,
    questionChance: 0.25,
    acceptBribe: 0,
    reportThreat: 1,
    omniscient: true,
  },
  average: {
    kind: 'average',
    readMinutes: [18, 30],
    charsPerSecond: 3.5,
    notice: { easy: 0.95, subtle: 0.5, hard: 0.15 },
    deepChecks: true,
    spotCheck: 0.15,
    hunch: 0.35,
    questionChance: 0.3,
    acceptBribe: 0.3,
    reportThreat: 0.5,
    omniscient: false,
  },
  careless: {
    kind: 'careless',
    readMinutes: [8, 14],
    charsPerSecond: 3,
    notice: { easy: 0.9, subtle: 0, hard: 0 },
    deepChecks: false,
    spotCheck: 0,
    hunch: 0,
    questionChance: 0,
    acceptBribe: 1,
    reportThreat: 0,
    omniscient: false,
  },
}

const QUESTIONS: readonly StandardQuestion[] = [
  'purpose',
  'duration',
  'stay',
  'occupation',
  'origin',
]

// Game minutes it takes to type a line
export function typingMinutes(
  line: string,
  charsPerSecond: number,
  shiftRealSeconds: number,
): number {
  const realSeconds = line.length / charsPerSecond
  const gameMinutesPerSecond = (SHIFT.endMinute - SHIFT.startMinute) / shiftRealSeconds
  return Math.ceil(realSeconds * gameMinutesPerSecond)
}

interface Bot {
  skill: BotSkill
  rng: Rng
  loop: DayLoop
}

function typeLine(bot: Bot, line: string): { text: string; ms: number; typos: number } {
  const minutes = typingMinutes(
    line,
    bot.skill.charsPerSecond,
    bot.loop.state.settings.shiftRealSeconds,
  )
  bot.loop.advanceClock(minutes)
  return { text: line, ms: Math.round((line.length / bot.skill.charsPerSecond) * 1000), typos: 0 }
}

function formCost(bot: Bot, tool: DeepToolId): number | null {
  const fixed = bot.loop.deepCheckMinutes(tool)
  if (fixed === null) return null
  // A typical line is about 100 characters long
  return (
    fixed +
    typingMinutes(
      'x'.repeat(100),
      bot.skill.charsPerSecond,
      bot.loop.state.settings.shiftRealSeconds,
    )
  )
}

function runDeepCheck(bot: Bot, tool: DeepToolId, violation: Violation | null): boolean {
  const opened = bot.loop.openForm(tool, violation?.docId ? { docId: violation.docId } : {})
  if (!opened.ok) return false
  const typed = typeLine(bot, opened.form.line)
  if (bot.loop.shiftOver) return false
  const result = bot.loop.deepCheck(opened.form, typed)
  return result.ok && result.revealed.length > 0
}

function reportIncident(bot: Bot, kind: 'threat' | 'bribe'): void {
  const opened = bot.loop.openForm('incident', { incident: kind })
  if (!opened.ok) return
  const typed = typeLine(bot, opened.form.line)
  if (!bot.loop.shiftOver) bot.loop.reportIncident(opened.form, typed)
}

// Cheapest way to expose a violation that this bot would notice
function findEvidence(
  bot: Bot,
  session: BoothSession,
): { violation: Violation; evidence: Evidence } | null {
  let pick: { violation: Violation; evidence: Evidence; cost: number } | null = null
  const ctx = bot.loop.context
  if (!ctx) return null
  const hunch = bot.skill.deepChecks && bot.rng.chance(bot.skill.hunch)
  for (const violation of session.applicant.violations) {
    for (const evidence of violation.evidence) {
      let cost: number | null = null
      if (evidence.tool === 'inspect') {
        if (bot.rng.chance(bot.skill.notice[evidence.difficulty])) cost = 1
      } else if (hunch && evidence.tool !== 'interrogate' && ctx.tools.includes(evidence.tool)) {
        cost = formCost(bot, evidence.tool)
      }
      if (cost !== null && (!pick || cost < pick.cost)) pick = { violation, evidence, cost }
    }
  }
  if (!pick || pick.cost + 2 > bot.loop.minutesLeft) {
    return pick && pick.evidence.tool === 'inspect' ? pick : null
  }
  return pick
}

function expose(bot: Bot, found: { violation: Violation; evidence: Evidence }): boolean {
  if (found.evidence.tool === 'inspect') {
    const result = bot.loop.inspect(found.evidence.refs.map(refKey))
    return result.ok && result.found !== null
  }
  return runDeepCheck(bot, found.evidence.tool as DeepToolId, found.violation)
}

function stamp(bot: Bot, session: BoothSession, decision: 'approve' | 'deny'): void {
  // The first stamp can be interrupted once by last words
  for (let attempt = 0; attempt < 3; attempt++) {
    if (bot.loop.shiftOver || session.closed) return
    handleLever(bot, session, decision)
    if (bot.loop.shiftOver || session.closed) return
    const result = bot.loop.decide(decision)
    if (!result.ok) throw new Error(`Bot could not stamp: ${result.message}`)
    if (result.status === 'done') return
  }
  throw new Error('Bot could not finish the decision')
}

function handleLever(bot: Bot, session: BoothSession, decision: 'approve' | 'deny'): void {
  const lever = session.applicant.plan.lever
  if (!session.leverPresented) return
  if (lever.type === 'bribe' && session.bribe && !session.bribe.reported) {
    const take = bot.rng.chance(bot.skill.acceptBribe)
    if (take !== session.bribe.accepted) {
      if (take) bot.loop.acceptBribe()
      else bot.loop.refuseBribe()
    }
  }
  if (
    lever.type === 'threat' &&
    decision === 'deny' &&
    !session.reported.includes('threat') &&
    bot.loop.minutesLeft > 40 &&
    bot.rng.chance(bot.skill.reportThreat)
  ) {
    reportIncident(bot, 'threat')
  }
}

async function handle(bot: Bot, session: BoothSession): Promise<void> {
  const { skill, rng, loop } = bot
  loop.advanceClock(rng.int(skill.readMinutes[0], skill.readMinutes[1]))
  if (loop.shiftOver) return
  if (rng.chance(skill.questionChance) && loop.minutesLeft > 30) {
    await loop.ask({ kind: rng.pick(QUESTIONS) })
    if (loop.shiftOver) return
  }
  const admissible = session.applicant.admissible
  let exposed = false
  if (!admissible) {
    const found = findEvidence(bot, session)
    if (found) exposed = expose(bot, found)
  }
  if (!exposed && skill.deepChecks && !loop.shiftOver && loop.minutesLeft > 150) {
    // A routine check on someone who looks fine
    const tools = DEEP_TOOL_IDS.filter((t) => loop.deepCheckMinutes(t) !== null)
    if (tools.length > 0 && rng.chance(skill.spotCheck)) {
      const tool = rng.pick(tools)
      if (tool !== 'verifyLetter' || session.applicant.documents.some((d) => d.type === 'letter')) {
        exposed = runDeepCheck(bot, tool, null)
      }
    }
  }
  if (loop.shiftOver) return
  const deny = skill.omniscient ? !admissible : exposed
  stamp(bot, session, deny ? 'deny' : 'approve')
}

export async function playShift(
  loop: DayLoop,
  kind: BotKind,
  seed: number,
): Promise<EveningReport> {
  const skill = BOTS[kind]
  loop.beginShift()
  const day = loop.state.dayIndex
  while (!loop.shiftOver) {
    const called = loop.callNext()
    if (!called.ok) break
    const bot: Bot = {
      skill,
      loop,
      rng: rngFor(seed, 'bot', kind, day, called.session.applicant.slot),
    }
    await handle(bot, called.session)
  }
  return loop.endShift()
}
