// Game application: screen flow from the title to the final report.
// The shift controller (DayLoop) runs the game, the screens only show it.
// The game is saved after every phase.

import './styles.css'
import { AdversaryKeyError } from '../ai/adversary'
import type { ClaudeAdversary, ClaudeFetch } from '../ai/claudeAdversary'
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  isClaudeMemory,
  isClaudeModel,
  verifyClaudeKey,
} from '../ai/claudeAdversary'
import { ADVERSARY_MODES, createAdversaries, freeQuestionsEnabled } from '../ai/factory'
import { DIFFICULTIES } from '../config'
import type { DayStart } from '../core/dayLoop'
import { DayLoop } from '../core/dayLoop'
import type { EveningReport } from '../core/economy'
import { eveningReport, formatMoney } from '../core/economy'
import { clearSave, contextForDay, createNewGame, loadGame, saveGame } from '../core/state'
import type { GameState } from '../core/types'
import { createScriptedClaudeFetch } from '../dev/mockClaude'
import type { MockFetch } from '../dev/mockClaude'
import { createKeyForm } from './components/keyForm'
import { createTypingTest } from './components/typingTest'
import { el } from './dom'
import { loadApiKey, saveApiKey } from './keyStore'
import type { BulletinScreen } from './screens/bulletin'
import { bulletinScreen } from './screens/bulletin'
import { boothScreen } from './screens/booth'
import { endScreen } from './screens/end'
import { eveningScreen } from './screens/evening'
import type { SetupChoice } from './screens/setup'
import { setupScreen } from './screens/setup'
import { titleScreen } from './screens/title'
import { createStage } from './stage'

// Under ?test the smoke test can read the ground truth of the person at the window.
// Never active in normal play.
function exposeTestHook(loop: DayLoop): void {
  if (!new URLSearchParams(window.location.search).has('test')) return
  const target = window as unknown as { __oversightTest: unknown }
  target.__oversightTest = {
    current: () => loop.current?.applicant ?? null,
    minute: () => loop.clock,
  }
}

// Under ?test&mock=claude the Claude adversary talks to a scripted stand-in for the API, so
// the smoke test can play in Claude mode without a key. Never active in normal play.
let mock: MockFetch | null | undefined
function mockFetch(): ClaudeFetch | undefined {
  if (mock === undefined) {
    const params = new URLSearchParams(window.location.search)
    mock =
      params.has('test') && params.get('mock') === 'claude'
        ? createScriptedClaudeFetch({ planDelayMs: 900 })
        : null
    if (mock) {
      const calls = mock.calls
      const target = window as unknown as { __oversightMock: unknown }
      target.__oversightMock = {
        calls: () =>
          calls.map((c) => ({ method: c.method, path: c.path, stream: c.body?.stream === true })),
      }
    }
  }
  return mock ?? undefined
}

