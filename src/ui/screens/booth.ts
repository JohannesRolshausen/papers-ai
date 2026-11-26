// The booth: the main shift screen. It shows what the shift controller reports and sends the
// player's actions back to it. No game rules are decided here.

import type { DeepToolId } from '../../config'
import { DEEP_CHECK_MINUTES, DEEP_TOOL_IDS, SHIFT, TOOL_NAMES } from '../../config'
import { formatDocDate } from '../../core/dates'
import { DOC_TITLES, isNumbered } from '../../core/documents'
import type { Applicant, Decision, IncidentKind } from '../../core/types'
import { bulletinSheet, calendarItem } from '../components/bulletin'
import { renderDocument, renderReportSlip } from '../components/document'
import { portraitCanvas } from '../components/portrait'
import { createClockView, createQueue } from '../components/queue'
import { createRulebook } from '../components/rulebook'
import { createSpeech, createTranscript } from '../components/speech'
import { createTypingTest } from '../components/typingTest'
import { el, formatMinute, formatMoney, hashText } from '../dom'
import type { ShiftPort, ShiftQuestion, SpokenLines } from '../shiftPort'
import { DEEP_CHECK_REASONS, STANDARD_QUESTIONS } from '../shiftPort'
import { bringToFront, makeDraggable, placeAt } from '../stage'

export interface BoothOptions {
  port: ShiftPort
  shiftRealSeconds: number
  onShiftOver(): void
}

export interface BoothScreen {
  root: HTMLElement
  destroy(): void
}

const INCIDENTS: { kind: IncidentKind; label: string }[] = [
  { kind: 'threat', label: 'Threat against an officer' },
  { kind: 'bribe', label: 'Attempted bribery' },
  { kind: 'letter', label: 'Suspicious letter' },
]

const RULER_MIN = 140
const RULER_MAX = 210
const RULER_PX = 3.6

