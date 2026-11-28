// The booth: the main shift screen. It shows what the shift controller (DayLoop) reports and
// sends the player's actions back to it. No game rules are decided here.

import type { DeepToolId } from '../../config'
import { DEEP_TOOL_IDS, SHIFT, TOOL_NAMES } from '../../config'
import { formatDocDate } from '../../core/dates'
import type {
  BoothSession,
  LoopEvent,
  OpenForm,
  QuestionRequest,
  SpokenLine,
} from '../../core/dayLoop'
import type { DayLoop } from '../../core/dayLoop'
import { STANDARD_QUESTIONS } from '../../core/dayLoop'
import { FORM_TITLES, REASON_CHOICES, reasonFromCode } from '../../core/docLines'
import type { TypingResult } from '../../core/docLines'
import { DOC_TITLES, isNumbered } from '../../core/documents'
import { formatMoney } from '../../core/economy'
import type { Decision, IncidentKind, StandardQuestion, ViolationCode } from '../../core/types'
import {
  isMuted,
  onMuteChange,
  playClockTick,
  playPrinter,
  playSpeaker,
  playStamp,
  toggleMuted,
} from '../audio'
import { bulletinSheet, calendarItem } from '../components/bulletin'
import { renderDocument, renderReportSlip } from '../components/document'
import { portraitCanvas } from '../components/portrait'
import { createClockView, createQueue } from '../components/queue'
import { createRulebook } from '../components/rulebook'
import { createSpeech, createTranscript } from '../components/speech'
import { createTypingTest } from '../components/typingTest'
import { el, formatMinute, hashText } from '../dom'
import { bringToFront, makeDraggable, placeAt } from '../stage'

export interface BoothOptions {
  loop: DayLoop
  shiftRealSeconds: number
  freeQuestions: boolean
  // Notices from the adversary during the shift, for example a rejected API key
  subscribeNotices?: (show: (text: string) => void) => () => void
  // Called once the player leaves the booth after the shift is over
  onShiftOver(): void
}

export interface BoothScreen {
  root: HTMLElement
  destroy(): void
}

const QUESTIONS: { kind: StandardQuestion; label: string }[] = [
  { kind: 'purpose', label: 'Purpose' },
  { kind: 'duration', label: 'Length of stay' },
  { kind: 'stay', label: 'Accommodation' },
  { kind: 'occupation', label: 'Occupation' },
  { kind: 'origin', label: 'Coming from' },
]

const INCIDENTS: { kind: IncidentKind; label: string }[] = [
  { kind: 'threat', label: 'Threat against an officer' },
  { kind: 'bribe', label: 'Attempted bribery' },
  { kind: 'letter', label: 'Suspicious letter' },
]

const SHORT_TOOL: Record<DeepToolId, string> = {
  registry: 'Registry',
  fingerprints: 'Fingerprints',
  bodyScan: 'Body scan',
  verifyLetter: 'Verify letter',
}

// Where the papers of a new person land: two columns, then fanned on top
const DOC_SPOTS: [number, number][] = [
  [14, 12],
  [384, 12],
  [14, 306],
  [384, 306],
  [196, 152],
  [100, 84],
  [290, 230],
]

const RULER_MIN = 140
const RULER_MAX = 210
const RULER_PX = 3.6

type Choice = { label: string; value: string }

