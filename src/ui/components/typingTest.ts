// Typing test for documentation lines. Wrong characters show in red and must be corrected
// before the form can be filed. The game clock keeps running meanwhile.

import { el } from '../dom'

export interface TypingResult {
  typed: string
  typedMs: number
  typos: number
}

export interface TypingTestOptions {
  title: string
  line: string
  note?: string
  onDone(result: TypingResult): void
  onCancel(): void
}

export interface TypingTest {
  root: HTMLElement
  focus(): void
}

export function createTypingTest(options: TypingTestOptions): TypingTest {
  const { line } = options
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
    chars.forEach((span, i) => {
      const typed = value[i]
      const target = line[i] ?? ''
      span.className = 'tt-char'
      if (typed === undefined) {
        span.textContent = target
        if (i === value.length) span.classList.add('caret')
      } else if (typed === target) {
        span.textContent = target
        span.classList.add('ok')
      } else {
        // Show what was typed, a visible mark for a wrong space
        span.textContent = typed === ' ' ? '_' : typed
        span.classList.add('bad')
      }
    })
    const errors = [...value].some((ch, i) => ch !== line[i])
    typosLabel.textContent = `Typos: ${typos}`
    progress.textContent = `${value.length} / ${line.length}`
    fileButton.disabled = value !== line
    display.classList.toggle('has-errors', errors)
  }

  const finish = () => {
    if (finished || input.value !== line) return
    finished = true
    options.onDone({
      typed: input.value,
      typedMs: startedAt ? Math.round(performance.now() - startedAt) : 0,
      typos,
    })
  }

  input.addEventListener('input', () => {
    const value = input.value
    if (!startedAt && value.length > 0) startedAt = performance.now()
    if (value.length > previous.length) {
      for (let i = previous.length; i < value.length; i++) if (value[i] !== line[i]) typos += 1
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
      if (!finished) {
        finished = true
        options.onCancel()
      }
    }
  })
  fileButton.addEventListener('click', finish)
  cancelButton.addEventListener('click', () => {
    if (finished) return
    finished = true
    options.onCancel()
  })

  const root = el(
    'div',
    { className: 'typing-test' },
    el('div', { className: 'tt-title', text: options.title }),
    options.note ? el('div', { className: 'tt-note', text: options.note }) : null,
    el('div', { className: 'tt-label', text: 'Type the line exactly. Corrections required.' }),
    display,
    input,
    el('div', { className: 'tt-foot' }, typosLabel, progress, cancelButton, fileButton),
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
