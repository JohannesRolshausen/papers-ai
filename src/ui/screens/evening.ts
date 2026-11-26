// Evening report: pay, deductions, living costs, balance, the day's events and the firing risk.

import { el, formatMoney } from '../dom'

export interface EveningData {
  dayIndex: number
  daysTotal: number
  processed: number
  notProcessed: number
  entries: { label: string; amount: number }[]
  balance: number
  events: string[]
  warning: string | null
  nextLabel: string
}

export function eveningScreen(data: EveningData, onContinue: () => void): HTMLElement {
  const total = data.entries.reduce((sum, e) => sum + e.amount, 0)
  const next = el('button', { className: 'btn primary big', text: data.nextLabel })
  next.type = 'button'
  next.dataset.action = 'evening-continue'
  next.addEventListener('click', onContinue)
  return el(
    'div',
    { className: 'screen evening-screen' },
    el(
      'div',
      { className: 'ev-paper' },
      el('div', {
        className: 'ev-title',
        text: `EVENING REPORT · DAY ${data.dayIndex} OF ${data.daysTotal}`,
      }),
      el('div', {
        className: 'ev-sub',
        text: `${data.processed} processed · ${data.notProcessed} sent home at closing`,
      }),
      el(
        'div',
        { className: 'ev-ledger' },
        ...data.entries.map((e) =>
          el(
            'div',
            { className: `ev-row${e.amount < 0 ? ' minus' : ''}` },
            el('span', { text: e.label }),
            el('span', { text: formatMoney(e.amount) }),
          ),
        ),
        el(
          'div',
          { className: 'ev-row total' },
          el('span', { text: 'Today' }),
          el('span', { text: formatMoney(total) }),
        ),
        el(
          'div',
          { className: `ev-row balance${data.balance < 0 ? ' minus' : ''}` },
          el('span', { text: 'Savings' }),
          el('span', { text: formatMoney(data.balance) }),
        ),
      ),
      el('div', { className: 'ev-label', text: 'Reports received today' }),
      data.events.length > 0
        ? el('ul', { className: 'ev-events' }, ...data.events.map((t) => el('li', { text: t })))
        : el('div', {
            className: 'ev-quiet',
            text: 'No reports. That does not mean nothing happened.',
          }),
      data.warning ? el('div', { className: 'ev-warning', text: data.warning }) : null,
    ),
    el('div', { className: 'ev-footer' }, next),
  )
}
