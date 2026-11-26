// Development entry point: an engine inspector that shows a generated day.
// The real game screens replace this in a later package.

import './dev/inspector.css'
import type { DifficultyId } from './config'
import { DIFFICULTIES, TOOL_NAMES } from './config'
import { formatDocDate } from './core/dates'
import type { GameDocument } from './core/documents'
import { DOC_FIELDS, DOC_TITLES, displayName, fieldValue } from './core/documents'
import { createOfflineAdversary } from './ai/offlineAdversary'
import { DayLoop } from './core/dayLoop'
import type { DayStart } from './core/dayLoop'
import { formatMoney } from './core/economy'
import { createNewGame } from './core/state'
import type { Applicant, DayContext } from './core/types'
import type { BotKind } from './dev/bots'
import { BOTS, playShift } from './dev/bots'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  for (const child of children) node.append(child)
  return node
}

function formatValue(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDocDate(value)
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return '[image]'
  return String(value)
}

function renderDocument(doc: GameDocument): HTMLElement {
  const rows = DOC_FIELDS[doc.type]
    .filter((f) => f.field !== 'photo' && f.field !== 'seal')
    .map((f) =>
      el(
        'div',
        { className: 'field' },
        el('span', { text: f.label }),
        el('b', { text: formatValue(fieldValue(doc, f.field)) }),
      ),
    )
  const tag = doc.provenance === 'genuine' ? '' : ` · ${doc.provenance}`
  return el(
    'div',
    { className: 'doc' },
    el('h4', { text: `${DOC_TITLES[doc.type]}${tag}` }),
    ...rows,
  )
}

function renderApplicant(a: Applicant): HTMLElement {
  const passport = a.documents.find((d) => d.type === 'passport')
  const name = passport && passport.type === 'passport' ? displayName(passport) : 'NO PASSPORT'
  const badge = el('span', {
    className: `badge ${a.admissible ? 'ok' : 'bad'}`,
    text: a.admissible ? 'ADMISSIBLE' : 'DENY',
  })
  const header = el('h3', {}, `#${a.slot + 1} ${name} `, badge)
  const meta = el('p', {
    className: 'meta',
    text: `${a.kind}${a.baseProblem ? ` · ${a.baseProblem}` : ''}${a.characterId ? ` · ${a.characterId}` : ''} · ${a.appearance.height} cm · ${a.appearance.weight} kg · luggage: ${a.appearance.luggage.map((l) => l.label).join(', ')}`,
  })
  const lever = a.plan.lever
  const plan = el('p', {
    className: 'meta',
    text: `${a.plan.persona.demeanor} · "${a.plan.opening_line}"${lever.type !== 'none' ? ` · ${lever.real ? 'real' : 'empty'} ${lever.type}${lever.amount ? ` ${lever.amount}` : ''}` : ''} · ${a.plan.private_intent}`,
  })
  const techniques = el(
    'ul',
    { className: 'list' },
    ...a.techniques.map((t) => el('li', { text: `${t.type} (${t.cost}): ${t.note}` })),
    ...a.notes.map((n) => el('li', { text: n })),
  )
  const violations = el(
    'ul',
    { className: 'list violations' },
    ...a.violations.map((v) =>
      el('li', {
        text: `${v.code}: ${v.message} [${v.evidence.map((e) => `${e.tool}/${e.difficulty}`).join(', ')}]`,
      }),
    ),
  )
  const docs = el('div', { className: 'docs' }, ...a.documents.map(renderDocument))
  return el('section', { className: 'applicant' }, header, meta, plan, techniques, violations, docs)
}

function renderBulletin(ctx: DayContext): HTMLElement {
  const b = ctx.bulletin
  return el(
    'section',
    { className: 'bulletin' },
    el('h2', { text: `Day ${ctx.dayIndex} · ${formatDocDate(ctx.date)}` }),
    el('p', { className: 'headline', text: b.headline }),
    el('ul', { className: 'list' }, ...b.changes.map((c) => el('li', { text: c }))),
    el('h3', { text: 'Rules' }),
    el('ol', { className: 'list' }, ...b.rules.map((r) => el('li', { text: r.text }))),
    el('p', {
      text: `Wanted: ${b.wanted.map((w) => `${displayName(w)} (${w.reason})`).join('; ') || 'none'}`,
    }),
    el('p', { text: `Revoked: ${b.revoked.join(', ') || 'none'}` }),
    el('p', { text: `Tools: ${ctx.tools.map((t) => TOOL_NAMES[t]).join(', ')}` }),
  )
}