export function boothScreen(options: BoothOptions): BoothScreen {
  const { loop } = options
  const ctx = loop.context
  if (!ctx) throw new Error('The booth needs a started day')

  // ---------- State of the screen ----------
  let paused = false
  let finished = false
  let modalOpen = false
  let busy = false
  let inspecting = false
  let selected: string[] = []
  let armed: Decision | null = null
  let lastFrame = performance.now()
  let carry = 0
  let raf = 0
  let lastLateTickMinute = -1
  let lastLateTickReal = 0
  const minutesPerSecond = (SHIFT.endMinute - SHIFT.startMinute) / options.shiftRealSeconds
  const applicantItems: HTMLElement[] = []
  let envelope: HTMLElement | null = null
  let slipCount = 0

  const session = (): BoothSession | null => {
    const s = loop.current
    return s && !s.closed ? s : null
  }

  // ---------- Top bar ----------
  const clock = createClockView()
  const queue = createQueue()
  const moneyLabel = el('div', { className: 'tb-money' })
  const muteButton = el('button', { className: 'btn small ghost mute-btn' })
  muteButton.type = 'button'
  muteButton.dataset.action = 'toggle-mute'
  const syncMuteButton = (muted: boolean) => {
    muteButton.textContent = muted ? 'Muted [M]' : 'Sound [M]'
    muteButton.title = muted ? 'Unmute booth audio (M)' : 'Mute booth audio (M)'
    muteButton.classList.toggle('muted', muted)
  }
  syncMuteButton(isMuted())
  const pauseButton = el('button', { className: 'btn small ghost', text: 'Pause [P]' })
  pauseButton.type = 'button'
  const nextButton = el('button', { className: 'btn primary', text: 'Call next' })
  nextButton.type = 'button'
  nextButton.dataset.action = 'call-next'
  const topbar = el(
    'div',
    { className: 'topbar' },
    el(
      'div',
      { className: 'tb-day' },
      el('div', { className: 'tb-day-main', text: `DAY ${ctx.dayIndex} / ${ctx.daysTotal}` }),
      el('div', { className: 'tb-day-date', text: formatDocDate(ctx.date) }),
    ),
    clock.root,
    moneyLabel,
    el(
      'div',
      { className: 'tb-queue' },
      el('span', { className: 'tb-label', text: 'Queue' }),
      queue.root,
    ),
    el('div', { className: 'tb-spacer' }),
    muteButton,
    pauseButton,
    nextButton,
  )

  // ---------- Window ----------
  const speech = createSpeech()
  const transcript = createTranscript()
  const ruler = el('div', { className: 'ruler', ref: 'person:height' })
  for (let cm = RULER_MIN; cm <= RULER_MAX; cm += 5) {
    const tick = el('div', { className: `ruler-tick${cm % 10 === 0 ? ' major' : ''}` })
    tick.style.bottom = `${(cm - RULER_MIN) * RULER_PX}px`
    if (cm % 10 === 0) tick.append(el('span', { text: String(cm) }))
    ruler.append(tick)
  }
  const heightMarker = el('div', { className: 'height-marker hidden' })
  ruler.append(heightMarker)
  const personSlot = el('div', { className: 'person-slot' })
  const scaleValue = el('div', { className: 'scale-value', text: '-- kg' })
  const scaleView = el(
    'div',
    { className: 'scale-view', ref: 'person:weight' },
    el('div', { className: 'scale-label', text: 'SCALE' }),
    scaleValue,
  )
  const shutter = el('div', { className: 'shutter', text: 'NEXT PLEASE' })
  speech.root.classList.add('window-speech')
  const windowView = el(
    'div',
    { className: 'window-view' },
    el('div', { className: 'window-wall' }),
    ruler,
    personSlot,
    scaleView,
    shutter,
    speech.root,
  )
  const luggageItems = el('span', { className: 'luggage-items', text: '-' })
  const luggage = el(
    'div',
    { className: 'luggage', ref: 'person:luggage' },
    el('span', { className: 'tb-label', text: 'Luggage' }),
    luggageItems,
  )

  // ---------- Questions ----------
  const questionButtons = QUESTIONS.map((q) => {
    const b = el('button', {
      className: 'btn small q-btn',
      text: q.label,
      title: STANDARD_QUESTIONS[q.kind],
    })
    b.type = 'button'
    b.dataset.question = q.kind
    b.addEventListener('click', () => void ask({ kind: q.kind }, STANDARD_QUESTIONS[q.kind]))
    return b
  })
  const discrepancyButton = el('button', {
    className: 'btn small danger q-btn q-discrepancy',
    text: 'Ask about a discrepancy (inspect first)',
  })
  discrepancyButton.type = 'button'
  discrepancyButton.dataset.question = 'discrepancy'
  discrepancyButton.addEventListener('click', () => {
    const found = latestDiscovery()
    if (found) void ask({ kind: 'discrepancy', code: found.code }, null)
  })
  const freeInput = el('input', {
    className: 'free-input',
    attrs: { type: 'text', maxlength: '80', placeholder: 'Ask anything (80 characters)' },
  })
  const freeButton = el('button', { className: 'btn small', text: 'Ask' })
  freeButton.type = 'button'
  const freeNote = el('div', {
    className: 'free-note',
    text: options.freeQuestions ? '' : 'Free questions need the Claude adversary.',
  })
  const submitFree = () => {
    const text = freeInput.value.trim().slice(0, 80)
    if (!text) return
    freeInput.value = ''
    void ask({ kind: 'free', text }, text)
  }
  freeButton.addEventListener('click', submitFree)
  freeInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') submitFree()
  })
  const questions = el(
    'div',
    { className: 'questions' },
    el('div', { className: 'q-grid' }, ...questionButtons),
    discrepancyButton,
    el('div', { className: 'free-row' }, freeInput, freeButton),
    freeNote,
  )
  const windowCol = el(
    'div',
    { className: 'window-col' },
    windowView,
    luggage,
    transcript.root,
    questions,
  )

  // ---------- Desk ----------
  const deskArea = el('div', { className: 'desk-area' })
  const rulebook = createRulebook(ctx)
  const bulletin = bulletinSheet(ctx.bulletin)
  const calendar = calendarItem(ctx.date, ctx.dayIndex)
  calendar.classList.add('desk-fixed')
  placeAt(calendar, 754, 552)
  deskArea.append(calendar)
  const canDrag = () => !inspecting && !armed
  const topDeskZ = () =>
    Math.max(0, ...[...deskArea.children].map((c) => Number((c as HTMLElement).style.zIndex || 0)))
  // Rulebook and bulletin can be put away to make room. On day 1 both start open.
  const panels = [
    { node: rulebook.root, left: 356, top: 214, label: 'Rulebook' },
    { node: bulletin, left: 404, top: 8, label: 'Bulletin' },
  ].map((panel) => {
    const button = el('button', { className: 'btn small ghost panel-btn', text: panel.label })
    button.type = 'button'
    const close = el('button', { className: 'panel-close', text: 'x', title: 'Put away' })
    close.type = 'button'
    panel.node.append(close)
    placeAt(panel.node, panel.left, panel.top)
    makeDraggable(panel.node, { bounds: deskArea, canDrag })
    deskArea.append(panel.node)
    const setOpen = (open: boolean) => {
      panel.node.classList.toggle('hidden', !open)
      button.classList.toggle('active', open)
      if (open) bringToFront(panel.node)
    }
    button.addEventListener('click', () => {
      const hidden = panel.node.classList.contains('hidden')
      const covered = Number(panel.node.style.zIndex || 0) < topDeskZ()
      setOpen(hidden || covered)
    })
    close.addEventListener('click', () => setOpen(false))
    setOpen(ctx.dayIndex === 1)
    return button
  })

  const stampApprove = el('button', { className: 'stamp stamp-approve', text: 'APPROVE' })
  const stampDeny = el('button', { className: 'stamp stamp-deny', text: 'DENY' })
  stampApprove.type = 'button'
  stampDeny.type = 'button'
  stampApprove.dataset.action = 'stamp-approve'
  stampDeny.dataset.action = 'stamp-deny'
  const stampHint = el('div', { className: 'stamp-hint' })
  const stampRack = el('div', { className: 'stamp-rack' }, stampApprove, stampDeny, stampHint)

  const inspectButton = el('button', { className: 'btn small tool-btn', text: 'Inspect [I]' })
  inspectButton.type = 'button'
  inspectButton.dataset.action = 'inspect'
  const deepButtons = new Map<DeepToolId, HTMLButtonElement>()
  for (const tool of DEEP_TOOL_IDS) {
    if (!ctx.tools.includes(tool)) continue
    const b = el('button', { className: 'btn small tool-btn', text: SHORT_TOOL[tool] })
    b.type = 'button'
    b.dataset.tool = tool
    b.addEventListener('click', () => startDeepCheck(tool))
    deepButtons.set(tool, b)
  }
  const incidentButton = el('button', {
    className: 'btn small tool-btn danger',
    text: 'Incident',
    title: 'File an incident report',
  })
  incidentButton.type = 'button'
  incidentButton.dataset.action = 'incident'
  const IDLE_BANNER =
    'Drag papers to arrange · Press I to inspect · Pick a stamp to approve or deny.'
  const inspectBanner = el('div', { className: 'inspect-banner idle', text: IDLE_BANNER })
  const toolbar = el(
    'div',
    { className: 'toolbar' },
    inspectButton,
    ...deepButtons.values(),
    incidentButton,
    el('div', { className: 'tb-spacer' }),
    ...panels,
  )
  const modalLayer = el('div', { className: 'modal-layer hidden' })
  const desk = el(
    'div',
    { className: 'desk' },
    deskArea,
    stampRack,
    inspectBanner,
    toolbar,
    modalLayer,
  )

  const resumeButton = el('button', { className: 'btn primary', text: 'Resume' })
  resumeButton.type = 'button'
  const pauseOverlay = el(
    'div',
    { className: 'overlay hidden' },
    el(
      'div',
      { className: 'overlay-box' },
      el('div', { className: 'overlay-title', text: 'PAUSED' }),
      resumeButton,
    ),
  )
  const endOverlay = el('div', { className: 'overlay hidden' })

  const root = el(
    'div',
    { className: 'screen booth' },
    topbar,
    windowCol,
    desk,
    pauseOverlay,
    endOverlay,
  )

  // ---------- Helpers ----------

  const latestDiscovery = () => {
    const s = session()
    return s ? (s.discoveries[s.discoveries.length - 1] ?? null) : null
  }

  const refreshTop = () => {
    const late = loop.minutesLeft <= 60
    clock.set(loop.clock, late)
    queue.set(loop.queue.length)
    moneyLabel.textContent = formatMoney(loop.state.economy.money)
    if (late && loop.minutesLeft > 0 && !paused && !finished && loop.clock !== lastLateTickMinute) {
      const now = performance.now()
      lastLateTickMinute = loop.clock
      if (now - lastLateTickReal >= 550) {
        lastLateTickReal = now
        playClockTick(loop.minutesLeft <= 15)
      }
    }
  }

  const refreshControls = () => {
    const s = session()
    const active = s !== null
    const blocked = busy || modalOpen || finished || paused
    nextButton.disabled = blocked || active
    nextButton.textContent = loop.queue.length === 0 && !active ? 'Close booth' : 'Call next'
    for (const b of questionButtons) b.disabled = blocked || !active
    const found = latestDiscovery()
    discrepancyButton.disabled = blocked || !active || !found
    discrepancyButton.textContent = found
      ? `Ask about: ${found.violation.message}`
      : 'Ask about a discrepancy (inspect first)'
    freeInput.disabled = blocked || !active || !options.freeQuestions
    freeButton.disabled = freeInput.disabled
    inspectButton.disabled = blocked
    inspectButton.classList.toggle('active', inspecting)
    for (const [tool, b] of deepButtons) {
      const status = loop.toolStatus(tool)
      const minutes = loop.deepCheckMinutes(tool)
      b.disabled = blocked || !active || status === 'down' || !deepToolUsable(tool, s)
      b.textContent =
        status === 'down'
          ? `${SHORT_TOOL[tool]} (out)`
          : status === 'slow'
            ? `${SHORT_TOOL[tool]} (slow)`
            : SHORT_TOOL[tool]
      b.title =
        status === 'down'
          ? 'Out of order today'
          : `${minutes ?? '?'} minutes plus a typed form${status === 'slow' ? ', slowed down today' : ''}`
    }
    incidentButton.disabled = blocked || !active
    stampApprove.disabled = blocked || !active
    stampDeny.disabled = blocked || !active
    stampApprove.classList.toggle('armed', armed === 'approve')
    stampDeny.classList.toggle('armed', armed === 'deny')
    if (armed) stampHint.textContent = 'Click a document to stamp it, or the stamp again.'
    else stampHint.textContent = active ? 'Pick up a stamp.' : ''
    deskArea.classList.toggle('inspecting', inspecting)
    windowCol.classList.toggle('inspecting', inspecting)
    deskArea.classList.toggle('armed', armed !== null)
    refreshEnvelope()
  }

  const deepToolUsable = (tool: DeepToolId, s: BoothSession | null): boolean => {
    if (!s) return false
    if (tool === 'registry') return s.applicant.documents.some(isNumbered)
    if (tool === 'verifyLetter') return s.applicant.documents.some((d) => d.type === 'letter')
    return true
  }

  const refreshAll = () => {
    refreshTop()
    refreshControls()
  }

  const note = (text: string) => transcript.add('system', text)

  // Show the person's lines one after another in the bubble and the transcript
  const speak = async (lines: readonly SpokenLine[]) => {
    for (const line of lines) {
      playSpeaker()
      transcript.add('applicant', line.text)
      await speech.say(line.text)
    }
  }

  const clearSelection = () => {
    for (const node of root.querySelectorAll(
      '[data-ref].selected, [data-ref].hit, [data-ref].miss',
    )) {
      node.classList.remove('selected', 'hit', 'miss')
    }
    selected = []
  }

  const markRef = (key: string, cls: string) => {
    for (const node of root.querySelectorAll<HTMLElement>('[data-ref]')) {
      if (node.dataset.ref === key) node.classList.add(cls)
    }
  }

  const showBanner = (text: string, kind: 'hit' | 'miss' | 'info' | 'idle') => {
    inspectBanner.textContent = text
    inspectBanner.className = `inspect-banner ${kind}`
  }

  const setInspecting = (on: boolean) => {
    inspecting = on
    if (!on) {
      clearSelection()
      showBanner(IDLE_BANNER, 'idle')
    } else {
      showBanner(
        'INSPECT: click two things that should agree. A rule alone can show a missing document.',
        'info',
      )
    }
    refreshControls()
  }

  const clearApplicant = () => {
    for (const item of applicantItems) item.remove()
    applicantItems.length = 0
    envelope = null
    personSlot.replaceChildren()
    heightMarker.classList.add('hidden')
    scaleValue.textContent = '-- kg'
    luggageItems.textContent = '-'
    shutter.classList.remove('hidden')
    speech.clear()
    armed = null
    clearSelection()
  }

  const showApplicant = (s: BoothSession) => {
    const a = s.applicant
    shutter.classList.add('hidden')
    const portrait = portraitCanvas(a.appearance.face, 7, { coat: hashText(a.id) % 6 })
    personSlot.replaceChildren(
      el('div', { className: 'person-face', ref: 'person:face' }, portrait),
    )
    const height = Math.min(RULER_MAX, Math.max(RULER_MIN, a.appearance.height))
    heightMarker.classList.remove('hidden')
    heightMarker.style.bottom = `${(height - RULER_MIN) * RULER_PX}px`
    heightMarker.textContent = `${a.appearance.height} cm`
    scaleValue.textContent = `${a.appearance.weight} kg`
    luggageItems.textContent = a.appearance.luggage.map((l) => l.label).join(', ') || 'nothing'
    a.documents.forEach((doc, i) => {
      const node = renderDocument(doc)
      node.dataset.applicant = a.id
      node.classList.add('arriving')
      const [left, top] = DOC_SPOTS[i] ?? [120 + i * 20, 100 + i * 24]
      placeAt(node, left, top)
      makeDraggable(node, { bounds: deskArea, canDrag })
      deskArea.append(node)
      bringToFront(node)
      applicantItems.push(node)
    })
  }

  // The envelope stays on the desk until the stamp. Keeping or returning can change until then.
  const showEnvelope = (amount: number) => {
    if (envelope) return
    const keep = el('button', { className: 'btn small primary env-keep', text: 'Keep' })
    const back = el('button', { className: 'btn small ghost env-back', text: 'Hand back' })
    keep.type = 'button'
    back.type = 'button'
    const status = el('div', { className: 'env-status' })
    envelope = el(
      'div',
      { className: 'doc envelope' },
      el('div', { className: 'env-flap' }),
      el('div', { className: 'env-text', text: `ENVELOPE · ${formatMoney(amount)}` }),
      status,
      el('div', { className: 'env-buttons' }, keep, back),
    )
    envelope.dataset.applicant = 'envelope'
    placeAt(envelope, 200, 456)
    makeDraggable(envelope, { bounds: deskArea, canDrag })
    deskArea.append(envelope)
    bringToFront(envelope)
    applicantItems.push(envelope)
    const respond = (accept: boolean) => {
      const result = accept ? loop.acceptBribe() : loop.refuseBribe()
      if (!result.ok) note(result.message)
      else
        transcript.add(
          'inspector',
          accept ? '(You pocket the envelope.)' : '(You push the envelope back.)',
        )
      refreshAll()
    }
    keep.addEventListener('click', () => respond(true))
    back.addEventListener('click', () => respond(false))
    refreshEnvelope()
  }

  const refreshEnvelope = () => {
    if (!envelope) return
    const bribe = session()?.bribe
    const status = envelope.querySelector<HTMLElement>('.env-status')
    const keep = envelope.querySelector<HTMLButtonElement>('.env-keep')
    const back = envelope.querySelector<HTMLButtonElement>('.env-back')
    if (!bribe || !status || !keep || !back) return
    status.textContent = bribe.reported
      ? 'Reported. It goes to the supervisor.'
      : bribe.accepted
        ? 'In your pocket. Only an approval lets you keep it.'
        : 'Untouched on the desk.'
    keep.disabled = bribe.reported || bribe.accepted || busy || modalOpen
    back.disabled = bribe.reported || !bribe.accepted || busy || modalOpen
  }

  const addSlip = (title: string, lines: readonly string[]) => {
    playPrinter()
    const slip = renderReportSlip(title, lines, `${formatMinute(loop.clock)} · OFFICER COPY`)
    placeAt(slip, 300 + (slipCount % 4) * 24, 120 + (slipCount % 4) * 30)
    slipCount += 1
    makeDraggable(slip, { bounds: deskArea, canDrag })
    deskArea.append(slip)
    bringToFront(slip)
    applicantItems.push(slip)
  }

  // ---------- Actions ----------

  const callNext = async () => {
    if (busy || finished) return
    clearApplicant()
    transcript.clear()
    const result = loop.callNext()
    if (!result.ok) {
      note(result.message)
      refreshAll()
      return
    }
    showApplicant(result.session)
    if (result.session.bribe && result.session.leverPresented) {
      showEnvelope(result.session.bribe.amount)
    }
    busy = true
    refreshAll()
    await speak(result.lines)
    busy = false
    refreshAll()
  }

  const ask = async (request: QuestionRequest, shownQuestion: string | null) => {
    if (busy || !session()) return
    busy = true
    refreshControls()
    let partials = 0
    let streamSpoke = false
    const result = await loop.ask(request, (partial) => {
      partials += 1
      if (partials > 1) {
        if (!streamSpoke) {
          streamSpoke = true
          playSpeaker()
        }
        speech.stream(partial)
      }
    })
    if (!result.ok) {
      note(result.message)
    } else {
      transcript.add('inspector', shownQuestion ?? result.question.text)
      // A streamed answer is already in the bubble, a template answer is typed out
      for (const line of result.lines) {
        if (line.trigger === 'answer' && partials > 1) {
          transcript.add('applicant', line.text)
          speech.stream(line.text)
        } else {
          await speak([line])
        }
      }
    }
    busy = false
    refreshAll()
  }

  const onInspectClick = (key: string) => {
    if (!session()) {
      showBanner('Nobody at the window.', 'miss')
      return
    }
    if (root.querySelector('[data-ref].hit, [data-ref].miss')) clearSelection()
    if (selected.includes(key)) {
      selected = selected.filter((k) => k !== key)
      for (const node of root.querySelectorAll<HTMLElement>('[data-ref].selected')) {
        if (node.dataset.ref === key) node.classList.remove('selected')
      }
      return
    }
    selected.push(key)
    markRef(key, 'selected')
    const single = selected.length === 1 && key.startsWith('rule:')
    if (selected.length < 2 && !single) {
      showBanner('Now click what it should agree with.', 'info')
      return
    }
    const keys = [...selected]
    const result = loop.inspect(keys)
    if (!result.ok) {
      showBanner(result.message, 'miss')
      selected = []
    } else if (result.found) {
      for (const k of keys) markRef(k, 'hit')
      const text = result.evidence?.description ?? result.found.message
      showBanner(`DISCREPANCY: ${text}`, 'hit')
      if (result.isNew) note(`Discrepancy noted: ${result.found.message}`)
      selected = []
      void speak(result.lines)
    } else if (keys.length >= 2) {
      for (const k of keys) markRef(k, 'miss')
      showBanner('No discrepancy between these two.', 'miss')
      selected = []
    } else {
      showBanner('Rule noted. Click what it should be compared with.', 'info')
    }
    refreshAll()
  }

  const openModal = (content: HTMLElement) => {
    modalOpen = true
    modalLayer.replaceChildren(content)
    modalLayer.classList.remove('hidden')
    refreshControls()
  }

  const closeModal = () => {
    modalOpen = false
    modalLayer.replaceChildren()
    modalLayer.classList.add('hidden')
    refreshAll()
  }

  const choiceDialog = (
    title: string,
    warning: string | null,
    sections: { label: string; choices: Choice[] }[],
    onPick: (values: string[]) => void,
  ) => {
    const picked: (string | null)[] = sections.map((s) =>
      s.choices.length === 1 ? (s.choices[0]?.value ?? null) : null,
    )
    const go = el('button', { className: 'btn primary', text: 'Continue' })
    go.type = 'button'
    go.dataset.action = 'dialog-continue'
    const cancel = el('button', { className: 'btn ghost', text: 'Cancel' })
    cancel.type = 'button'
    const update = () => {
      go.disabled = picked.some((p) => p === null)
    }
    const body = sections.map((section, si) => {
      const buttons = section.choices.map((choice) => {
        const b = el('button', { className: 'btn small ghost choice', text: choice.label })
        b.type = 'button'
        b.dataset.value = choice.value
        if (picked[si] === choice.value) b.classList.add('chosen')
        b.addEventListener('click', () => {
          picked[si] = choice.value
          for (const other of buttons) other.classList.toggle('chosen', other === b)
          update()
        })
        return b
      })
      return el(
        'div',
        { className: 'dialog-section' },
        el('div', { className: 'dialog-label', text: section.label }),
        el('div', { className: 'dialog-choices' }, ...buttons),
      )
    })
    go.addEventListener('click', () => {
      if (picked.some((p) => p === null)) return
      closeModal()
      onPick(picked as string[])
    })
    cancel.addEventListener('click', closeModal)
    update()
    openModal(
      el(
        'div',
        { className: 'dialog' },
        el('div', { className: 'dialog-title', text: title }),
        warning ? el('div', { className: 'dialog-warning', text: warning }) : null,
        ...body,
        el('div', { className: 'dialog-buttons' }, cancel, go),
      ),
    )
  }

  const typeForm = (form: OpenForm, note: string, done: (typing: TypingResult) => void) => {
    const test = createTypingTest({
      title: `${FORM_TITLES[form.kind]} · FORM`,
      line: form.line,
      note,
      onDone: (typing) => {
        closeModal()
        done(typing)
      },
      onCancel: () => {
        loop.cancelForm()
        closeModal()
        transcript.add('system', 'Form discarded.')
      },
    })
    openModal(test.root)
    test.focus()
  }

  const startDeepCheck = (tool: DeepToolId) => {
    const s = session()
    if (!s || busy) return
    const sections: { label: string; choices: Choice[] }[] = []
    if (tool === 'registry') {
      sections.push({
        label: 'Document',
        choices: s.applicant.documents.filter(isNumbered).map((d) => ({
          label: `${DOC_TITLES[d.type]} ${d.number}`,
          value: d.id,
        })),
      })
    } else if (tool === 'verifyLetter') {
      sections.push({
        label: 'Letter',
        choices: s.applicant.documents.flatMap((d) =>
          d.type === 'letter' ? [{ label: d.title, value: d.id }] : [],
        ),
      })
    }
    const seen = new Set<ViolationCode>()
    const reasons: Choice[] = []
    for (const d of s.discoveries) {
      if (seen.has(d.code)) continue
      seen.add(d.code)
      reasons.push({ label: reasonFromCode(d.code), value: `code:${d.code}` })
    }
    for (const r of REASON_CHOICES[tool]) reasons.push({ label: r, value: `reason:${r}` })
    sections.push({ label: 'Reason', choices: reasons })
    const minutes = loop.deepCheckMinutes(tool)
    const late =
      minutes !== null && minutes > loop.minutesLeft
        ? 'This check would run past 18:00. The person would leave unprocessed.'
        : loop.toolStatus(tool) === 'slow'
          ? 'The device was tampered with and runs slow today.'
          : null
    choiceDialog(`${TOOL_NAMES[tool]} request`, late, sections, (values) => {
      const docValue = tool === 'registry' || tool === 'verifyLetter' ? values[0] : undefined
      const reasonValue = values[values.length - 1] ?? ''
      const opened = loop.openForm(tool, {
        ...(docValue ? { docId: docValue } : {}),
        ...(reasonValue.startsWith('code:')
          ? { code: reasonValue.slice(5) as ViolationCode }
          : { reason: reasonValue.slice(7) }),
      })
      if (!opened.ok) {
        note(opened.message)
        refreshAll()
        return
      }
      typeForm(
        opened.form,
        `The check itself takes ${minutes ?? '?'} minutes once the form is filed.`,
        (typing) => {
          const result = loop.deepCheck(opened.form, typing)
          if (!result.ok) {
            note(result.message)
            refreshAll()
            return
          }
          transcript.add('inspector', `(${TOOL_NAMES[tool]} requested.)`)
          addSlip(FORM_TITLES[tool], result.lines)
          for (const v of result.revealed) note(`Finding: ${v.message}`)
          refreshAll()
          void speak(result.spoken).then(refreshAll)
        },
      )
    })
  }

  const startIncident = () => {
    if (!session() || busy) return
    choiceDialog(
      'Incident report',
      null,
      [
        {
          label: 'What happened',
          choices: INCIDENTS.map((i) => ({ label: i.label, value: i.kind })),
        },
      ],
      (values) => {
        const incident = (values[0] ?? 'threat') as IncidentKind
        const opened = loop.openForm('incident', { incident })
        if (!opened.ok) {
          note(opened.message)
          refreshAll()
          return
        }
        typeForm(opened.form, 'Filed reports go to the supervisor.', (typing) => {
          const result = loop.reportIncident(opened.form, typing)
          if (!result.ok) note(result.message)
          else transcript.add('inspector', '(Incident report filed.)')
          refreshAll()
        })
      },
    )
  }

  const arm = (decision: Decision) => {
    if (!session() || busy) return
    if (armed === decision) {
      void stamp(null)
      return
    }
    armed = decision
    if (inspecting) setInspecting(false)
    refreshControls()
  }

  const stamp = async (target: HTMLElement | null) => {
    const decision = armed
    const s = session()
    if (!decision || !s) return
    const result = loop.decide(decision)
    if (!result.ok) {
      note(result.message)
      refreshAll()
      return
    }
    if (result.status === 'interrupted') {
      // The person has something to say first, the stamp stays in hand
      busy = true
      refreshAll()
      stampHint.textContent = 'They have something to say. Stamp again to decide.'
      await speak(result.lines)
      busy = false
      refreshAll()
      stampHint.textContent = 'Stamp again to decide.'
      return
    }
    armed = null
    playStamp(decision)
    const paper =
      target ??
      applicantItems.find((n) => n.classList.contains('doc-passport')) ??
      applicantItems.find((n) => n.dataset.applicant === s.applicant.id) ??
      null
    paper?.append(
      el('div', {
        className: `stamp-mark ${decision}`,
        text: decision === 'approve' ? 'ENTRY APPROVED' : 'ENTRY DENIED',
      }),
    )
    transcript.add(
      'inspector',
      decision === 'approve' ? '(Stamped: APPROVED)' : '(Stamped: DENIED)',
    )
    busy = true
    refreshAll()
    await speak(result.lines)
    await new Promise((resolve) => setTimeout(resolve, 600))
    for (const item of applicantItems) item.classList.add('leaving')
    await new Promise((resolve) => setTimeout(resolve, 350))
    clearApplicant()
    busy = false
    refreshAll()
  }

  const finishShift = (byClock: boolean, notProcessed: number | null = null) => {
    if (finished) return
    finished = true
    armed = null
    setInspecting(false)
    closeModal()
    const button = el('button', { className: 'btn primary big', text: 'Evening report' })
    button.type = 'button'
    button.dataset.action = 'end-shift'
    button.addEventListener('click', () => {
      destroy()
      options.onShiftOver()
    })
    const left = notProcessed ?? loop.queue.length + (session() ? 1 : 0)
    endOverlay.replaceChildren(
      el(
        'div',
        { className: 'overlay-box' },
        el('div', {
          className: 'overlay-title',
          text: byClock ? '18:00 · SHUTTER DOWN' : 'BOOTH CLOSED',
        }),
        el('div', {
          className: 'overlay-text',
          text: left > 0 ? `${left} people were still waiting.` : 'The line is empty.',
        }),
        button,
      ),
    )
    endOverlay.classList.remove('hidden')
    refreshControls()
  }

  const togglePause = () => {
    if (finished) return
    paused = !paused
    pauseOverlay.classList.toggle('hidden', !paused)
    lastFrame = performance.now()
    refreshControls()
  }

  // ---------- Events ----------

  nextButton.addEventListener('click', () => {
    if (loop.queue.length === 0 && !session()) finishShift(false)
    else void callNext()
  })
  muteButton.addEventListener('click', () => toggleMuted())
  pauseButton.addEventListener('click', togglePause)
  resumeButton.addEventListener('click', togglePause)
  inspectButton.addEventListener('click', () => setInspecting(!inspecting))
  incidentButton.addEventListener('click', startIncident)
  stampApprove.addEventListener('click', () => arm('approve'))
  stampDeny.addEventListener('click', () => arm('deny'))

  // Inspect clicks and stamping are caught before dragging starts
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (finished || paused || modalOpen) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (armed) {
        const paper = target.closest<HTMLElement>('.doc[data-applicant]')
        if (paper && paper.dataset.applicant !== 'envelope' && !busy) {
          event.preventDefault()
          event.stopPropagation()
          void stamp(paper)
        }
        return
      }
      if (!inspecting) return
      if (target.closest('button, input, .rb-tabs')) return
      const refNode = target.closest<HTMLElement>('[data-ref]')
      if (!refNode || !refNode.dataset.ref) return
      event.preventDefault()
      event.stopPropagation()
      onInspectClick(refNode.dataset.ref)
    },
    true,
  )

  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'm' || event.key === 'M') toggleMuted()
    else if (event.key === 'p' || event.key === 'P') togglePause()
    else if (paused || finished || modalOpen) return
    else if (event.key === 'i' || event.key === 'I') setInspecting(!inspecting)
    else if (event.key === 'Escape') {
      if (armed) {
        armed = null
        refreshControls()
      } else if (inspecting) setInspecting(false)
    }
  }
  window.addEventListener('keydown', onKey)

  const unsubscribe = loop.on((event: LoopEvent) => {
    if (event.type === 'clock') refreshTop()
    else if (event.type === 'bribe_offered') showEnvelope(event.amount)
    else if (event.type === 'shift_over') {
      refreshTop()
      finishShift(true, event.notProcessed)
    }
  })

  // ---------- Clock ----------

  const frame = (now: number) => {
    const dt = Math.min(0.5, (now - lastFrame) / 1000)
    lastFrame = now
    if (!paused && !finished) {
      carry += dt * minutesPerSecond
      const whole = Math.floor(carry)
      if (whole > 0) {
        carry -= whole
        loop.advanceClock(whole)
      }
    }
    raf = requestAnimationFrame(frame)
  }

  const unsubscribeNotices = options.subscribeNotices?.((text) => note(text)) ?? (() => undefined)
  const unsubscribeMute = onMuteChange(syncMuteButton)

  const destroy = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
    unsubscribe()
    unsubscribeNotices()
    unsubscribeMute()
  }

  clearApplicant()
  refreshAll()
  note(
    `Shift ${ctx.dayIndex} begins at ${formatMinute(loop.clock)}. ${loop.queue.length} people in line.`,
  )
  raf = requestAnimationFrame(frame)
  if (loop.shiftOver) finishShift(true)

  return { root, destroy }
}
