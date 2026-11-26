// Setup: difficulty, adversary mode and shift length.

import type { DifficultyId } from '../../config'
import { DIFFICULTIES, SHIFT } from '../../config'
import type { AdversaryModeInfo } from '../../ai/factory'
import type { AiMode } from '../../core/types'
import { el } from '../dom'

export interface SetupChoice {
  difficulty: DifficultyId
  aiMode: AiMode
  shiftRealSeconds: number
}

export interface SetupOptions {
  modes: AdversaryModeInfo[]
  onStart(choice: SetupChoice): void
  onBack(): void
}

const SHIFT_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 360, label: '6 min' },
  { seconds: SHIFT.defaultRealSeconds, label: '9 min' },
  { seconds: 720, label: '12 min' },
  { seconds: 900, label: '15 min' },
]

function optionCard(
  title: string,
  text: string,
  selected: boolean,
  disabled: boolean,
  onPick: () => void,
  note: string | null = null,
): HTMLButtonElement {
  const card = el(
    'button',
    { className: `option-card${selected ? ' selected' : ''}` },
    el('div', { className: 'option-title', text: title }),
    el('div', { className: 'option-text', text }),
    note ? el('div', { className: 'option-note', text: note }) : null,
  )
  card.type = 'button'
  card.disabled = disabled
  card.addEventListener('click', onPick)
  return card
}

export function setupScreen(options: SetupOptions): HTMLElement {
  const choice: SetupChoice = {
    difficulty: 'easy',
    aiMode: options.modes.find((m) => m.available)?.mode ?? 'offline',
    shiftRealSeconds: SHIFT.defaultRealSeconds,
  }
  const difficultyRow = el('div', { className: 'option-row' })
  const modeRow = el('div', { className: 'option-row' })
  const shiftRow = el('div', { className: 'option-row shift-row' })

  const render = () => {
    difficultyRow.replaceChildren(
      ...Object.values(DIFFICULTIES).map((d) => {
        const card = optionCard(
          `${d.label} · ${d.days} days`,
          d.description,
          choice.difficulty === d.id,
          false,
          () => {
            choice.difficulty = d.id
            render()
          },
        )
        card.dataset.difficulty = d.id
        return card
      }),
    )
    modeRow.replaceChildren(
      ...options.modes.map((m) => {
        const card = optionCard(
          m.label,
          m.description,
          choice.aiMode === m.mode,
          !m.available,
          () => {
            choice.aiMode = m.mode
            render()
          },
          m.available ? null : m.unavailableReason,
        )
        card.dataset.mode = m.mode
        return card
      }),
    )
    shiftRow.replaceChildren(
      ...SHIFT_OPTIONS.map((s) => {
        const b = el('button', {
          className: `btn small${choice.shiftRealSeconds === s.seconds ? ' primary' : ' ghost'}`,
          text: s.label,
        })
        b.type = 'button'
        b.addEventListener('click', () => {
          choice.shiftRealSeconds = s.seconds
          render()
        })
        return b
      }),
    )
  }
  render()

  const start = el('button', { className: 'btn primary big', text: 'Report for duty' })
  start.type = 'button'
  start.addEventListener('click', () => options.onStart({ ...choice }))
  const back = el('button', { className: 'btn ghost', text: 'Back' })
  back.type = 'button'
  back.addEventListener('click', options.onBack)

  return el(
    'div',
    { className: 'screen setup-screen' },
    el('h2', { className: 'screen-title', text: 'Assignment' }),
    el('div', { className: 'setup-label', text: 'Length of the assignment' }),
    difficultyRow,
    el('div', { className: 'setup-label', text: 'Who plays the queue' }),
    modeRow,
    el('div', { className: 'setup-label', text: 'Real time per shift (06:00 to 18:00)' }),
    shiftRow,
    el('div', { className: 'setup-buttons' }, back, start),
  )
}
