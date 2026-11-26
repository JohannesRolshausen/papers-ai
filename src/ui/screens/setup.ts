// Setup: difficulty, adversary mode with API key and model, and shift length.

import type { DifficultyId } from '../../config'
import { DIFFICULTIES, SHIFT } from '../../config'
import type { ClaudeModelInfo, KeyCheck } from '../../ai/claudeAdversary'
import type { AdversaryModeInfo } from '../../ai/factory'
import type { AiMode } from '../../core/types'
import { createKeyForm } from '../components/keyForm'
import { el } from '../dom'
import type { StoredKey } from '../keyStore'

export interface SetupChoice {
  difficulty: DifficultyId
  aiMode: AiMode
  shiftRealSeconds: number
  model: string
  // Only in Claude mode. The app keeps it in browser storage, never in the save game.
  apiKey: string | null
  rememberKey: boolean
}

export interface SetupOptions {
  modes: AdversaryModeInfo[]
  models: readonly ClaudeModelInfo[]
  defaultModel: string
  storedKey: StoredKey | null
  checkKey(key: string, model: string): Promise<KeyCheck>
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
  const choice = {
    difficulty: 'easy' as DifficultyId,
    aiMode: (options.modes.find((m) => m.available)?.mode ?? 'offline') as AiMode,
    shiftRealSeconds: SHIFT.defaultRealSeconds as number,
  }
  const difficultyRow = el('div', { className: 'option-row' })
  const modeRow = el('div', { className: 'option-row' })
  const shiftRow = el('div', { className: 'option-row shift-row' })
  const keyForm = createKeyForm({
    models: options.models,
    model: options.defaultModel,
    key: options.storedKey?.key ?? '',
    remembered: options.storedKey?.remembered ?? false,
    checkKey: options.checkKey,
  })
  const claudePanel = el('div', { className: 'setup-claude' }, keyForm.root)

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
            if (m.mode === 'claude' && !keyForm.value().key) keyForm.focus()
          },
          m.available ? null : m.unavailableReason,
        )
        card.dataset.mode = m.mode
        return card
      }),
    )
    claudePanel.hidden = choice.aiMode !== 'claude'
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
  start.addEventListener('click', () => {
    const key = keyForm.value()
    if (choice.aiMode === 'claude' && !key.key) {
      keyForm.setStatus('Enter your API key or choose the offline adversary.', 'error')
      keyForm.focus()
      return
    }
    const claude = choice.aiMode === 'claude'
    options.onStart({
      ...choice,
      model: key.model,
      apiKey: claude ? key.key : null,
      rememberKey: claude && key.remember,
    })
  })
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
    claudePanel,
    el('div', { className: 'setup-label', text: 'Real time per shift (06:00 to 18:00)' }),
    shiftRow,
    el('div', { className: 'setup-buttons' }, back, start),
  )
}
