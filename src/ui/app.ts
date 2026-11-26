// Game application: screen flow from the title to the final report.
// The game is saved after every phase.

import './styles.css'
import { DIFFICULTIES } from '../config'
import { clearSave, contextForDay, createNewGame, loadGame, saveGame } from '../core/state'
import type { GameState } from '../core/types'
import { formatMoney } from './dom'
import { bulletinScreen } from './screens/bulletin'
import { boothScreen } from './screens/booth'
import { endScreen } from './screens/end'
import { eveningScreen } from './screens/evening'
import type { AdversaryModeInfo, SetupChoice } from './screens/setup'
import { setupScreen } from './screens/setup'
import { titleScreen } from './screens/title'
import type { Session } from './session'
import type { ShiftPort } from './shiftPort'
import { createSession } from './session'
import { createStage } from './stage'

const MODES: AdversaryModeInfo[] = [
  {
    mode: 'offline',
    label: 'Offline adversary',
    description: 'A rule-based planner that runs in your browser. No account, no key.',
    available: true,
    unavailableReason: null,
  },
  {
    mode: 'claude',
    label: 'Claude',
    description: 'A language model plans every day and answers your questions in character.',
    available: false,
    unavailableReason: 'Coming in a later update. Needs your own API key.',
  },
]

// Under ?test the smoke test can read the ground truth of the person at the window.
// Never active in normal play.
function exposeTestHook(port: ShiftPort): void {
  if (!new URLSearchParams(window.location.search).has('test')) return
  ;(window as unknown as { __oversightTest: unknown }).__oversightTest = {
    current: () => port.current(),
    minute: () => port.minute(),
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

class App {
  private session: Session | null = null
  private cleanup: (() => void) | null = null

  constructor(private readonly stage: HTMLElement) {}

  private show(node: HTMLElement, cleanup: (() => void) | null = null): void {
    this.cleanup?.()
    this.cleanup = cleanup
    this.stage.replaceChildren(node)
  }

  private save(): void {
    const store = storage()
    if (store && this.session) saveGame(this.session.state, store)
  }

  title(): void {
    const store = storage()
    const saved = store ? loadGame(store) : null
    const resumable = saved && saved.phase !== 'final' && saved.phase !== 'gameover' ? saved : null
    this.show(
      titleScreen({
        save: resumable
          ? {
              label: `${DIFFICULTIES[resumable.difficulty].label} · day ${resumable.dayIndex} of ${resumable.daysTotal} · ${formatMoney(resumable.economy.money)}`,
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
        modes: MODES,
        onBack: () => this.title(),
        onStart: (choice) => this.newGame(choice),
      }),
    )
  }

  private newGame(choice: SetupChoice): void {
    const state = createNewGame({
      difficulty: choice.difficulty,
      settings: { aiMode: choice.aiMode, shiftRealSeconds: choice.shiftRealSeconds },
    })
    this.session = createSession(state)
    this.save()
    this.bulletin()
  }

  private resume(state: GameState): void {
    this.session = createSession(state)
    // A shift is never saved half done: resume at that day's bulletin
    if (state.phase === 'shift') state.phase = 'bulletin'
    if (state.phase === 'evening') this.evening()
    else this.bulletin()
  }

  private bulletin(): void {
    const session = this.session
    if (!session) return this.title()
    const state = session.state
    state.phase = 'bulletin'
    this.save()
    const screen = bulletinScreen({
      ctx: contextForDay(state),
      money: state.economy.money,
      notices: session.notices(),
      busy: false,
      onStart: () => {
        screen.setBusy(true)
        session
          .startShift()
          .then((port) => {
            exposeTestHook(port)
            const booth = boothScreen({
              port,
              shiftRealSeconds: state.settings.shiftRealSeconds,
              onShiftOver: () => this.evening(),
            })
            this.show(booth.root, booth.destroy)
          })
          .catch((error: unknown) => {
            screen.setBusy(false)
            console.error(error)
            window.alert(
              `The shift could not start: ${error instanceof Error ? error.message : 'unknown error'}`,
            )
          })
      },
    })
    this.show(screen.root)
  }

  private evening(): void {
    const session = this.session
    if (!session) return this.title()
    const data = session.evening()
    this.save()
    this.show(
      eveningScreen(data, () => {
        const phase = session.advance()
        this.save()
        if (phase === 'final' || phase === 'gameover') this.end(phase)
        else this.bulletin()
      }),
    )
  }

  private end(kind: 'final' | 'gameover'): void {
    const session = this.session
    const lines = session ? session.summary() : []
    this.show(
      endScreen({ kind, lines }, () => {
        const store = storage()
        if (store) clearSave(store)
        this.session = null
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
