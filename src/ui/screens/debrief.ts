// Full post-game debriefing screen:
// Metrics & rating, day-by-day adversary strategies and applicant truth with highlighted unused
// evidence, visual comparisons (portraits, seals, documents), recurring character arcs,
// adversary planner log, and JSON export.
// Every text string from the adversary is inserted with textContent only.

import type { ApplicantResult } from '../../ai/adversary'
import { DIFFICULTIES, TOOL_IDS, TOOL_NAMES } from '../../config'
import { formatDocDate } from '../../core/dates'
import type {
  DebriefApplicant,
  DebriefCharacter,
  DebriefDay,
  DebriefEvidence,
  DebriefReport,
} from '../../core/debrief'
import { buildDebriefExport, debriefFilename } from '../../core/debrief'
import { DOC_TITLES } from '../../core/documents'
import { formatMoney } from '../../core/economy'
import type { GameState } from '../../core/types'
import { COUNTRIES } from '../../core/world'
import { renderDocument } from '../components/document'
import { PHOTO_BG, portraitCanvas } from '../components/portrait'
import { sealCanvas } from '../components/seal'
import { el, hashText } from '../dom'

export type DebriefTab = 'overview' | 'timeline' | 'regulars' | 'ailog'

export interface DebriefScreenOptions {
  state: GameState
  report: DebriefReport
  onBackToEnd(): void
  onTitle(): void
}

const RESULT_LABELS: Record<ApplicantResult, { text: string; cls: string }> = {
  got_through: { text: 'INFILTRATOR ADMITTED', cls: 'bad' },
  stopped: { text: 'INFILTRATOR STOPPED', cls: 'good' },
  legit_admitted: { text: 'LEGIT ADMITTED', cls: 'ok' },
  legit_denied: { text: 'LEGIT DENIED', cls: 'warn' },
  not_processed: { text: 'NOT PROCESSED', cls: 'muted' },
}

const MODE_LABELS = {
  introduce: 'INTRODUCED',
  reuse: 'RETURNED',
  impersonate: 'IMPERSONATED',
} as const

const PROVENANCE_LABELS = {
  genuine: { text: 'GENUINE', cls: 'ok' },
  altered: { text: 'ALTERED', cls: 'warn' },
  forged: { text: 'FORGED', cls: 'bad' },
  support_forgery: { text: 'SUPPORT FORGERY', cls: 'bad' },
  borrowed: { text: 'BORROWED', cls: 'warn' },
} as const

function formatPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function daySourceLabel(day: DebriefDay): string {
  if (day.source === 'claude') {
    if (day.serverFallback && day.model) return `Claude · server fallback (${day.model})`
    return day.model ? `Claude · ${day.model}` : 'Claude'
  }
  if (day.source === 'fallback') {
    return day.fallbackReason ? `Offline fallback (${day.fallbackReason})` : 'Offline fallback'
  }
  return day.offlinePhase ? `Offline · ${day.offlinePhase}` : 'Offline'
}

