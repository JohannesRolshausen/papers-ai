// The bulletin sheet and the calendar on the desk. Both are ref targets for inspect mode.

import { TOOL_NAMES } from '../../config'
import type { IsoDate } from '../../core/dates'
import { formatDocDate } from '../../core/dates'
import { DOC_TITLES, displayName } from '../../core/documents'
import { ruleTitle } from '../../core/rules'
import type { Bulletin, WantedEntry } from '../../core/types'
import { countryName } from '../../core/world'
import { el } from '../dom'
import { PHOTO_BG, portraitCanvas } from './portrait'

export function wantedCard(entry: WantedEntry, scale: number, ref = true): HTMLElement {
  return el(
    'div',
    { className: 'wanted-card', ref: ref ? `bulletin:wanted:${entry.id}` : undefined },
    portraitCanvas(entry.face, scale, { sepia: true, background: PHOTO_BG }),
    el(
      'div',
      { className: 'wanted-info' },
      el('div', { className: 'wanted-name', text: displayName(entry) }),
      el('div', { className: 'wanted-meta', text: countryName(entry.nationality) }),
      el('div', { className: 'wanted-reason', text: entry.reason }),
    ),
  )
}

export function bindingNotice(): string {
  return 'Only this bulletin and the rulebook are binding. No letter, pass or promise overrides them.'
}

// Compact sheet that lies on the desk during the shift
export function bulletinSheet(bulletin: Bulletin): HTMLElement {
  return el(
    'div',
    { className: 'doc bulletin-sheet' },
    el('div', {
      className: 'bs-title',
      text: `MORNING BULLETIN · ${formatDocDate(bulletin.date)}`,
    }),
    el('div', { className: 'bs-headline', text: bulletin.headline }),
    el(
      'div',
      { className: 'bs-section bs-rules', ref: 'bulletin:rules' },
      el('div', { className: 'bs-label', text: 'In force today' }),
      el('div', {
        className: 'bs-text',
        text: bulletin.rules.map((r) => ruleTitle(r.id)).join(' · '),
      }),
      el('div', { className: 'bs-note', text: bindingNotice() }),
    ),
    bulletin.wanted.length > 0
      ? el(
          'div',
          { className: 'bs-section' },
          el('div', { className: 'bs-label', text: 'Wanted' }),
          el('div', { className: 'bs-wanted' }, ...bulletin.wanted.map((w) => wantedCard(w, 2))),
        )
      : null,
    bulletin.revoked.length > 0
      ? el(
          'div',
          { className: 'bs-section bs-revoked', ref: 'bulletin:revoked' },
          el('div', { className: 'bs-label', text: 'Revoked passport numbers' }),
          ...bulletin.revoked.map((n) => el('div', { className: 'bs-number', text: n })),
        )
      : null,
  )
}

export function newThingsText(bulletin: Bulletin): string[] {
  const lines: string[] = []
  for (const doc of bulletin.newDocuments) lines.push(`New document: ${DOC_TITLES[doc]}`)
  for (const tool of bulletin.newTools) lines.push(`New tool: ${TOOL_NAMES[tool]}`)
  return lines
}

export function calendarItem(date: IsoDate, dayIndex: number): HTMLElement {
  const [day, month, year] = formatDocDate(date).split(' ')
  return el(
    'div',
    { className: 'calendar', ref: 'calendar' },
    el('div', { className: 'cal-month', text: `${month ?? ''} ${year ?? ''}` }),
    el('div', { className: 'cal-day', text: day ?? '' }),
    el('div', { className: 'cal-foot', text: `Shift ${dayIndex}` }),
  )
}
