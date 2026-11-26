// In-game calendar. Dates are ISO strings (YYYY-MM-DD) and all math runs in UTC.

export type IsoDate = string

export const GAME_START_DATE: IsoDate = '2041-03-04'

const DAY_MS = 86_400_000
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new Error(`Invalid date: ${date}`)
  }
  return [y, m, d]
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10)
}

export function toDayNumber(date: IsoDate): number {
  const [y, m, d] = parts(date)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function fromDayNumber(dayNumber: number): IsoDate {
  return fromUtc(dayNumber * DAY_MS)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days)
}

export function addYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = parts(date)
  const targetYear = y + years
  // Feb 29 falls back to Feb 28 in non-leap years
  const lastDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate()
  return fromUtc(Date.UTC(targetYear, m - 1, Math.min(d, lastDay)))
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return toDayNumber(a) - toDayNumber(b)
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) < 0
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) > 0
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from)
}

// Completed years from `from` to `to`
export function fullYearsBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  let years = ty - fy
  if (tm < fm || (tm === fm && td < fd)) years -= 1
  return years
}

export function dateForDay(dayIndex: number): IsoDate {
  return addDays(GAME_START_DATE, dayIndex - 1)
}

export function yearOf(date: IsoDate): number {
  return parts(date)[0]
}

// "04 MAR 2041", the format printed on documents
export function formatDocDate(date: IsoDate): string {
  const [y, m, d] = parts(date)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}
