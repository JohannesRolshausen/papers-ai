// Evening report: pay, deductions, living costs, balance, the day's events and the firing risk.

import type { EveningReport } from '../../core/economy'
import { formatMoney } from '../../core/economy'
import { el } from '../dom'

export function eveningLabel(report: EveningReport): string {
  if (report.fired) return 'Clear your desk'
  if (report.lastDay) return 'Final report'
  return 'Next morning'
}

export interface EveningScreen {
  root: HTMLElement
  setBusy(busy: boolean): void
}

export function eveningScreen(
  report: EveningReport,
  daysTotal: number,
  onContinue: () => void,
): EveningScreen {
  const next = el('button', { className: 'btn primary big', text: eveningLabel(report) })
  next.type = 'button'
  next.dataset.action = 'evening-continue'
  next.addEventListener('click', onContinue)
  const root = el(
    'div',
    { className: 'screen evening-screen' },
    el(
      'div',
      { className: 'ev-paper' },
      el('div', {
        className: 'ev-title',
        text: `EVENING REPORT · DAY ${report.dayIndex} OF ${daysTotal}`,
      }),
      el('div', {
        className: 'ev-sub',
        text: `${report.processed} processed · ${report.notProcessed} sent home at closing`,
      }),
      el(
        'div',
        { className: 'ev-ledger' },
        ...report.ledger.map((e) =>
          el(
            'div',
            { className: `ev-row${e.amount < 0 ? ' minus' : ''}` },
            el('span', { text: e.label }),
            el('span', { text: formatMoney(e.amount) }),
          ),
        ),
        el(
          'div',
          { className: `ev-row total${report.net < 0 ? ' minus' : ''}` },
          el('span', { text: 'Today' }),
          el('span', { text: formatMoney(report.net) }),
        ),
        el(
          'div',
          { className: `ev-row balance${report.money < 0 ? ' minus' : ''}` },
          el('span', { text: 'Savings' }),
          el('span', { text: formatMoney(report.money) }),
        ),
      ),
      el('div', { className: 'ev-label', text: 'Reports received today' }),
      report.events.length > 0
        ? el(
            'ul',
            { className: 'ev-events' },
            ...report.events.map((e) => el('li', { text: e.text })),
          )
        : el('div', {
            className: 'ev-quiet',
            text: 'No reports. That does not mean nothing happened.',
          }),
      report.warning ? el('div', { className: 'ev-warning', text: report.warning }) : null,
    ),
    el('div', { className: 'ev-footer' }, next),
  )
  return {
    root,
    setBusy(busy) {
      next.disabled = busy
    },
  }
}
