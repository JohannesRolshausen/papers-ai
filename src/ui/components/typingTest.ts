// Typing test for documentation lines. Wrong characters show in red and must be corrected
// before the form can be filed. The game clock keeps running meanwhile.
// Correctness comes from compareTyping in the engine, the same check the controller applies.

import { compareTyping } from '../../core/docLines'
import type { TypingResult } from '../../core/docLines'
import { playKey } from '../audio'
import { el } from '../dom'

export interface TypingTestOptions {
  title: string
  line: string
  note?: string
  // Cancelling is not offered for forms that must be filed, such as supervisor reviews
  cancellable?: boolean
  onDone(result: TypingResult): void
  onCancel?(): void
}

export interface TypingTest {
  root: HTMLElement
  focus(): void
}

export function createTypingTest(options: TypingTestOptions): TypingTest {
  const { line } = options
  const cancellable = options.cancellable ?? true
  const input = el('input', {
    className: 'tt-input',
    attrs: {
      type: 'text',
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: String(line.length),
      'aria-label': 'Type the documentation line',
    },
  })
  const chars = [...line].map((ch) => el('span', { className: 'tt-char', text: ch }))
  const display = el('div', { className: 'tt-line' }, ...chars)
  const typosLabel = el('span', { className: 'tt-stat', text: 'Typos: 0' })
  const progress = el('span', { className: 'tt-stat', text: `0 / ${line.length}` })
  const fileButton = el('button', { className: 'btn primary', text: 'File form [Enter]' })
  fileButton.type = 'button'
  fileButton.disabled = true
  const cancelButton = el('button', { className: 'btn ghost', text: 'Cancel [Esc]' })
  cancelButton.type = 'button'

  let previous = ''
  let typos = 0
  let startedAt = 0
  let finished = false

  const render = () => {
    const value = input.value
    const result = compareTyping(line, value)
    chars.forEach((span, i) => {
      const state = result.states[i]
      const target = line[i] ?? ''
      span.className = 'tt-char'
      if (state === 'correct') {
        span.textContent = target
        span.classList.add('ok')
      } else if (state === 'wrong') {
        const typed = value[i] ?? ''
        // Show what was typed, a visible mark for a wrong space
        span.textContent = typed === ' ' ? '_' : typed
        span.classList.add('bad')
      } else {
        span.textContent = target
        if (i === value.length) span.classList.add('caret')
      }
    })
    typosLabel.textContent = `Typos: ${typos}`
    progress.textContent = `${value.length} / ${line.length}`
    fileButton.disabled = !result.complete
    display.classList.toggle('has-errors', result.typos > 0)
    return result
  }

  const finish = () => {
    if (finished || !compareTyping(line, input.value).complete) return
    finished = true
    options.onDone({
      text: input.value,
      ms: startedAt ? Math.round(performance.now() - startedAt) : 0,
      typos,
    })
  }

  const cancel = () => {
    if (finished || !cancellable) return
    finished = true
    options.onCancel?.()
  }

  input.addEventListener('input', () => {
    const value = input.value
    if (!startedAt && value.length > 0) startedAt = performance.now()
    // Count every wrong keystroke, even if it is corrected later
    if (value.length > previous.length) {
      const states = compareTyping(line, value).states
      let hadWrong = false
      for (let i = previous.length; i < value.length; i++) {
        if (states[i] !== 'correct') {
          typos += 1
          hadWrong = true
        }
      }
      playKey(hadWrong)
    } else if (value.length < previous.length) {
      playKey(false)
    }
    previous = value
    render()
  })
  input.addEventListener('paste', (e) => e.preventDefault())
  input.addEventListener('drop', (e) => e.preventDefault())
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  fileButton.addEventListener('click', finish)
  cancelButton.addEventListener('click', cancel)

  const root = el(
    'div',
    { className: 'typing-test' },
    el('div', { className: 'tt-title', text: options.title }),
    options.note ? el('div', { className: 'tt-note', text: options.note }) : null,
    el('div', { className: 'tt-label', text: 'Type the line exactly. Corrections required.' }),
    display,
    input,
    el(
      'div',
      { className: 'tt-foot' },
      typosLabel,
      progress,
      cancellable ? cancelButton : null,
      fileButton,
    ),
  )
  // Clicking anywhere on the form keeps the keyboard on the input
  root.addEventListener('pointerdown', (e) => {
    if (e.target !== fileButton && e.target !== cancelButton) {
      e.preventDefault()
      input.focus()
    }
  })
  render()
  return { root, focus: () => input.focus() }
}