export function boothScreen(options: BoothOptions): BoothScreen {
  const { port } = options
  const ctx = port.context

  // ---------- State of the screen ----------
  let paused = false
  let finished = false
  let modalOpen = false
  let busy = false
  let inspecting = false
  let selected: string[] = []
  let discrepancy: { code: string; message: string } | null = null
  let armed: Decision | null = null
  let decided = false
  let lastFrame = performance.now()
  let carry = 0
  let raf = 0
  const minutesPerSecond = (SHIFT.endMinute - SHIFT.startMinute) / options.shiftRealSeconds
  const applicantItems: HTMLElement[] = []
  let slipCount = 0

  // ---------- Top bar ----------
  const clock = createClockView()
  const queue = createQueue()
  const moneyLabel = el('div', { className: 'tb-money' })
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
  const scaleView = el(
    'div',
    { className: 'scale-view', ref: 'person:weight' },
    el('div', { className: 'scale-label', text: 'SCALE' }),
    el('div', { className: 'scale-value', text: '-- kg' }),
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
  const luggage = el(
    'div',
    { className: 'luggage', ref: 'person:luggage' },
    el('span', { className: 'tb-label', text: 'Luggage' }),
    el('span', { className: 'luggage-items', text: '-' }),
  )

  // ---------- Questions ----------
  const questionButtons = STANDARD_QUESTIONS.map((q) => {
    const b = el('button', { className: 'btn small q-btn', text: q.label, title: q.text })
    b.type = 'button'
    b.dataset.question = q.kind
    b.addEventListener('click', () => void ask({ kind: q.kind, text: q.text, discrepancy: null }))
    return b
  })
  const discrepancyButton = el('button', {
    className: 'btn small danger q-btn q-discrepancy',
    text: 'Ask about a discrepancy (inspect first)',
  })
  discrepancyButton.type = 'button'
  discrepancyButton.dataset.question = 'discrepancy'
  discrepancyButton.addEventListener('click', () => {
    if (!discrepancy) return
    const text = `Explain this: ${discrepancy.message}`
    void ask({ kind: 'discrepancy', text, discrepancy: discrepancy.message })
  })
  const freeInput = el('input', {
    className: 'free-input',
    attrs: { type: 'text', maxlength: '80', placeholder: 'Ask anything (80 characters)' },
  })
  const freeButton = el('button', { className: 'btn small', text: 'Ask' })
  freeButton.type = 'button'
  const freeNote = el('div', {
    className: 'free-note',
    text: port.freeQuestions ? '' : 'Free questions need the Claude adversary.',
  })
  const submitFree = () => {
    const text = freeInput.value.trim().slice(0, 80)
    if (!text) return
    freeInput.value = ''
    void ask({ kind: 'free', text, discrepancy: discrepancy?.message ?? null })
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
  for (const [node, left, top] of [
    [bulletin, 470, 8],
    [rulebook.root, 330, 200],
  ] as const) {
    placeAt(node, left, top)
    makeDraggable(node, { bounds: deskArea, canDrag: () => !inspecting && !armed })
    deskArea.append(node)
  }
  placeAt(calendar, 14, 576)
  deskArea.append(calendar)

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
    const b = el('button', {
      className: 'btn small tool-btn',
      text: `${TOOL_NAMES[tool]}`,
      title: `${DEEP_CHECK_MINUTES[tool]} minutes plus a typed form`,
    })
    b.type = 'button'
    b.dataset.tool = tool
    b.addEventListener('click', () => startDeepCheck(tool))
    deepButtons.set(tool, b)
  }
  const incidentButton = el('button', {
    className: 'btn small tool-btn danger',
    text: 'Incident report',
  })
  incidentButton.type = 'button'
  incidentButton.dataset.action = 'incident'
  const rulebookButton = el('button', { className: 'btn small ghost', text: 'Rulebook' })
  rulebookButton.type = 'button'
  const bulletinButton = el('button', { className: 'btn small ghost', text: 'Bulletin' })
  bulletinButton.type = 'button'
  const inspectBanner = el('div', { className: 'inspect-banner hidden' })
  const toolbar = el(
    'div',
    { className: 'toolbar' },
    inspectButton,
    ...deepButtons.values(),
    incidentButton,
    el('div', { className: 'tb-spacer' }),
    rulebookButton,
    bulletinButton,
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

  const pauseOverlay = el(
    'div',
    { className: 'overlay hidden' },
    el(
      'div',
      { className: 'overlay-box' },
      el('div', { className: 'overlay-title', text: 'PAUSED' }),
    ),
  )
  const resumeButton = el('button', { className: 'btn primary', text: 'Resume' })
  resumeButton.type = 'button'
  pauseOverlay.firstElementChild?.append(resumeButton)
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

  const refreshTop = () => {
    const minute = port.minute()
    clock.set(Math.min(minute, port.shiftEnd()), minute >= port.shiftEnd() - 60)
    queue.set(port.waiting())
    moneyLabel.textContent = formatMoney(port.money())
  }

  const refreshControls = () => {
    const a = port.current()
    const active = a !== null && !decided
    const blocked = busy || modalOpen || finished || paused
    nextButton.disabled = blocked || active || port.waiting() === 0
    nextButton.textContent = port.waiting() === 0 && !active ? 'Queue empty' : 'Call next'
    for (const b of questionButtons) b.disabled = blocked || !active
    discrepancyButton.disabled = blocked || !active || !discrepancy
    discrepancyButton.textContent = discrepancy
      ? `Ask about: ${discrepancy.message}`
      : 'Ask about a discrepancy (inspect first)'
    freeInput.disabled = blocked || !active || !port.freeQuestions
    freeButton.disabled = freeInput.disabled
    inspectButton.disabled = blocked
    inspectButton.classList.toggle('active', inspecting)
    for (const [tool, b] of deepButtons) {
      const notice = port.deviceNotice(tool)
      b.disabled = blocked || !active || !deepToolUsable(tool, a)
      b.textContent = notice ? `${TOOL_NAMES[tool]} (!)` : TOOL_NAMES[tool]
      b.title = notice ?? `${DEEP_CHECK_MINUTES[tool]} minutes plus a typed form`
    }
    incidentButton.disabled = blocked || !active
    stampApprove.disabled = blocked || !active
    stampDeny.disabled = blocked || !active
    stampApprove.classList.toggle('armed', armed === 'approve')
    stampDeny.classList.toggle('armed', armed === 'deny')
    stampHint.textContent = armed
      ? 'Click a document to stamp it, or the stamp again.'
      : active
        ? 'Pick up a stamp.'
        : ''
    deskArea.classList.toggle('inspecting', inspecting)
    windowCol.classList.toggle('inspecting', inspecting)
    deskArea.classList.toggle('armed', armed !== null)
  }

  const deepToolUsable = (tool: DeepToolId, a: Applicant | null): boolean => {
    if (!a) return false
    if (tool === 'registry') return a.documents.some(isNumbered)
    if (tool === 'verifyLetter') return a.documents.some((d) => d.type === 'letter')
    return true
  }

  const speak = async (lines: SpokenLines) => {
    for (const note of lines.notes) transcript.add('system', note)
    for (const line of lines.say) {
      if (!line) continue
      transcript.add('applicant', line)
      await speech.say(line)
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

  const showBanner = (text: string, kind: 'hit' | 'miss' | 'info') => {
    inspectBanner.textContent = text
    inspectBanner.className = `inspect-banner ${kind}`
  }

  const setInspecting = (on: boolean) => {
    inspecting = on
    if (!on) {
      clearSelection()
      inspectBanner.classList.add('hidden')
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
    personSlot.replaceChildren()
    heightMarker.classList.add('hidden')
    scaleView.querySelector('.scale-value')!.textContent = '-- kg'
    luggage.querySelector('.luggage-items')!.textContent = '-'
    shutter.classList.remove('hidden')
    speech.clear()
    discrepancy = null
    armed = null
    clearSelection()
  }

  const showApplicant = (a: Applicant) => {
    shutter.classList.add('hidden')
    const coat = hashText(a.id) % 6
    const portrait = portraitCanvas(a.appearance.face, 7, { coat })
    const face = el('div', { className: 'person-face', ref: 'person:face' }, portrait)
    personSlot.replaceChildren(face)
    heightMarker.classList.remove('hidden')
    heightMarker.style.bottom = `${(Math.min(RULER_MAX, Math.max(RULER_MIN, a.appearance.height)) - RULER_MIN) * RULER_PX}px`
    heightMarker.textContent = `${a.appearance.height} cm`
    scaleView.querySelector('.scale-value')!.textContent = `${a.appearance.weight} kg`
    luggage.querySelector('.luggage-items')!.textContent =
      a.appearance.luggage.map((l) => l.label).join(', ') || 'nothing'

    a.documents.forEach((doc, i) => {
      const node = renderDocument(doc)
      node.dataset.applicant = a.id
      node.classList.add('arriving')
      placeAt(node, 14 + i * 34, 14 + i * 40)
      makeDraggable(node, { bounds: deskArea, canDrag: () => !inspecting && !armed })
      deskArea.append(node)
      bringToFront(node)
      applicantItems.push(node)
    })
    const offer = port.bribeOffer()
    if (offer !== null) showEnvelope(offer)
  }

  const showEnvelope = (amount: number) => {
    const keep = el('button', { className: 'btn small primary', text: 'Keep' })
    const back = el('button', { className: 'btn small ghost', text: 'Hand back' })
    keep.type = 'button'
    back.type = 'button'
    const envelope = el(
      'div',
      { className: 'doc envelope' },
      el('div', { className: 'env-flap' }),
      el('div', { className: 'env-text', text: `ENVELOPE · ${formatMoney(amount)}` }),
      el('div', { className: 'env-buttons' }, keep, back),
    )
    envelope.dataset.applicant = 'envelope'
    placeAt(envelope, 200, 470)
    makeDraggable(envelope, { bounds: deskArea, canDrag: () => !inspecting && !armed })
    deskArea.append(envelope)
    bringToFront(envelope)
    applicantItems.push(envelope)
    const respond = (accept: boolean) => {
      envelope.remove()
      transcript.add(
        'inspector',
        accept ? '(You keep the envelope.)' : '(You hand the envelope back.)',
      )
      void speak(port.respondToBribe(accept)).then(refreshAll)
    }
    keep.addEventListener('click', () => respond(true))
    back.addEventListener('click', () => respond(false))
  }

  const addSlip = (title: string, lines: string[]) => {
    const slip = renderReportSlip(title, lines, `${formatMinute(port.minute())} · OFFICER COPY`)
    placeAt(slip, 300 + (slipCount % 4) * 24, 120 + (slipCount % 4) * 30)
    slipCount += 1
    makeDraggable(slip, { bounds: deskArea, canDrag: () => !inspecting && !armed })
    deskArea.append(slip)
    bringToFront(slip)
    applicantItems.push(slip)
  }

  const refreshAll = () => {
    refreshTop()
    refreshControls()
    if (port.isOver() && !finished) finishShift()
  }

  // ---------- Actions ----------

  const callNext = async () => {
    if (busy || finished) return
    clearApplicant()
    transcript.clear()
    decided = false
    const result = port.callNext()
    const a = port.current()
    if (!result || !a) {
      refreshAll()
      return
    }
    busy = true
    refreshAll()
    showApplicant(a)
    busy = false
    refreshAll()
    await speak(result)
    refreshAll()
  }

  const ask = async (question: ShiftQuestion) => {
    if (busy || !port.current()) return
    busy = true
    refreshControls()
    transcript.add('inspector', question.text)
    try {
      const result = await port.ask(question, (partial) => speech.stream(partial))
      refreshTop()
      await speak(result)
    } catch (error) {
      transcript.add(
        'system',
        `No answer: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    } finally {
      busy = false
      refreshAll()
    }
  }

  const onInspectClick = (key: string) => {
    if (!port.current()) {
      showBanner('Nobody at the window.', 'miss')
      return
    }
    const hadResult = root.querySelector('[data-ref].hit, [data-ref].miss') !== null
    if (hadResult) clearSelection()
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
    const outcome = port.inspect(keys)
    if (outcome.code && outcome.message) {
      for (const k of keys) markRef(k, 'hit')
      discrepancy = { code: outcome.code, message: outcome.message }
      showBanner(`DISCREPANCY: ${outcome.message}`, 'hit')
      transcript.add('system', `Discrepancy noted: ${outcome.message}`)
      selected = []
      void speak(outcome)
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
    sections: { label: string; choices: { label: string; value: string }[] }[],
    onPick: (values: string[]) => void,
  ) => {
    const picked: (string | null)[] = sections.map((s) =>
      s.choices.length === 1 ? s.choices[0]!.value : null,
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
        ...body,
        el('div', { className: 'dialog-buttons' }, cancel, go),
      ),
    )
  }

  const typingThen = (
    title: string,
    line: string,
    note: string,
    done: (t: { typedMs: number; typos: number }) => void,
  ) => {
    const test = createTypingTest({
      title,
      line,
      note,
      onDone: (result) => {
        closeModal()
        done(result)
      },
      onCancel: () => {
        closeModal()
        transcript.add('system', 'Form discarded.')
      },
    })
    openModal(test.root)
    test.focus()
  }

  const startDeepCheck = (tool: DeepToolId) => {
    const a = port.current()
    if (!a || busy) return
    const sections: { label: string; choices: { label: string; value: string }[] }[] = []
    if (tool === 'registry') {
      sections.push({
        label: 'Document',
        choices: a.documents.filter(isNumbered).map((d) => ({
          label: `${DOC_TITLES[d.type]} ${d.number}`,
          value: d.id,
        })),
      })
    } else if (tool === 'verifyLetter') {
      sections.push({
        label: 'Letter',
        choices: a.documents
          .filter((d) => d.type === 'letter')
          .map((d) => ({ label: d.type === 'letter' ? d.title : d.id, value: d.id })),
      })
    }
    const reasons = [
      ...(discrepancy ? [discrepancy.code.replace(/_/g, ' ')] : []),
      ...DEEP_CHECK_REASONS,
    ]
    sections.push({ label: 'Reason', choices: reasons.map((r) => ({ label: r, value: r })) })
    const notice = port.deviceNotice(tool)
    choiceDialog(
      `${TOOL_NAMES[tool]} request${notice ? ` · ${notice}` : ''}`,
      sections,
      (values) => {
        const docId = tool === 'registry' || tool === 'verifyLetter' ? (values[0] ?? null) : null
        const reason = values[values.length - 1] ?? 'ROUTINE CHECK'
        const line = port.documentationLine(tool, docId, reason)
        typingThen(
          `${TOOL_NAMES[tool].toUpperCase()} · FORM`,
          line,
          `The check itself takes ${DEEP_CHECK_MINUTES[tool]} minutes once the form is filed.`,
          (typing) => {
            transcript.add('inspector', `(${TOOL_NAMES[tool]} requested.)`)
            const outcome = port.deepCheck(tool, docId, typing)
            if (outcome.report) addSlip(outcome.report.title, outcome.report.lines)
            else transcript.add('system', 'The device produced no report.')
            refreshAll()
            void speak(outcome).then(refreshAll)
          },
        )
      },
    )
  }

  const startIncident = () => {
    if (!port.current() || busy) return
    choiceDialog(
      'Incident report',
      [
        {
          label: 'What happened',
          choices: INCIDENTS.map((i) => ({ label: i.label, value: i.kind })),
        },
      ],
      (values) => {
        const kind = (values[0] ?? 'threat') as IncidentKind
        typingThen(
          'INCIDENT REPORT · FORM',
          port.incidentLine(kind),
          'Filed reports go to the supervisor.',
          (typing) => {
            transcript.add('inspector', '(Incident report filed.)')
            const result = port.reportIncident(kind, typing)
            refreshAll()
            void speak(result).then(refreshAll)
          },
        )
      },
    )
  }

  const arm = (decision: Decision) => {
    if (!port.current() || busy || decided) return
    if (armed === decision) {
      void stamp(null)
      return
    }
    const first = armed === null
    armed = decision
    if (inspecting) setInspecting(false)
    refreshControls()
    if (first) void speak(port.beforeDecision()).then(refreshAll)
  }

  const stamp = async (target: HTMLElement | null) => {
    const decision = armed
    const a = port.current()
    if (!decision || !a || decided) return
    decided = true
    armed = null
    const paper =
      target ??
      applicantItems.find((n) => n.classList.contains('doc-passport')) ??
      applicantItems.find((n) => n.dataset.applicant === a.id) ??
      null
    if (paper) {
      paper.append(
        el('div', {
          className: `stamp-mark ${decision}`,
          text: decision === 'approve' ? 'ENTRY APPROVED' : 'ENTRY DENIED',
        }),
      )
    }
    transcript.add(
      'inspector',
      decision === 'approve' ? '(Stamped: APPROVED)' : '(Stamped: DENIED)',
    )
    const result = port.decide(decision)
    busy = true
    refreshAll()
    await speak(result)
    await new Promise((resolve) => setTimeout(resolve, 600))
    for (const item of applicantItems) item.classList.add('leaving')
    await new Promise((resolve) => setTimeout(resolve, 350))
    clearApplicant()
    busy = false
    refreshAll()
  }

  const finishShift = () => {
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
      port.endShift()
      options.onShiftOver()
    })
    const atWindow = port.current() !== null && !decided ? 1 : 0
    const left = port.waiting() + atWindow
    endOverlay.replaceChildren(
      el(
        'div',
        { className: 'overlay-box' },
        el('div', {
          className: 'overlay-title',
          text: port.minute() >= port.shiftEnd() ? '18:00 · SHUTTER DOWN' : 'BOOTH CLOSED',
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

  const closeEarly = () => {
    if (port.current() && !decided) return
    if (port.waiting() > 0) return
    finishShift()
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
    if (port.waiting() === 0 && !port.current()) closeEarly()
    else void callNext()
  })
  pauseButton.addEventListener('click', togglePause)
  resumeButton.addEventListener('click', togglePause)
  inspectButton.addEventListener('click', () => setInspecting(!inspecting))
  incidentButton.addEventListener('click', startIncident)
  stampApprove.addEventListener('click', () => arm('approve'))
  stampDeny.addEventListener('click', () => arm('deny'))
  rulebookButton.addEventListener('click', () => {
    placeAt(rulebook.root, 330, 200)
    bringToFront(rulebook.root)
  })
  bulletinButton.addEventListener('click', () => {
    placeAt(bulletin, 470, 8)
    bringToFront(bulletin)
  })

  // Inspect clicks and stamping are caught before dragging starts
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (finished || paused || modalOpen) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (armed) {
        const paper = target.closest<HTMLElement>('.doc[data-applicant]')
        if (paper && paper.dataset.applicant !== 'envelope') {
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
    if (event.key === 'p' || event.key === 'P') togglePause()
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

  // ---------- Clock ----------

  const frame = (now: number) => {
    const dt = Math.min(0.5, (now - lastFrame) / 1000)
    lastFrame = now
    if (!paused && !finished) {
      carry += dt * minutesPerSecond
      const whole = Math.floor(carry)
      if (whole > 0) {
        carry -= whole
        port.advanceClock(whole)
        refreshTop()
        if (port.isOver()) finishShift()
      }
    }
    raf = requestAnimationFrame(frame)
  }

  const destroy = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
  }

  clearApplicant()
  refreshAll()
  transcript.add('system', `Shift ${ctx.dayIndex} begins. ${port.waiting()} people in line.`)
  raf = requestAnimationFrame(frame)

  return { root, destroy }
}
