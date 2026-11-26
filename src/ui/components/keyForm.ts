// The API key form: key field, remember checkbox with a warning, model choice and a button
// that checks the key. Used on the setup screen and in the dialog after a rejected key.

import type { ClaudeModelInfo, KeyCheck } from '../../ai/claudeAdversary'
import { el } from '../dom'

export interface KeyFormOptions {
  models: readonly ClaudeModelInfo[]
  model: string
  key: string
  remembered: boolean
  checkKey(key: string, model: string): Promise<KeyCheck>
}

export interface KeyFormValue {
  key: string
  remember: boolean
  model: string
}

export interface KeyForm {
  root: HTMLElement
  value(): KeyFormValue
  setStatus(text: string, kind?: 'info' | 'ok' | 'error'): void
  // Checks the current key and shows the result
  check(): Promise<KeyCheck>
  focus(): void
}

export const REMEMBER_WARNING =
  'Stored unencrypted in the local storage of this browser. Anyone who uses this browser profile can read it. Without this the key is forgotten when the tab closes.'

export const KEY_HINT =
  'Use your own Anthropic API key. It stays in this browser and is sent only to the Anthropic API. Claude plans every day and answers your questions, so each game costs money on your account.'

export function createKeyForm(options: KeyFormOptions): KeyForm {
  let model = options.model
  const input = el('input', {
    className: 'key-input',
    attrs: {
      type: 'password',
      placeholder: 'sk-ant-...',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Anthropic API key',
    },
  })
  input.value = options.key
  input.dataset.field = 'api-key'
  // Typing in the field must not trigger the game's keyboard shortcuts
  input.addEventListener('keydown', (e) => e.stopPropagation())

  const status = el('div', { className: 'key-status', attrs: { role: 'status' } })
  const setStatus = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => {
    status.textContent = text
    status.className = `key-status ${kind}`
  }

  const checkButton = el('button', { className: 'btn small', text: 'Check key' })
  checkButton.type = 'button'
  checkButton.dataset.action = 'check-key'

  const remember = el('input', { attrs: { type: 'checkbox' } })
  remember.checked = options.remembered
  remember.dataset.field = 'remember-key'
  const rememberLabel = el(
    'label',
    { className: 'key-remember' },
    remember,
    el('span', { text: 'Remember on this device' }),
  )
  const warning = el('div', { className: 'key-warning', text: REMEMBER_WARNING })
  const syncWarning = () => {
    warning.hidden = !remember.checked
  }
  remember.addEventListener('change', syncWarning)
  syncWarning()

  const modelNote = el('div', { className: 'key-model-note' })
  const modelRow = el('div', { className: 'key-models' })
  const renderModels = () => {
    modelRow.replaceChildren(
      ...options.models.map((m) => {
        const b = el('button', {
          className: `btn small${m.id === model ? ' primary' : ' ghost'}`,
          text: m.label,
        })
        b.type = 'button'
        b.dataset.model = m.id
        b.addEventListener('click', () => {
          model = m.id
          renderModels()
        })
        return b
      }),
    )
    modelNote.textContent = options.models.find((m) => m.id === model)?.note ?? ''
  }
  renderModels()

  const check = async (): Promise<KeyCheck> => {
    checkButton.disabled = true
    setStatus('Checking the key...')
    try {
      const result = await options.checkKey(input.value, model)
      setStatus(result.message, result.ok ? 'ok' : 'error')
      return result
    } finally {
      checkButton.disabled = false
    }
  }
  checkButton.addEventListener('click', () => void check())

  const root = el(
    'div',
    { className: 'key-form' },
    el(
      'div',
      { className: 'key-row' },
      el('span', { className: 'key-label', text: 'API key' }),
      input,
      checkButton,
      status,
    ),
    el('div', { className: 'key-row' }, rememberLabel, warning),
    el(
      'div',
      { className: 'key-row' },
      el('span', { className: 'key-label', text: 'Model' }),
      modelRow,
      modelNote,
    ),
    el('div', { className: 'key-hint', text: KEY_HINT }),
  )

  return {
    root,
    value: () => ({ key: input.value.trim(), remember: remember.checked, model }),
    setStatus,
    check,
    focus: () => input.focus(),
  }
}