// Plays the days before the chosen one with a bot, then shows the chosen morning
async function generate(
  seed: number,
  difficulty: DifficultyId,
  day: number,
  bot: BotKind,
): Promise<HTMLElement> {
  const state = createNewGame({ seed, difficulty })
  const loop = new DayLoop(state, createOfflineAdversary(seed))
  let start: DayStart = await loop.startDay()
  const history: string[] = []
  while (start.record.dayIndex < day) {
    const report = await playShift(loop, bot, seed)
    const obs = loop.history()[loop.history().length - 1]
    history.push(
      `Day ${report.dayIndex}: ${obs?.infiltratorsThrough ?? 0} through, ${obs?.infiltratorsStopped ?? 0} stopped, ${report.notProcessed} not processed, money ${formatMoney(report.money)}`,
    )
    if (state.phase === 'gameover' || state.phase === 'final') {
      return el('p', { text: `The ${bot} bot never reached day ${day}: ${state.phase}.` })
    }
    start = await loop.startDay()
  }
  const record = start.record
  return el(
    'div',
    {},
    renderBulletin(start.context as DayContext),
    el('h3', { text: 'Adversary' }),
    el('p', { text: record.plan.plan.strategy_summary }),
    el('p', { className: 'meta', text: record.plan.plan.notes_for_future_self }),
    el('p', {
      className: 'meta',
      text: `Budget spent ${record.plan.costSpent}, left ${state.ai.budget}, lever tokens left ${state.ai.leverTokens}. Plan issues: ${record.plan.issues.join(' ') || 'none'}`,
    }),
    el('p', {
      className: 'meta',
      text: `Morning events: ${start.events.map((e) => e.text).join(' ') || 'none'}`,
    }),
    el('ul', { className: 'list' }, ...history.map((h) => el('li', { text: h }))),
    ...record.applicants.map(renderApplicant),
  )
}

function mount(): void {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) return
  const seedInput = el('input')
  seedInput.type = 'number'
  seedInput.value = '1'
  const difficulty = el('select')
  for (const d of Object.values(DIFFICULTIES))
    difficulty.append(new Option(`${d.label} (${d.days} days)`, d.id))
  difficulty.value = 'hard'
  const dayInput = el('input')
  dayInput.type = 'number'
  dayInput.min = '1'
  dayInput.value = '5'
  const botSelect = el('select')
  for (const kind of Object.keys(BOTS)) botSelect.append(new Option(kind, kind))
  botSelect.value = 'average'
  const button = el('button', { text: 'Generate day' })
  const output = el('div')
  const run = () => {
    const days = DIFFICULTIES[difficulty.value as DifficultyId].days
    const day = Math.min(days, Math.max(1, Number(dayInput.value) || 1))
    dayInput.value = String(day)
    output.replaceChildren(el('p', { className: 'meta', text: 'Playing the days before...' }))
    generate(
      Number(seedInput.value) || 1,
      difficulty.value as DifficultyId,
      day,
      botSelect.value as BotKind,
    )
      .then((view) => output.replaceChildren(view))
      .catch((error: unknown) => output.replaceChildren(el('p', { text: String(error) })))
  }
  button.addEventListener('click', run)
  root.append(
    el(
      'header',
      {},
      el('h1', { text: 'OVERSIGHT · engine inspector' }),
      el('p', {
        className: 'meta',
        text: 'Development view of the rules engine and the offline adversary. Ground truth is visible here.',
      }),
    ),
    el(
      'div',
      { className: 'controls' },
      el('label', { text: 'Seed ' }, seedInput),
      el('label', { text: 'Difficulty ' }, difficulty),
      el('label', { text: 'Day ' }, dayInput),
      el('label', { text: 'Earlier days played by ' }, botSelect),
      button,
    ),
    output,
  )
  run()
}

mount()