export function debriefScreen(options: DebriefScreenOptions): HTMLElement {
  const { state, report } = options
  let activeTab: DebriefTab = 'overview'
  let selectedDayIndex = report.days[0]?.dayIndex ?? 1
  let filterMode: 'all' | 'infiltrators' | 'missed' = 'all'

  const statusNote = el('span', { className: 'db-export-status' })

  const exportButton = el('button', { className: 'btn small primary', text: 'Export JSON' })
  exportButton.type = 'button'
  exportButton.dataset.action = 'export-debrief'
  exportButton.addEventListener('click', () => {
    const filename = debriefFilename(state)
    const payload = buildDebriefExport(state, report)
    downloadJson(filename, payload)
    statusNote.textContent = `Saved ${filename}`
  })

  const endButton = el('button', { className: 'btn small ghost', text: 'Final report' })
  endButton.type = 'button'
  endButton.dataset.action = 'to-end'
  endButton.addEventListener('click', options.onBackToEnd)

  const titleButton = el('button', { className: 'btn small ghost', text: 'Back to title' })
  titleButton.type = 'button'
  titleButton.dataset.action = 'to-title'
  titleButton.addEventListener('click', options.onTitle)

  const tabs: { id: DebriefTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: `Day by day (${report.days.length})` },
    { id: 'regulars', label: `Regulars (${report.characters.length})` },
    { id: 'ailog', label: 'AI log' },
  ]

  const tabButtons = new Map<DebriefTab, HTMLButtonElement>()
  const tabBar = el(
    'div',
    { className: 'db-tabs' },
    ...tabs.map((t) => {
      const b = el('button', { className: 'btn small ghost db-tab', text: t.label })
      b.type = 'button'
      b.dataset.tab = t.id
      b.addEventListener('click', () => {
        activeTab = t.id
        renderBody()
      })
      tabButtons.set(t.id, b)
      return b
    }),
  )

  const gradeTone =
    report.metrics.rating.grade === 'S' || report.metrics.rating.grade === 'A'
      ? 'good'
      : report.metrics.rating.grade === 'B'
        ? 'mid'
        : 'bad'

  const modeTag =
    report.adversary.mode === 'claude'
      ? `Claude (${report.adversary.model ?? 'default'})`
      : 'Offline adversary'

  const header = el(
    'div',
    { className: 'db-header' },
    el(
      'div',
      { className: 'db-title-block' },
      el(
        'div',
        { className: 'db-title-row' },
        el('span', { className: 'db-title', text: 'DEBRIEFING' }),
        el('span', {
          className: `db-grade-pill ${gradeTone}`,
          text: `${report.metrics.rating.grade} · ${report.metrics.rating.title}`,
        }),
      ),
      el('div', {
        className: 'db-sub',
        text: `${DIFFICULTIES[report.difficulty].label} · ${report.metrics.daysPlayed}/${report.metrics.daysTotal} days · ${modeTag} · seed #${report.seed}`,
      }),
    ),
    tabBar,
    el('div', { className: 'db-actions' }, statusNote, exportButton, endButton, titleButton),
  )

  const body = el('div', { className: 'db-body' })

  const jumpToDay = (dayIndex: number) => {
    selectedDayIndex = dayIndex
    activeTab = 'timeline'
    renderBody()
  }

  // ---------- Tab 1: Overview ----------

  const renderOverview = (): HTMLElement => {
    const m = report.metrics
    const stat = (
      label: string,
      value: string,
      sub: string,
      tone: 'good' | 'bad' | 'warn' | '' = '',
    ) =>
      el(
        'div',
        { className: `db-stat${tone ? ` tone-${tone}` : ''}` },
        el('div', { className: 'db-stat-label', text: label }),
        el('div', { className: 'db-stat-value', text: value }),
        el('div', { className: 'db-stat-sub', text: sub }),
      )

    const typingVal =
      m.typingForms > 0 ? `${formatPct(m.typingAccuracy)} · ${m.typingCpm ?? 0} CPM` : 'No forms'
    const typingSub =
      m.typingForms > 0
        ? `${m.typingChars} chars · ${m.typingTypos} ${m.typingTypos === 1 ? 'typo' : 'typos'} across ${m.typingForms} ${m.typingForms === 1 ? 'form' : 'forms'}`
        : 'No deep checks or incident reports filed'

    const metricsGrid = el(
      'div',
      { className: 'db-stat-grid' },
      stat(
        'Infiltrators admitted',
        `${m.infiltratorsThrough} / ${m.infiltratorsAttempted}`,
        m.infiltratorsThrough === 0
          ? `${m.infiltratorsStopped} stopped`
          : `${m.infiltratorsStopped} stopped · ${m.infiltratorsNeverCaughtInland} never caught inland`,
        m.infiltratorsThrough > 0 ? 'bad' : 'good',
      ),
      stat(
        'Legit travelers denied',
        `${m.legitDenied} / ${m.legitTotal}`,
        `${m.legitAdmitted} admitted · ${m.legitUnprocessed} unprocessed`,
        m.legitDenied > 0 ? 'warn' : 'good',
      ),
      stat(
        'Time in deep checks',
        `${m.deepCheckMinutes} min`,
        `${m.deepCheckCount} ${m.deepCheckCount === 1 ? 'check' : 'checks'} · ${m.incidentReportCount} incident ${m.incidentReportCount === 1 ? 'report' : 'reports'}`,
      ),
      stat('Typing accuracy & speed', typingVal, typingSub),
      stat(
        'Final savings',
        formatMoney(m.money),
        `+${formatMoney(m.totalIncome)} earned · -${formatMoney(m.totalExpenses)} spent (${formatMoney(m.finesTotal)} fines)`,
        m.money < 0 ? 'bad' : '',
      ),
      stat(
        'Queue processed',
        `${m.processed} / ${m.applicantsTotal}`,
        `${m.notProcessed} sent home at closing`,
      ),
      stat(
        'Bribes & levers',
        `${m.bribesTaken} taken`,
        `${m.bribesOffered} offered · ${formatMoney(m.bribesMoneyKept)} kept`,
        m.bribesTaken > 0 ? 'warn' : '',
      ),
      stat(
        'Adversary budget spent',
        `${report.adversary.totalCostSpent} pts`,
        report.adversary.fallbackDays > 0
          ? `${report.adversary.fallbackDays} fallback ${report.adversary.fallbackDays === 1 ? 'day' : 'days'}`
          : `${report.characters.length} recurring ${report.characters.length === 1 ? 'figure' : 'figures'}`,
      ),
    )

    // Tool usage & blind spots chart
    const maxUses = Math.max(1, ...TOOL_IDS.map((t) => m.toolUsage[t]), m.incidentReportCount)
    const toolBar = (label: string, count: number, note?: string) => {
      const pct = Math.round((count / maxUses) * 100)
      const fill = el('div', { className: `db-bar-fill${count === 0 ? ' zero' : ''}` })
      fill.style.width = count === 0 ? '0%' : `${Math.max(4, pct)}%`
      return el(
        'div',
        { className: 'db-bar-row' },
        el('div', { className: 'db-bar-label', text: label }),
        el('div', { className: 'db-bar-track' }, fill),
        el('div', {
          className: `db-bar-count${count === 0 ? ' zero' : ''}`,
          text: count === 0 ? (note ?? '0 · unused') : String(count),
        }),
      )
    }

    const toolsCard = el(
      'div',
      { className: 'db-card' },
      el('div', { className: 'db-card-title', text: 'TOOL USAGE & BLIND SPOTS' }),
      el('div', {
        className: 'db-card-sub',
        text: 'The adversary tracks which tools you neglect and chooses techniques that only those tools uncover.',
      }),
      el(
        'div',
        { className: 'db-bars' },
        ...TOOL_IDS.map((t) => toolBar(TOOL_NAMES[t], m.toolUsage[t], '0 · blind spot')),
        toolBar('Incident Report', m.incidentReportCount, '0'),
      ),
    )

    // Day-by-day summary table
    const dayTable = el(
      'div',
      { className: 'db-card' },
      el('div', { className: 'db-card-title', text: 'ASSIGNMENT TIMELINE AT A GLANCE' }),
      el(
        'div',
        { className: 'db-day-table' },
        el(
          'div',
          { className: 'db-dt-head' },
          el('span', { text: 'Day' }),
          el('span', { text: 'Planner' }),
          el('span', { text: 'Cost' }),
          el('span', { text: 'Infiltrators' }),
          el('span', { text: 'Denied' }),
          el('span', { text: '' }),
        ),
        ...report.days.map((d) => {
          const openBtn = el('button', { className: 'btn small ghost', text: 'Inspect' })
          openBtn.type = 'button'
          openBtn.addEventListener('click', () => jumpToDay(d.dayIndex))
          return el(
            'div',
            {
              className: `db-dt-row${d.infiltratorsThrough > 0 ? ' breach' : d.legitDenied > 0 ? ' warn' : ''}`,
            },
            el('span', { text: `Day ${d.dayIndex}` }),
            el('span', { text: daySourceLabel(d) }),
            el('span', { text: `${d.costSpent} ${d.costSpent === 1 ? 'pt' : 'pts'}` }),
            el('span', {
              className: d.infiltratorsThrough > 0 ? 'txt-bad' : 'txt-good',
              text: `${d.infiltratorsThrough} through / ${d.infiltratorsAttempted}`,
            }),
            el('span', {
              className: d.legitDenied > 0 ? 'txt-warn' : '',
              text: String(d.legitDenied),
            }),
            openBtn,
          )
        }),
      ),
    )

    const verdictCard = el(
      'div',
      { className: `db-card db-verdict ${gradeTone}` },
      el(
        'div',
        { className: 'db-verdict-stamp' },
        el('div', { className: 'db-verdict-letter', text: m.rating.grade }),
        el('div', { className: 'db-verdict-score', text: `${m.rating.score}/100` }),
      ),
      el(
        'div',
        { className: 'db-verdict-text' },
        el('div', {
          className: 'db-verdict-title',
          text: `${report.kind === 'gameover' ? 'DISMISSED' : 'ASSESSMENT'} · ${m.rating.title}`,
        }),
        el('div', { className: 'db-verdict-summary', text: m.rating.summary }),
      ),
    )

    return el(
      'div',
      { className: 'db-overview' },
      el('div', { className: 'db-ov-left' }, verdictCard, metricsGrid),
      el('div', { className: 'db-ov-right' }, toolsCard, dayTable),
    )
  }

  // ---------- Tab 2: Day-by-day timeline ----------

  const renderEvidenceRow = (e: DebriefEvidence): HTMLElement => {
    const status = e.used
      ? { text: 'FOUND', cls: 'ev-used' }
      : e.criticalMiss
        ? { text: 'MISSED · UNUSED', cls: 'ev-missed' }
        : e.unused
          ? { text: 'UNUSED', cls: 'ev-unused' }
          : { text: 'INTERVIEW', cls: 'ev-interrogate' }
    return el(
      'div',
      { className: `db-ev-row ${status.cls}` },
      el('span', { className: `db-ev-badge ${status.cls}`, text: status.text }),
      el('span', { className: 'db-ev-tool', text: e.toolLabel }),
      el('span', { className: `db-ev-diff diff-${e.difficulty}`, text: e.difficulty }),
      el(
        'div',
        { className: 'db-ev-text' },
        el('span', {
          className: 'db-ev-msg',
          text: `${e.violationMessage.replace(/\.$/, '')} — `,
        }),
        el('span', { text: e.description }),
      ),
    )
  }

  const renderApplicantVisuals = (entry: DebriefApplicant): HTMLElement => {
    const a = entry.applicant
    const container = el('div', { className: 'db-visuals' })

    // Face comparison whenever identity differs, disguise used, or photo mismatch exists
    const showFaceCompare =
      entry.identityDiffers ||
      a.techniques.some((t) => t.type === 'disguise' || t.type === 'borrowed_identity') ||
      a.violations.some((v) => v.code === 'PHOTO_MISMATCH' || v.code === 'IDENTITY_MISMATCH')

    if (showFaceCompare) {
      const strip = el(
        'div',
        { className: 'db-compare-row' },
        el(
          'figure',
          { className: 'db-fig' },
          portraitCanvas(a.appearance.face, 3, { coat: hashText(a.id) % 6 }),
          el('figcaption', { text: 'At the window' }),
        ),
        entry.passportPhoto
          ? el(
              'figure',
              { className: 'db-fig' },
              portraitCanvas(entry.passportPhoto, 3, { sepia: true, background: PHOTO_BG }),
              el('figcaption', { text: 'Passport photo' }),
            )
          : null,
        entry.trueIdentity && entry.identityDiffers
          ? el(
              'figure',
              { className: 'db-fig' },
              portraitCanvas(entry.trueIdentity.face, 3, { coat: 0 }),
              el('figcaption', { text: `True person (${entry.trueName ?? ''})` }),
            )
          : null,
      )
      container.append(el('div', { className: 'db-subhead', text: 'FACE COMPARISON' }), strip)
    }

    // Forged seals side by side with valid reference seals
    if (entry.forgedSeals.length > 0) {
      container.append(el('div', { className: 'db-subhead', text: 'FORGED SEALS VS VALID SEALS' }))
      for (const s of entry.forgedSeals) {
        const diffText =
          s.differences.length > 0
            ? `Differs in: ${s.differences.join(', ')}`
            : 'Seal does not match valid authority design'
        container.append(
          el(
            'div',
            { className: 'db-seal-compare' },
            el(
              'div',
              { className: 'db-seal-meta' },
              el('div', { className: 'db-seal-doc', text: `${s.docTitle} · ${s.authorityName}` }),
              el('div', { className: 'db-seal-diff', text: diffText }),
            ),
            el(
              'div',
              { className: 'db-compare-row' },
              el(
                'figure',
                { className: 'db-fig bad' },
                sealCanvas(s.forged, 2),
                el('figcaption', { text: 'Presented (forged)' }),
              ),
              ...s.valid.map((v, i) =>
                el(
                  'figure',
                  { className: 'db-fig ok' },
                  sealCanvas(v, 2),
                  el('figcaption', {
                    text: s.valid.length > 1 ? `Valid design ${i + 1}` : 'Valid seal',
                  }),
                ),
              ),
            ),
          ),
        )
      }
    }

    // Documents with provenance badges and tamper notes
    container.append(el('div', { className: 'db-subhead', text: 'DOCUMENTS PRESENTED' }))
    const docsWrap = el('div', { className: 'db-docs-wrap' })
    for (const doc of a.documents) {
      const prov = PROVENANCE_LABELS[doc.provenance]
      const rendered = renderDocument(doc)
      rendered.classList.add('db-doc-static')
      docsWrap.append(
        el(
          'div',
          { className: 'db-doc-box' },
          el(
            'div',
            { className: 'db-doc-meta' },
            el('span', { className: 'db-doc-type', text: DOC_TITLES[doc.type] }),
            el('span', { className: `db-pill ${prov.cls}`, text: prov.text }),
            doc.tamperNote
              ? el('span', { className: 'db-tamper-note', text: doc.tamperNote })
              : null,
          ),
          el('div', { className: 'db-doc-frame' }, rendered),
        ),
      )
    }
    container.append(docsWrap)
    return container
  }

  const renderApplicantCard = (entry: DebriefApplicant): HTMLElement => {
    const a = entry.applicant
    const o = entry.outcome
    const res = RESULT_LABELS[entry.result]
    const decisionText =
      o.decision === 'none'
        ? 'Not processed'
        : o.decision === 'approve'
          ? 'APPROVED'
          : o.documentedReason
            ? `DENIED (${o.documentedReason})`
            : 'DENIED (undocumented)'

    const visualsHost = el('div', { className: 'db-visuals-host hidden' })
    let visualsBuilt = false
    const toggleBtn = el('button', {
      className: 'btn small ghost db-visuals-toggle',
      text: 'Show papers & visuals',
    })
    toggleBtn.type = 'button'
    toggleBtn.addEventListener('click', () => {
      const hidden = visualsHost.classList.toggle('hidden')
      if (!hidden && !visualsBuilt) {
        visualsHost.append(renderApplicantVisuals(entry))
        visualsBuilt = true
      }
      toggleBtn.textContent = hidden ? 'Show papers & visuals' : 'Hide papers & visuals'
    })

    const hasTamperedDocs = a.documents.some((d) => d.provenance !== 'genuine')
    const portrait = portraitCanvas(a.appearance.face, 2, { coat: hashText(a.id) % 6 })

    const headBadges = el(
      'div',
      { className: 'db-app-badges' },
      el('span', {
        className: `db-pill ${a.kind === 'infiltrator' ? 'bad' : 'ok'}`,
        text: a.kind === 'infiltrator' ? 'INFILTRATOR' : 'LEGIT',
      }),
      entry.baseProblemLabel
        ? el('span', { className: 'db-pill warn', text: entry.baseProblemLabel })
        : null,
      entry.legitQuirkDescription
        ? el('span', { className: 'db-pill info', text: a.plan.legit_quirk.replace(/_/g, ' ') })
        : null,
      entry.character
        ? el('span', {
            className: 'db-pill reg',
            text: `${entry.character.nickname} · ${MODE_LABELS[entry.character.mode]}`,
          })
        : null,
      entry.criticalMissCount > 0
        ? el('span', {
            className: 'db-pill bad',
            text: `${entry.criticalMissCount} missed ${entry.criticalMissCount === 1 ? 'clue' : 'clues'}`,
          })
        : null,
    )

    const trueIdNote =
      entry.identityDiffers && entry.trueName
        ? el('div', {
            className: 'db-true-id',
            text: `True identity: ${entry.trueName}${entry.trueIdentity ? ` (${COUNTRIES[entry.trueIdentity.nationality].name})` : ''}`,
          })
        : null

    const techBlock =
      entry.techniques.length > 0
        ? el(
            'div',
            { className: 'db-detail-row' },
            el('span', { className: 'db-k', text: 'Techniques' }),
            el(
              'div',
              { className: 'db-v db-tech-list' },
              ...entry.techniques.map((t) =>
                el(
                  'div',
                  { className: 'db-tech-item' },
                  el('span', { className: 'db-pill warn', text: `${t.label} (${t.cost} pt)` }),
                  el('span', { className: 'db-tech-note', text: t.note }),
                ),
              ),
            ),
          )
        : null

    const intentBlock = a.plan.private_intent
      ? el(
          'div',
          { className: 'db-detail-row' },
          el('span', { className: 'db-k', text: 'AI intent' }),
          el('div', { className: 'db-v', text: a.plan.private_intent }),
        )
      : null

    const coordBlock = a.plan.coordination_note
      ? el(
          'div',
          { className: 'db-detail-row' },
          el('span', { className: 'db-k', text: 'Coordination' }),
          el('div', { className: 'db-v', text: a.plan.coordination_note }),
        )
      : null

    const leverBlock =
      a.plan.lever.type !== 'none'
        ? el(
            'div',
            { className: 'db-detail-row' },
            el('span', { className: 'db-k', text: 'Lever' }),
            el(
              'div',
              { className: 'db-v' },
              el('span', {
                className: `db-pill ${a.plan.lever.real ? 'bad' : 'muted'}`,
                text: `${a.plan.lever.real ? 'REAL' : 'EMPTY'} ${a.plan.lever.type.toUpperCase()}${a.plan.lever.amount ? ` (${formatMoney(a.plan.lever.amount)})` : ''}`,
              }),
              entry.leverSummary
                ? el('span', { className: 'db-lever-text', text: ` ${entry.leverSummary}` })
                : null,
            ),
          )
        : null

    const toolsBlock = el(
      'div',
      { className: 'db-detail-row' },
      el('span', { className: 'db-k', text: 'Tools used' }),
      el(
        'div',
        { className: 'db-v db-tool-pills' },
        ...(entry.toolsUsed.length > 0
          ? entry.toolsUsed.map((t) =>
              el('span', {
                className: 'db-tool-chip',
                text: `${t.label} ×${t.count}${t.detail ? ` (${t.detail})` : ''}`,
              }),
            )
          : [el('span', { className: 'db-muted', text: 'No tools used' })]),
        el('span', {
          className: 'db-muted',
          text: ` · ${o.minutesSpent} min at window`,
        }),
      ),
    )

    const evidenceBlock =
      entry.evidence.length > 0
        ? el(
            'div',
            { className: 'db-evidence-box' },
            el(
              'div',
              { className: 'db-ev-heading' },
              el('span', { text: 'AVAILABLE EVIDENCE' }),
              entry.unusedEvidenceCount > 0
                ? el('span', {
                    className: 'db-ev-summary-warn',
                    text: `${entry.unusedEvidenceCount} unused`,
                  })
                : el('span', {
                    className: 'db-ev-summary-ok',
                    text: 'All conclusive clues checked',
                  }),
            ),
            ...entry.evidence.map(renderEvidenceRow),
          )
        : entry.legitQuirkDescription
          ? el('div', {
              className: 'db-quirk-note',
              text: `Legal quirk: ${entry.legitQuirkDescription}`,
            })
          : null

    const consequenceLines: HTMLElement[] = entry.consequences.map((c) =>
      el('div', { className: 'db-consequence-line', text: `Day ${c.day}: ${c.text}` }),
    )
    if (entry.result === 'got_through' && entry.caughtInlandDay === null) {
      consequenceLines.push(
        el('div', {
          className: 'db-consequence-line undetected',
          text: 'Never detected inland during the assignment — only revealed here in the debrief.',
        }),
      )
    }

    const consequencesBlock =
      consequenceLines.length > 0
        ? el(
            'div',
            { className: 'db-detail-row' },
            el('span', { className: 'db-k', text: 'Aftermath' }),
            el('div', { className: 'db-v' }, ...consequenceLines),
          )
        : null

    return el(
      'div',
      {
        className: `db-app-card result-${entry.result}${entry.criticalMissCount > 0 ? ' has-missed' : ''}`,
      },
      el(
        'div',
        { className: 'db-app-head' },
        el('div', { className: 'db-app-portrait' }, portrait),
        el(
          'div',
          { className: 'db-app-ident' },
          el(
            'div',
            { className: 'db-app-name-row' },
            el('span', { className: 'db-app-slot', text: `#${entry.slot + 1}` }),
            el('span', { className: 'db-app-name', text: entry.shownName }),
            headBadges,
          ),
          trueIdNote,
        ),
        el(
          'div',
          { className: 'db-app-outcome' },
          el('div', { className: `db-result-pill ${res.cls}`, text: res.text }),
          el('div', { className: 'db-decision-text', text: decisionText }),
        ),
      ),
      el(
        'div',
        { className: 'db-app-body' },
        techBlock,
        intentBlock,
        coordBlock,
        leverBlock,
        toolsBlock,
        evidenceBlock,
        consequencesBlock,
        el(
          'div',
          { className: 'db-app-foot' },
          toggleBtn,
          hasTamperedDocs
            ? el('span', {
                className: 'db-tamper-flag',
                text: 'Contains tampered or forged papers',
              })
            : null,
        ),
        visualsHost,
      ),
    )
  }

  const renderTimeline = (): HTMLElement => {
    const selectedDay =
      report.days.find((d) => d.dayIndex === selectedDayIndex) ?? report.days[0] ?? null

    const dayList = el(
      'div',
      { className: 'db-day-rail' },
      el('div', { className: 'db-rail-title', text: 'DAYS' }),
      ...report.days.map((d) => {
        const active = selectedDay?.dayIndex === d.dayIndex
        const tone = d.infiltratorsThrough > 0 ? 'bad' : d.legitDenied > 0 ? 'warn' : 'good'
        const b = el(
          'button',
          { className: `db-day-btn${active ? ' active' : ''} tone-${tone}` },
          el(
            'div',
            { className: 'db-day-btn-top' },
            el('span', { text: `Day ${d.dayIndex}` }),
            el('span', { className: `db-dot ${tone}` }),
          ),
          el('div', {
            className: 'db-day-btn-sub',
            text:
              d.infiltratorsThrough > 0
                ? `${d.infiltratorsThrough} breach${d.infiltratorsThrough === 1 ? '' : 'es'} · ${d.costSpent} ${d.costSpent === 1 ? 'pt' : 'pts'}`
                : `${d.infiltratorsStopped}/${d.infiltratorsAttempted} stopped · ${d.costSpent} ${d.costSpent === 1 ? 'pt' : 'pts'}`,
          }),
        )
        b.type = 'button'
        b.dataset.day = String(d.dayIndex)
        b.addEventListener('click', () => {
          selectedDayIndex = d.dayIndex
          renderBody()
        })
        return b
      }),
    )

    if (!selectedDay) {
      return el('div', {
        className: 'db-empty',
        text: 'No shift records were completed in this game.',
      })
    }

    const filterButtons = (
      [
        { id: 'all', label: `All (${selectedDay.applicants.length})` },
        {
          id: 'infiltrators',
          label: `Infiltrators (${selectedDay.applicants.filter((a) => !a.applicant.admissible).length})`,
        },
        {
          id: 'missed',
          label: `Mistakes & missed (${selectedDay.applicants.filter((a) => a.result === 'got_through' || a.result === 'legit_denied' || a.criticalMissCount > 0).length})`,
        },
      ] as const
    ).map((f) => {
      const b = el('button', {
        className: `btn small ${filterMode === f.id ? 'primary' : 'ghost'}`,
        text: f.label,
      })
      b.type = 'button'
      b.dataset.filter = f.id
      b.addEventListener('click', () => {
        filterMode = f.id
        renderBody()
      })
      return b
    })

    const filteredApplicants = selectedDay.applicants.filter((a) => {
      if (filterMode === 'infiltrators') return !a.applicant.admissible
      if (filterMode === 'missed') {
        return a.result === 'got_through' || a.result === 'legit_denied' || a.criticalMissCount > 0
      }
      return true
    })

    const strategyCard = el(
      'div',
      { className: 'db-card db-strategy-card' },
      el(
        'div',
        { className: 'db-strat-head' },
        el(
          'div',
          {},
          el('div', {
            className: 'db-card-title',
            text: `DAY ${selectedDay.dayIndex} · ${formatDocDate(selectedDay.date)}`,
          }),
          el('div', { className: 'db-strat-headline', text: selectedDay.headline }),
        ),
        el(
          'div',
          { className: 'db-strat-badges' },
          el('span', { className: 'db-pill info', text: daySourceLabel(selectedDay) }),
          el('span', { className: 'db-pill warn', text: `Spent ${selectedDay.costSpent} pts` }),
        ),
      ),
      el(
        'div',
        { className: 'db-strat-grid' },
        el(
          'div',
          { className: 'db-strat-block' },
          el('div', { className: 'db-subhead', text: 'ADVERSARY STRATEGY' }),
          el('p', {
            className: 'db-strategy-text',
            text: selectedDay.strategySummary || '(No strategy summary written.)',
          }),
        ),
        el(
          'div',
          { className: 'db-strat-block' },
          el('div', { className: 'db-subhead', text: 'NOTES FOR FUTURE SELF' }),
          el('p', {
            className: 'db-notes-text',
            text: selectedDay.notesForFutureSelf || '(No notes written.)',
          }),
        ),
      ),
      selectedDay.notice
        ? el('div', { className: 'db-plan-notice', text: `Notice: ${selectedDay.notice}` })
        : null,
      selectedDay.issues.length > 0
        ? el(
            'div',
            { className: 'db-issues-box' },
            el('div', { className: 'db-subhead', text: 'ENGINE PLAN ADJUSTMENTS' }),
            el(
              'ul',
              { className: 'db-list' },
              ...selectedDay.issues.map((issue) => el('li', { text: issue })),
            ),
          )
        : null,
      selectedDay.events.length > 0
        ? el(
            'div',
            { className: 'db-events-box' },
            el('div', { className: 'db-subhead', text: 'EVENTS ON THIS DAY' }),
            el(
              'ul',
              { className: 'db-list' },
              ...selectedDay.events.map((ev) => el('li', { text: ev.text })),
            ),
          )
        : null,
    )

    const content = el(
      'div',
      { className: 'db-day-main' },
      strategyCard,
      el(
        'div',
        { className: 'db-filter-row' },
        el('span', { className: 'db-subhead', text: 'THE QUEUE' }),
        el('div', { className: 'db-filter-btns' }, ...filterButtons),
      ),
      ...(filteredApplicants.length > 0
        ? filteredApplicants.map(renderApplicantCard)
        : [el('div', { className: 'db-empty-small', text: 'No travelers match this filter.' })]),
    )

    return el('div', { className: 'db-timeline' }, dayList, content)
  }

  // ---------- Tab 3: Regulars ----------

  const renderCharacterCard = (char: DebriefCharacter): HTMLElement => {
    const face = char.truePerson?.face ?? char.appearances[0]?.appearanceFace ?? null
    const meta = char.truePerson
      ? `${COUNTRIES[char.truePerson.nationality].name} · ${char.truePerson.occupation} · first seen Day ${char.introducedDay}`
      : `First seen Day ${char.introducedDay}`

    return el(
      'div',
      { className: 'db-card db-char-card' },
      el(
        'div',
        { className: 'db-char-head' },
        face
          ? el('div', { className: 'db-char-portrait' }, portraitCanvas(face, 3, { coat: 1 }))
          : null,
        el(
          'div',
          { className: 'db-char-info' },
          el(
            'div',
            { className: 'db-char-name-row' },
            el('span', { className: 'db-char-nick', text: char.nickname }),
            el('span', { className: 'db-char-real', text: char.trueName }),
          ),
          el('div', { className: 'db-char-meta', text: meta }),
          el('div', { className: 'db-char-arc', text: char.arcSummary }),
        ),
      ),
      el(
        'div',
        { className: 'db-char-steps' },
        ...char.appearances.map((app) => {
          const res = RESULT_LABELS[app.result]
          const modeCls =
            app.mode === 'impersonate' ? 'bad' : app.kind === 'infiltrator' ? 'warn' : 'ok'
          return el(
            'div',
            { className: `db-char-step result-${app.result}` },
            el(
              'div',
              { className: 'db-step-top' },
              el('span', { className: 'db-step-day', text: `Day ${app.day}` }),
              el('span', { className: `db-pill ${modeCls}`, text: MODE_LABELS[app.mode] }),
              el('span', {
                className: `db-pill ${app.kind === 'infiltrator' ? 'bad' : 'ok'}`,
                text: app.kind === 'infiltrator' ? 'INFILTRATOR' : 'LEGIT',
              }),
              el('span', { className: `db-result-pill ${res.cls}`, text: res.text }),
            ),
            app.mode === 'impersonate' && app.appearanceFace && char.truePerson
              ? el(
                  'div',
                  { className: 'db-compare-row compact' },
                  el(
                    'figure',
                    { className: 'db-fig ok' },
                    portraitCanvas(char.truePerson.face, 2, { coat: 1 }),
                    el('figcaption', { text: 'Real regular' }),
                  ),
                  el(
                    'figure',
                    { className: 'db-fig bad' },
                    portraitCanvas(app.appearanceFace, 2, { coat: 3 }),
                    el('figcaption', { text: 'Imposter at window' }),
                  ),
                )
              : null,
            app.baseProblemLabel || app.techniques.length > 0
              ? el('div', {
                  className: 'db-step-meta',
                  text: [
                    app.baseProblemLabel ? `Problem: ${app.baseProblemLabel}` : null,
                    app.techniques.length > 0 ? `Techniques: ${app.techniques.join(', ')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                })
              : null,
            app.privateIntent
              ? el('div', { className: 'db-step-intent', text: app.privateIntent })
              : null,
          )
        }),
      ),
    )
  }

  const renderRegulars = (): HTMLElement => {
    if (report.characters.length === 0) {
      return el('div', {
        className: 'db-empty',
        text: 'No recurring characters were introduced during this assignment.',
      })
    }
    return el('div', { className: 'db-regulars' }, ...report.characters.map(renderCharacterCard))
  }

  // ---------- Tab 4: AI Log ----------

  const renderAiLog = (): HTMLElement => {
    const adv = report.adversary
    const sections: HTMLElement[] = []

    sections.push(
      el(
        'div',
        { className: 'db-card' },
        el('div', { className: 'db-card-title', text: 'ADVERSARY PLANNER SUMMARY' }),
        el(
          'div',
          { className: 'db-ai-meta' },
          el('span', {
            text: `Mode: ${adv.mode === 'claude' ? 'Claude API' : 'Offline rule-based'}`,
          }),
          adv.model ? el('span', { text: `Requested model: ${adv.model}` }) : null,
          el('span', { text: `Total budget spent: ${adv.totalCostSpent} pts` }),
          el('span', { text: `Fallback days: ${adv.fallbackDays}` }),
        ),
      ),
    )

    if (adv.claudeLog.length > 0) {
      sections.push(
        el(
          'div',
          { className: 'db-card' },
          el('div', { className: 'db-card-title', text: 'CLAUDE PLANNER LOG' }),
          el(
            'div',
            { className: 'db-log-table' },
            el(
              'div',
              { className: 'db-log-head' },
              el('span', { text: 'Day' }),
              el('span', { text: 'Source' }),
              el('span', { text: 'Model' }),
              el('span', { text: 'Notes' }),
            ),
            ...adv.claudeLog.map((entry) => {
              const serverFb =
                entry.source === 'claude' &&
                entry.model !== null &&
                adv.model !== null &&
                entry.model !== adv.model
              return el(
                'div',
                { className: `db-log-row${entry.source === 'fallback' ? ' warn' : ''}` },
                el('span', { text: `Day ${entry.day}` }),
                el('span', { text: entry.source.toUpperCase() }),
                el('span', { text: entry.model ?? '—' }),
                el('span', {
                  text: entry.reason
                    ? `Fallback reason: ${entry.reason}`
                    : serverFb
                      ? 'Answered via server-side fallback model'
                      : 'Planned normally',
                }),
              )
            }),
          ),
        ),
      )
    }

    if (adv.claudeTurns.length > 0) {
      sections.push(
        el(
          'div',
          { className: 'db-card' },
          el('div', {
            className: 'db-card-title',
            text: `CLAUDE PLANNING CONVERSATION (${adv.claudeTurns.length} ${adv.claudeTurns.length === 1 ? 'TURN' : 'TURNS'})`,
          }),
          ...adv.claudeTurns.map((turn) => {
            const box = el('div', { className: 'db-turn-body hidden' })
            if (turn.thinking) {
              box.append(
                el('div', { className: 'db-subhead', text: 'THINKING' }),
                el('pre', { className: 'db-pre', text: turn.thinking }),
              )
            }
            box.append(
              el('div', { className: 'db-subhead', text: 'PLAN OUTPUT PREVIEW' }),
              el('pre', { className: 'db-pre', text: turn.responsePreview }),
            )
            const btn = el('button', {
              className: 'btn small ghost',
              text: `Turn ${turn.turn}${turn.day ? ` · Day ${turn.day}` : ''}${turn.model ? ` (${turn.model})` : ''} · Show`,
            })
            btn.type = 'button'
            btn.addEventListener('click', () => {
              const hidden = box.classList.toggle('hidden')
              btn.textContent = `Turn ${turn.turn}${turn.day ? ` · Day ${turn.day}` : ''}${turn.model ? ` (${turn.model})` : ''} · ${hidden ? 'Show' : 'Hide'}`
            })
            return el('div', { className: 'db-turn' }, btn, box)
          }),
        ),
      )
    }

    if (adv.offlineJournal.length > 0) {
      sections.push(
        el(
          'div',
          { className: 'db-card' },
          el('div', { className: 'db-card-title', text: 'OFFLINE ADVERSARY JOURNAL' }),
          ...adv.offlineJournal.map((j) =>
            el(
              'div',
              { className: 'db-journal-entry' },
              el(
                'div',
                { className: 'db-journal-head' },
                el('span', {
                  className: 'db-pill info',
                  text: `DAY ${j.day} · ${j.phase.toUpperCase()}`,
                }),
                el('span', { className: 'db-pill warn', text: `Cost ${j.cost} pts` }),
                j.premiumSlot !== null
                  ? el('span', {
                      className: 'db-pill muted',
                      text: `Main attempt: slot #${j.premiumSlot + 1}`,
                    })
                  : null,
              ),
              el('div', { className: 'db-journal-line', text: j.strategy }),
              el('div', { className: 'db-journal-note', text: j.notes }),
            ),
          ),
        ),
      )
    }

    return el('div', { className: 'db-ailog' }, ...sections)
  }

  const renderBody = () => {
    for (const [id, b] of tabButtons) {
      b.classList.toggle('active', id === activeTab)
    }
    if (activeTab === 'overview') body.replaceChildren(renderOverview())
    else if (activeTab === 'timeline') body.replaceChildren(renderTimeline())
    else if (activeTab === 'regulars') body.replaceChildren(renderRegulars())
    else body.replaceChildren(renderAiLog())
  }

  renderBody()

  return el('div', { className: 'screen debrief-screen' }, header, body)
}
