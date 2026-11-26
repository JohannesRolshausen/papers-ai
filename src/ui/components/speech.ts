// Speech bubble with a typewriter effect, and the running transcript under the window.
// Applicant text is set with textContent only.

import { el } from '../dom'

export interface Speech {
  root: HTMLElement
  say(text: string): Promise<void>
  // Streamed text from a live adversary replaces the bubble content as it arrives
  stream(partial: string): void
  clear(): void
}

const CHARS_PER_SECOND = 45

export function createSpeech(): Speech {
  const text = el('span', { className: 'speech-text' })
  const root = el('div', { className: 'speech empty' }, text)
  let timer: number | null = null
  let finishNow: (() => void) | null = null

  const stop = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  root.addEventListener('click', () => finishNow?.())

  return {
    root,
    say(line: string) {
      stop()
      finishNow?.()
      root.classList.remove('empty')
      text.textContent = ''
      if (!line) return Promise.resolve()
      return new Promise<void>((resolve) => {
        let shown = 0
        const done = () => {
          stop()
          text.textContent = line
          finishNow = null
          resolve()
        }
        finishNow = done
        timer = window.setInterval(() => {
          shown += 1
          text.textContent = line.slice(0, shown)
          if (shown >= line.length) done()
        }, 1000 / CHARS_PER_SECOND)
      })
    },
    stream(partial: string) {
      stop()
      finishNow = null
      root.classList.remove('empty')
      text.textContent = partial
    },
    clear() {
      stop()
      finishNow?.()
      finishNow = null
      text.textContent = ''
      root.classList.add('empty')
    },
  }
}

export interface Transcript {
  root: HTMLElement
  add(speaker: 'inspector' | 'applicant' | 'system', line: string): void
  clear(): void
}

export function createTranscript(): Transcript {
  const root = el('div', { className: 'transcript' })
  return {
    root,
    add(speaker, line) {
      const label = speaker === 'inspector' ? 'YOU' : speaker === 'applicant' ? 'THEM' : '--'
      root.append(
        el(
          'div',
          { className: `tr-line tr-${speaker}` },
          el('span', { className: 'tr-who', text: label }),
          el('span', { className: 'tr-text', text: line }),
        ),
      )
      root.scrollTop = root.scrollHeight
    },
    clear() {
      root.replaceChildren()
    },
  }
}
