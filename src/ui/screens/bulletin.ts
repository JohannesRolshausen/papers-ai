// Morning bulletin: headline, changes, rules, wanted list, revoked numbers, new tools and
// documents. Day 1 adds a short tutorial.

import { formatDocDate } from '../../core/dates'
import { ruleTitle } from '../../core/rules'
import type { DayContext } from '../../core/types'
import { el, formatMoney } from '../dom'
import { bindingNotice, newThingsText, wantedCard } from '../components/bulletin'

export interface BulletinScreenOptions {
  ctx: DayContext
  money: number
  notices: string[]
  busy: boolean
  onStart(): void
}

const TUTORIAL = [
  'Press CALL NEXT to bring someone to the window. Their papers land on your desk.',
  'Compare papers with the person, the rulebook, this bulletin and the calendar.',
  'Press INSPECT (key I), then click two things that should agree. A real discrepancy turns red and unlocks a question.',
  'Deep checks need a typed form and cost time. Typos must be corrected.',
  'Stamp APPROVE or DENY. A denial counts as documented if you found a discrepancy first.',
  'You are paid per person. Mistakes cost money. The clock keeps running. Pause with P.',
]

export interface BulletinScreen {
  root: HTMLElement
  setBusy(busy: boolean, text?: string): void
}

export function bulletinScreen(options: BulletinScreenOptions): BulletinScreen {
  const { ctx } = options
  const b = ctx.bulletin
  const start = el('button', { className: 'btn primary big', text: 'Open the booth' })
  start.type = 'button'
  start.dataset.action = 'start-shift'
  start.addEventListener('click', options.onStart)
  const status = el('div', { className: 'bulletin-status' })

  const setBusy = (busy: boolean, text = 'The queue is forming...') => {
    start.disabled = busy
    status.textContent = busy ? text : ''
  }
  setBusy(options.busy)

  const changes = [...b.changes, ...newThingsText(b)]
  const left = el(
    'div',
    { className: 'bn-col' },
    el('div', { className: 'bn-label', text: 'Changes today' }),
    changes.length > 0
      ? el('ul', { className: 'bn-list' }, ...changes.map((c) => el('li', { text: c })))
      : el('div', { className: 'bn-text', text: 'No changes.' }),
    options.notices.length > 0 ? el('div', { className: 'bn-label', text: 'Notices' }) : null,
    options.notices.length > 0
      ? el(
          'ul',
          { className: 'bn-list bn-notices' },
          ...options.notices.map((n) => el('li', { text: n })),
        )
      : null,
    ctx.dayIndex === 1 ? el('div', { className: 'bn-label', text: 'First shift' }) : null,
    ctx.dayIndex === 1
      ? el(
          'ol',
          { className: 'bn-list bn-tutorial' },
          ...TUTORIAL.map((t) => el('li', { text: t })),
        )
      : null,
  )

  const middle = el(
    'div',
    { className: 'bn-col bn-rules' },
    el('div', { className: 'bn-label', text: 'Rules in force' }),
    ...b.rules.map((r, i) =>
      el(
        'div',
        { className: 'bn-rule' },
        el('div', { className: 'bn-rule-title', text: `${i + 1}. ${ruleTitle(r.id)}` }),
        el('div', { className: 'bn-text', text: r.text }),
      ),
    ),
    el('div', { className: 'bn-binding', text: bindingNotice() }),
  )

  const right = el(
    'div',
    { className: 'bn-col' },
    el('div', { className: 'bn-label', text: 'Wanted' }),
    b.wanted.length > 0
      ? el('div', { className: 'bn-wanted' }, ...b.wanted.map((w) => wantedCard(w, 2, false)))
      : el('div', { className: 'bn-text', text: 'No wanted notices yet.' }),
    el('div', { className: 'bn-label', text: 'Revoked passport numbers' }),
    b.revoked.length > 0
      ? el('div', { className: 'bn-numbers' }, ...b.revoked.map((n) => el('div', { text: n })))
      : el('div', { className: 'bn-text', text: 'None.' }),
  )

  const root = el(
    'div',
    { className: 'screen bulletin-screen' },
    el(
      'div',
      { className: 'bn-paper' },
      el(
        'div',
        { className: 'bn-mast' },
        el('span', { text: 'VELMARK BORDER SERVICE' }),
        el('span', { className: 'bn-mast-title', text: 'MORNING BULLETIN' }),
        el('span', {
          text: `DAY ${ctx.dayIndex} OF ${ctx.daysTotal} · ${formatDocDate(ctx.date)}`,
        }),
      ),
      el('div', { className: 'bn-headline', text: b.headline }),
      el('div', { className: 'bn-columns' }, left, middle, right),
    ),
    el(
      'div',
      { className: 'bn-footer' },
      el('div', { className: 'bn-money', text: `Savings: ${formatMoney(options.money)}` }),
      status,
      start,
    ),
  )
  return { root, setBusy }
}
