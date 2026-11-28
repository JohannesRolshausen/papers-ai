// Final report and dismissal screen. Summarizes the assignment and leads into the full debrief.

import { DIFFICULTIES } from '../../config'
import type { DebriefReport } from '../../core/debrief'
import { formatMoney } from '../../core/economy'
import { el } from '../dom'

export interface EndScreenOptions {
  report: DebriefReport
  onDebrief(): void
  onTitle(): void
}

function formatTypingSummary(report: DebriefReport): string {
  const m = report.metrics
  if (m.typingForms === 0 || m.typingAccuracy === null) return 'No forms typed'
  const acc = `${Math.round(m.typingAccuracy * 100)}% accuracy`
  const cpm = m.typingCpm !== null ? ` · ${m.typingCpm} CPM` : ''
  return `${acc}${cpm} (${m.typingForms} ${m.typingForms === 1 ? 'form' : 'forms'})`
}

export function endScreen(options: EndScreenOptions): HTMLElement {
  const { report } = options
  const m = report.metrics
  const kind = report.kind

  const debriefButton = el('button', {
    className: 'btn primary big',
    text: 'Open full debrief',
  })
  debriefButton.type = 'button'
  debriefButton.dataset.action = 'open-debrief'
  debriefButton.addEventListener('click', options.onDebrief)

  const backButton = el('button', { className: 'btn ghost big', text: 'Back to title' })
  backButton.type = 'button'
  backButton.dataset.action = 'to-title'
  backButton.addEventListener('click', options.onTitle)

  const title = kind === 'final' ? 'FINAL REPORT' : 'DISMISSED'
  const sub =
    kind === 'final'
      ? `${DIFFICULTIES[report.difficulty].label} assignment · Checkpoint Seven · ${report.adversary.mode === 'claude' ? `Claude (${report.adversary.model ?? ''})` : 'Offline adversary'}`
      : 'Two consecutive days in debt. The Velmark Border Service ends your assignment.'

  const row = (label: string, value: string, tone: 'ok' | 'bad' | 'warn' | '' = '') =>
    el(
      'div',
      { className: `ev-row${tone ? ` end-${tone}` : ''}` },
      el('span', { text: label }),
      el('span', { text: value }),
    )

  const gradeTone =
    m.rating.grade === 'S' || m.rating.grade === 'A'
      ? 'good'
      : m.rating.grade === 'B'
        ? 'mid'
        : 'bad'

  const stamp = el(
    'div',
    { className: `end-grade-stamp ${gradeTone}` },
    el('div', { className: 'end-grade-letter', text: m.rating.grade }),
    el('div', { className: 'end-grade-title', text: m.rating.title }),
  )

  return el(
    'div',
    { className: `screen end-screen ${kind}` },
    el(
      'div',
      { className: 'ev-paper end-paper' },
      el(
        'div',
        { className: 'end-header' },
        el(
          'div',
          { className: 'end-header-text' },
          el('div', { className: 'ev-title', text: title }),
          el('div', { className: 'ev-sub', text: sub }),
          el('div', { className: 'end-rating-summary', text: m.rating.summary }),
        ),
        stamp,
      ),
      el(
        'div',
        { className: 'ev-ledger end-ledger' },
        row('Days worked', `${m.daysPlayed} of ${m.daysTotal}`),
        row('Travelers processed', `${m.processed} of ${m.applicantsTotal}`),
        row(
          'Infiltrators admitted',
          `${m.infiltratorsThrough} of ${m.infiltratorsAttempted} attempted`,
          m.infiltratorsThrough > 0 ? 'bad' : 'ok',
        ),
        m.infiltratorsNeverCaughtInland > 0
          ? row('Never detected inland', `${m.infiltratorsNeverCaughtInland}`, 'bad')
          : null,
        row(
          'Legitimate travelers denied',
          `${m.legitDenied} of ${m.legitTotal}`,
          m.legitDenied > 0 ? 'warn' : 'ok',
        ),
        row(
          'Time in deep checks',
          `${m.deepCheckMinutes} min (${m.deepCheckCount} ${m.deepCheckCount === 1 ? 'check' : 'checks'})`,
        ),
        row('Documentation typing', formatTypingSummary(report)),
        m.bribesTaken > 0
          ? row(
              'Bribes accepted',
              `${m.bribesTaken} (${formatMoney(m.bribesMoneyKept)} kept)`,
              'warn',
            )
          : null,
        el(
          'div',
          { className: `ev-row balance${m.money < 0 ? ' minus' : ''}` },
          el('span', { text: 'Final savings' }),
          el('span', { text: formatMoney(m.money) }),
        ),
      ),
      el('div', {
        className: 'end-debrief-hint',
        text: 'Open the full debrief to inspect the adversary’s daily strategies, every hidden technique, every missed clue, recurring character arcs, and export the dossier as JSON.',
      }),
    ),
    el('div', { className: 'ev-footer end-footer' }, backButton, debriefButton),
  )
}