// Under ?test&seed=N a new game uses that seed, so the smoke test is repeatable
function testSeed(): number | undefined {
  const params = new URLSearchParams(window.location.search)
  const seed = Number(params.get('seed'))
  return params.has('test') && Number.isInteger(seed) && seed > 0 ? seed : undefined
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Notices for the morning bulletin: consequences that arrived and planner fallbacks
function morningNotices(day: DayStart): string[] {
  const notices = day.events.map((e) => e.text)
  if (day.notice) notices.push(day.notice)
  return notices
}

class App {
  private loop: DayLoop | null = null
  private claude: ClaudeAdversary | null = null
  // The key typed in this tab, in case the browser refuses to store it
  private sessionKey: string | null = null
  private cleanup: (() => void) | null = null

  constructor(private readonly stage: HTMLElement) {}

  private show(node: HTMLElement, cleanup: (() => void) | null = null): void {
    this.cleanup?.()
    this.cleanup = cleanup
    this.stage.replaceChildren(node)
  }

  private save(): void {
    const store = storage()
    if (store && this.loop) saveGame(this.loop.state, store)
  }

  private attach(state: GameState): DayLoop {
    if (!isClaudeModel(state.settings.model)) state.settings.model = DEFAULT_CLAUDE_MODEL
    const fetch = mockFetch()
    const { main, fallback, claude } = createAdversaries(state.settings, state.seed, {
      apiKey: this.sessionKey ?? loadApiKey()?.key ?? null,
      ...(fetch ? { fetch } : {}),
    })
    this.claude = claude
    this.loop = new DayLoop(state, main, { fallback })
    exposeTestHook(this.loop)
    return this.loop
  }

  private checkKey = (key: string, model: string) => {
    const fetch = mockFetch()
    return verifyClaudeKey(key, model, fetch ? { fetch } : {})
  }

  title(): void {
    const store = storage()
    const saved = store ? loadGame(store) : null
    const resumable = saved && saved.phase !== 'final' && saved.phase !== 'gameover' ? saved : null
    this.show(
      titleScreen({
        save: resumable
          ? {
              label: `${DIFFICULTIES[resumable.difficulty].label} · day ${resumable.dayIndex} of ${resumable.daysTotal} · ${formatMoney(resumable.economy.money)}${resumable.settings.aiMode === 'claude' ? ' · Claude' : ''}`,
            }
          : null,
        onContinue: () => resumable && this.resume(resumable),
        onNewGame: () => this.setup(),
      }),
    )
  }

  private setup(): void {
    this.show(
      setupScreen({
        modes: ADVERSARY_MODES,
        models: CLAUDE_MODELS,
        defaultModel: DEFAULT_CLAUDE_MODEL,
        storedKey: loadApiKey(),
        checkKey: this.checkKey,
        onBack: () => this.title(),
        onStart: (choice) => this.newGame(choice),
      }),
    )
  }

  private newGame(choice: SetupChoice): void {
    if (choice.aiMode === 'claude' && choice.apiKey) {
      this.sessionKey = choice.apiKey
      saveApiKey(choice.apiKey, choice.rememberKey)
    }
    const state = createNewGame({
      difficulty: choice.difficulty,
      settings: {
        aiMode: choice.aiMode,
        model: choice.model,
        shiftRealSeconds: choice.shiftRealSeconds,
      },
      seed: testSeed(),
    })
    this.attach(state)
    this.save()
    this.morning()
  }

  private resume(state: GameState): void {
    const loop = this.attach(state)
    // The controller turns a save from the middle of a shift back into its morning
    if (loop.phase === 'evening') {
      const last = state.days[state.days.length - 1]
      if (last) {
        this.evening(eveningReport(state, last))
        return
      }
    }
    this.morning()
  }

  // Shows the bulletin of the coming day at once and prepares the day behind it
  private morning(): void {
    const loop = this.loop
    if (!loop) return this.title()
    const day = loop.nextDayIndex() ?? loop.state.dayIndex
    const ctx =
      loop.context && loop.context.dayIndex === day ? loop.context : contextForDay(loop.state, day)
    let start: DayStart | null = null
    const screen = bulletinScreen({
      ctx,
      money: loop.state.economy.money,
      onStart: () => this.startShift(screen, start),
    })
    this.show(screen.root)
    loop
      .startDay()
      .then((prepared) => {
        start = prepared
        this.save()
        screen.setMorning(morningNotices(prepared), loop.state.economy.money)
        screen.setBusy(false)
      })
      .catch((error: unknown) => {
        if (error instanceof AdversaryKeyError && this.claude) {
          screen.setBusy(true, 'Claude needs a working API key.')
          this.askForKey(screen, error)
          return
        }
        console.error(error)
        screen.setBusy(true, 'The day could not be prepared. Reload to try again.')
      })
  }

  // The key is missing or was rejected: enter a new one, or play the rest of the game offline
  private askForKey(screen: BulletinScreen, error: AdversaryKeyError): void {
    const loop = this.loop
    const claude = this.claude
    if (!loop || !claude) return
    const stored = loadApiKey()
    const form = createKeyForm({
      models: CLAUDE_MODELS,
      model: claude.model,
      key: error.problem === 'missing' ? (stored?.key ?? '') : '',
      remembered: stored?.remembered ?? false,
      checkKey: this.checkKey,
    })
    form.setStatus(error.message, 'error')
    const retry = el('button', { className: 'btn primary', text: 'Use this key' })
    retry.type = 'button'
    retry.dataset.action = 'key-retry'
    const offline = el('button', { className: 'btn ghost', text: 'Play on offline' })
    offline.type = 'button'
    offline.dataset.action = 'key-offline'
    const layer = el(
      'div',
      { className: 'screen-modal' },
      el(
        'div',
        { className: 'dialog key-dialog' },
        el('div', { className: 'dialog-title', text: 'CLAUDE NEEDS AN API KEY' }),
        el('div', {
          className: 'key-dialog-text',
          text: 'This game plays against Claude. With a working key Claude plans the day. You can also play the rest of this game against the offline adversary.',
        }),
        form.root,
        el('div', { className: 'dialog-buttons' }, offline, retry),
      ),
    )
    retry.addEventListener('click', () => {
      void (async () => {
        retry.disabled = true
        const value = form.value()
        const result = await form.check()
        retry.disabled = false
        if (!result.ok) return
        this.sessionKey = value.key
        saveApiKey(value.key, value.remember)
        claude.setCredentials(value.key, value.model)
        loop.state.settings.model = value.model
        layer.remove()
        this.save()
        this.morning()
      })()
    })
    offline.addEventListener('click', () => {
      const state = loop.state
      state.settings.aiMode = 'offline'
      // Keep the offline adversary's own memory of the days it planned
      if (isClaudeMemory(state.adversaryMemory)) {
        state.adversaryMemory = state.adversaryMemory.offline ?? null
      }
      layer.remove()
      this.attach(state)
      this.save()
      this.morning()
    })
    screen.root.append(layer)
    form.focus()
  }

  private startShift(screen: BulletinScreen, day: DayStart | null): void {
    if (!this.loop || !day) return
    screen.setBusy(true, '')
    // Supervisor reviews from complaints: the time is already lost, the form still gets typed
    const reviews = [...day.reviews]
    const next = () => {
      const review = reviews.shift()
      if (!review) {
        this.booth()
        return
      }
      const test = createTypingTest({
        title: 'SUPERVISOR REVIEW · FORM',
        line: review.line,
        note: review.event.text,
        cancellable: false,
        onDone: () => {
          layer.remove()
          next()
        },
      })
      const layer = el('div', { className: 'screen-modal' }, test.root)
      screen.root.append(layer)
      test.focus()
    }
    next()
  }

  private booth(): void {
    const loop = this.loop
    if (!loop) return this.title()
    loop.beginShift()
    const booth = boothScreen({
      loop,
      shiftRealSeconds: loop.state.settings.shiftRealSeconds,
      freeQuestions: freeQuestionsEnabled(loop.state.settings),
      ...(this.claude ? { subscribeNotices: this.claude.onNotice.bind(this.claude) } : {}),
      onShiftOver: () => {
        const report = loop.endShift()
        this.save()
        this.evening(report)
      },
    })
    this.show(booth.root, booth.destroy)
  }

  private evening(report: EveningReport): void {
    const loop = this.loop
    if (!loop) return this.title()
    const state = loop.state
    const screen = eveningScreen(report, state.daysTotal, () => {
      if (state.phase === 'final' || state.phase === 'gameover') this.end(state.phase)
      else this.morning()
    })
    // Ask for tomorrow's plan now, so the morning loads quickly
    loop.prefetchPlan()?.catch(() => undefined)
    this.show(screen.root)
  }

  private end(kind: 'final' | 'gameover'): void {
    const state = this.loop?.state
    const lines: string[] = []
    if (state) {
      const processed = state.days.reduce(
        (sum, d) => sum + d.outcomes.filter((o) => o.decision !== 'none').length,
        0,
      )
      lines.push(
        `Days worked: ${state.days.length} of ${state.daysTotal}`,
        `People processed: ${processed}`,
        `Savings: ${formatMoney(state.economy.money)}`,
      )
    }
    this.show(
      endScreen({ kind, lines }, () => {
        const store = storage()
        if (store) clearSave(store)
        this.loop = null
        this.title()
      }),
    )
  }
}

export function startApp(): void {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) return
  const app = new App(createStage(root))
  app.title()
}
