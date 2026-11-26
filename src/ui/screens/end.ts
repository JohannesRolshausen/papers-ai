// Game over and final report. Simple placeholders: the full debrief arrives in package 5.

import { el } from '../dom'

export interface EndData {
  kind: 'final' | 'gameover'
  lines: string[]
}

export function endScreen(data: EndData, onTitle: () => void): HTMLElement {
  const back = el('button', { className: 'btn primary big', text: 'Back to title' })
  back.type = 'button'
  back.dataset.action = 'to-title'
  back.addEventListener('click', onTitle)
  const title = data.kind === 'final' ? 'FINAL REPORT' : 'DISMISSED'
  const sub =
    data.kind === 'final'
      ? 'Your assignment at Checkpoint Seven is over.'
      : 'Two days in debt. The border service lets you go.'
  return el(
    'div',
    { className: `screen end-screen ${data.kind}` },
    el(
      'div',
      { className: 'ev-paper end-paper' },
      el('div', { className: 'ev-title', text: title }),
      el('div', { className: 'ev-sub', text: sub }),
      el('ul', { className: 'ev-events' }, ...data.lines.map((l) => el('li', { text: l }))),
      el('div', {
        className: 'ev-quiet',
        text: 'The full debrief with the adversary plans is not built yet.',
      }),
    ),
    el('div', { className: 'ev-footer' }, back),
  )
}
