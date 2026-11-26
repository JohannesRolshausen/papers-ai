// Money: wages, living costs, fines, debt and dismissal.

import { ECONOMY } from '../config'
import type { DayRecord, Economy, GameEvent, GameState, LedgerEntry, Phase } from './types'

export const CURRENCY = 'cr'

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return `${sign}${Math.abs(Math.round(amount))} ${CURRENCY}`
}

export function addLedger(economy: Economy, day: number, label: string, amount: number): void {
  if (amount === 0) return
  economy.ledger.push({ day, label, amount })
  economy.money += amount
}

// Money from an event (fine, kept bribe). Events without money change nothing.
export function applyEventMoney(economy: Economy, event: GameEvent): void {
  if (event.moneyDelta !== 0) addLedger(economy, event.day, event.text, event.moneyDelta)
}

export function processedCount(record: DayRecord): number {
  return record.outcomes.filter((o) => o.decision !== 'none').length
}

export interface DaySettlement {
  wages: number
  livingCost: number
  money: number
  daysInDebt: number
  fired: boolean
  lastDay: boolean
  phase: Phase
}

// End of day: pay wages, charge living costs, update the debt counter and decide the phase.
// Evening events (kept bribes) must already be in record.events with their money applied.
export function settleDay(state: GameState, record: DayRecord): DaySettlement {
  const economy = state.economy
  const processed = processedCount(record)
  const wages = processed * ECONOMY.payPerApplicant
  addLedger(economy, record.dayIndex, `Wages (${processed} travelers processed)`, wages)
  addLedger(economy, record.dayIndex, 'Living costs', -ECONOMY.livingCost)
  economy.daysInDebt = economy.money < 0 ? economy.daysInDebt + 1 : 0
  const fired = economy.daysInDebt >= ECONOMY.debtDaysToFire
  const lastDay = record.dayIndex >= state.daysTotal
  const phase: Phase = fired ? 'gameover' : lastDay ? 'final' : 'evening'
  return {
    wages,
    livingCost: ECONOMY.livingCost,
    money: economy.money,
    daysInDebt: economy.daysInDebt,
    fired,
    lastDay,
    phase,
  }
}

export interface EveningReport {
  dayIndex: number
  processed: number
  notProcessed: number
  ledger: LedgerEntry[]
  income: number
  expenses: number
  net: number
  money: number
  daysInDebt: number
  fired: boolean
  lastDay: boolean
  // Everything that happened today: morning consequences and evening news
  events: GameEvent[]
  warning: string | null
}

export function eveningReport(state: GameState, record: DayRecord): EveningReport {
  const ledger = state.economy.ledger.filter((l) => l.day === record.dayIndex)
  const income = ledger.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0)
  const expenses = ledger.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)
  const processed = processedCount(record)
  const daysInDebt = state.economy.daysInDebt
  const fired = daysInDebt >= ECONOMY.debtDaysToFire
  const lastDay = record.dayIndex >= state.daysTotal
  let warning: string | null = null
  if (fired) {
    warning = `You were in debt for ${daysInDebt} days in a row. The Ministry has dismissed you.`
  } else if (daysInDebt > 0 && !lastDay) {
    const left = ECONOMY.debtDaysToFire - daysInDebt
    warning = `You are in debt. ${left} more ${left === 1 ? 'day' : 'days'} in debt and you will be dismissed.`
  }
  return {
    dayIndex: record.dayIndex,
    processed,
    notProcessed: record.applicants.length - processed,
    ledger,
    income,
    expenses,
    net: income + expenses,
    money: state.economy.money,
    daysInDebt,
    fired,
    lastDay,
    events: record.events,
    warning,
  }
}
