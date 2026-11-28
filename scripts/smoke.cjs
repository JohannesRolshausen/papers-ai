// Browser smoke and end-to-end test for OVERSIGHT.
// Run with `npm run smoke`, `npm run smoke:full` or `npm run smoke:claude`.
// Builds the game, serves it with `vite preview`, drives Chromium through Playwright and fails on
// any console or page error.
//
// Options:
//   --shots <dir>  saves 2x screenshots of the screens visited in this run
//   --full         plays a full 7-day Easy game offline: corrupted-save recovery, mute toggle,
//                  day 1 inspection + deep check with typo + stamps, evening and mid-shift reload
//                  with Continue, supervisor reviews, final report, full debrief with visible AI
//                  strategy, missed evidence, regulars, AI log, and JSON export download
//   --claude       plays in Claude mode against a scripted stand-in for the API
//                  (?test&mock=claude): key check, plan from Claude, a streamed free question,
//                  the plan for day 2 requested during the evening, and the key dialog after
//                  a reload without a stored key

const path = require('node:path')
const fs = require('node:fs')

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'playwright-core',
    '/opt/pyenv/versions/3.12.16/lib/python3.12/site-packages/playwright/driver/package',
  ].filter(Boolean)
  for (const id of candidates) {
    try {
      return require(id)
    } catch {
      // Try the next resolution candidate
    }
  }
  throw new Error('Playwright module not found. Install playwright or set PLAYWRIGHT_MODULE.')
}

const { chromium } = loadPlaywright()

const SEED = 7
const args = process.argv.slice(2)
const shotsIndex = args.indexOf('--shots')
const shotsDir = shotsIndex >= 0 ? path.resolve(args[shotsIndex + 1] ?? 'shots') : null
const full = args.includes('--full')
const claude = args.includes('--claude')
const KEY_ITEM = 'oversight-claude-key'
const MOCK_KEY = 'sk-ant-mock-key-0001'

function refKey(ref) {
  switch (ref.kind) {
    case 'doc':
      return `doc:${ref.docId}:${ref.field}`
    case 'person':
      return `person:${ref.field}`
    case 'calendar':
      return 'calendar'
    case 'rule':
      return `rule:${ref.ruleId}`
    case 'rulebook':
      return `rulebook:${ref.section}:${ref.key}`
    case 'bulletin':
      return ref.key === null ? `bulletin:${ref.section}` : `bulletin:${ref.section}:${ref.key}`
  }
  return ''
}

function check(condition, message) {
  if (!condition) throw new Error(`Smoke test failed: ${message}`)
  console.log(`ok - ${message}`)
}

async function shot(page, name) {
  if (!shotsDir) return
  fs.mkdirSync(shotsDir, { recursive: true })
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) })
}

// Inspect refs of the first violation the inspect tool can reveal, or null
async function inspectRefs(page) {
  const refs = await page.evaluate(() => {
    const a = window.__oversightTest.current()
    if (!a) return null
    for (const v of a.violations) {
      for (const e of v.evidence) if (e.tool === 'inspect') return e.refs
    }
    return null
  })
  return refs ? refs.map(refKey) : null
}

async function stamp(page, decision) {
  const stampButton = `[data-action=stamp-${decision}]`
  await page.click(stampButton)
  // The person may interrupt the first stamp with last words, then stamp again
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.click(stampButton)
    try {
      await page.waitForFunction(() => !document.querySelector('.doc[data-applicant]'), null, {
        timeout: 6000,
      })
      return
    } catch {
      // Still at the window, try the stamp once more
    }
  }
  throw new Error(`Smoke test failed: could not stamp ${decision}`)
}

async function openPanelFor(page, key) {
  if (key.startsWith('rulebook:') || key.startsWith('rule:')) {
    if (!(await page.locator('.rulebook').isVisible()))
      await page.click('.panel-btn >> text=Rulebook')
    const tab = key.startsWith('rule:') ? 'rules' : key.split(':')[1]
    await page.click(`.rb-tab[data-tab=${tab}]`)
  }
  if (key.startsWith('bulletin:')) {
    if (!(await page.locator('.bulletin-sheet').isVisible())) {
      await page.click('.panel-btn >> text=Bulletin')
    }
  }
}

async function openBoothWithReviews(page, day) {
  await page.waitForSelector('[data-action=start-shift]:enabled')
  await page.click('[data-action=start-shift]')
  // Supervisor reviews from complaints are typed before the shift
  while (!(await page.locator('.booth').count())) {
    if (await page.locator('.screen-modal .typing-test').count()) {
      const line = await page.evaluate(() =>
        [...document.querySelectorAll('.screen-modal .tt-char')].map((c) => c.textContent).join(''),
      )
      await page.keyboard.type(line, { delay: 2 })
      await page.keyboard.press('Enter')
      check(true, `supervisor review typed on day ${day}`)
    }
    await page.waitForTimeout(100)
  }
}

async function run(url) {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: shotsDir ? 2 : 1,
    acceptDownloads: true,
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${url}?test&seed=${SEED}${claude ? '&mock=claude' : ''}`)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  if (full) {
    // Damaged save handling on the title screen
    await page.evaluate(() => {
      localStorage.setItem('oversight-save', '{damaged-json')
    })
    await page.reload()
    await page.waitForSelector('.title-notice.corrupted')
    check(
      (await page.locator('[data-action=continue-game]').count()) === 0,
      'corrupted save hides Continue and shows a clear notice',
    )
    await page.click('[data-action=clear-corrupt-save]')
    check(
      (await page.locator('.title-notice').count()) === 0,
      'clearing the damaged save removes the notice',
    )
  } else {
    await page.reload()
  }

  await page.click('text=New game')
  await page.click('[data-difficulty=easy]')
  if (claude) {
    await setupClaude(page)
  } else {
    await page.click('[data-mode=offline]')
  }
  await page.click('text=Report for duty')
  await page.waitForSelector('.bulletin-screen')
  if (claude) {
    check(
      (await page.textContent('.bulletin-status')).includes('The line is forming'),
      'bulletin shows the loading text while Claude plans',
    )
  }
  await page.waitForSelector('[data-action=start-shift]:enabled')
  await shot(page, 'bulletin')
  check(true, `${claude ? 'Claude' : 'offline'} game started, bulletin shown`)
  if (claude) await checkClaudeSave(page)

  await page.click('[data-action=start-shift]')
  await page.waitForSelector('.booth')
  check(true, 'bulletin dismissed, booth open')

  if (full) {
    // Verify the mute button toggles and persists its preference in localStorage
    await page.click('[data-action=toggle-mute]')
    const mutedState = await page.evaluate(() => ({
      text: document.querySelector('[data-action=toggle-mute]')?.textContent,
      stored: localStorage.getItem('oversight-muted'),
    }))
    check(
      mutedState.text === 'Muted [M]' && mutedState.stored === '1',
      'mute toggle works and persists per device',
    )
    await page.click('[data-action=toggle-mute]')
    check(
      (await page.textContent('[data-action=toggle-mute]')) === 'Sound [M]',
      'mute toggle switches back to Sound [M]',
    )
  }

  let inspected = false
  let deepChecked = false
  let approved = false
  let denied = false
  let processed = 0
  for (let i = 0; i < 30; i++) {
    const label = await page.textContent('[data-action=call-next]')
    if (label.includes('Close')) break
    await page.click('[data-action=call-next]')
    await page.waitForSelector('.doc[data-applicant]')
    await page.waitForTimeout(200)

    if (claude && processed === 0) await askFree(page)
    let decision = null
    const refs = inspected ? null : await inspectRefs(page)
    if (refs) {
      await page.click('[data-action=inspect]')
      for (const key of refs) {
        await openPanelFor(page, key)
        await page.locator(`[data-ref="${key}"]`).first().click({ force: true })
        await page.waitForTimeout(100)
      }
      await page.waitForSelector('.inspect-banner.hit', { timeout: 3000 })
      const banner = await page.textContent('.inspect-banner')
      check(banner.startsWith('DISCREPANCY'), `inspect found a discrepancy: ${banner}`)
      const unlocked = await page.isEnabled('[data-question=discrepancy]')
      check(unlocked, 'discrepancy question unlocked')
      await page.click('[data-question=discrepancy]')
      await page.waitForFunction(() => [...document.querySelectorAll('.tr-applicant')].length > 1)
      if (shotsDir) {
        await page.waitForTimeout(1500)
        await shot(page, 'booth')
      }
      await page.keyboard.press('i')
      inspected = true
      decision = 'deny'
    } else if (!deepChecked) {
      await page.click('[data-tool=registry]')
      for (const section of await page.locator('.dialog-section').all()) {
        await section.locator('.choice').first().click()
      }
      await page.click('[data-action=dialog-continue]')
      await page.waitForSelector('.typing-test')
      const line = await page.evaluate(() =>
        [...document.querySelectorAll('.tt-char')].map((s) => s.textContent).join(''),
      )
      // One typo that has to be corrected, then the rest of the line
      await page.keyboard.type(`${line.slice(0, 6)}#`, { delay: 4 })
      check(await page.isDisabled('.typing-test .btn.primary'), 'form cannot be filed with a typo')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(line.slice(6), { delay: 4 })
      await page.keyboard.press('Enter')
      await page.waitForSelector('.report-slip')
      check(true, `deep check filed and printed: ${line}`)
      deepChecked = true
    }
    // Decide by the truth, so the game can go on to the final report
    if (!decision) decision = (await admissible(page)) ? 'approve' : 'deny'
    await stamp(page, decision)
    if (decision === 'approve') approved = true
    else denied = true
    processed += 1
  }
  check(inspected, 'one person inspected with a hit')
  check(deepChecked, 'one deep check with a typed line')
  check(approved && denied, 'APPROVE and DENY both used')
  check(processed >= 3, `${processed} people processed`)

  await page.click('[data-action=call-next]')
  await page.click('[data-action=end-shift]')
  await page.waitForSelector('.evening-screen')
  await shot(page, 'evening')
  check(true, 'evening report shown')

  const phase = await page.evaluate(() => JSON.parse(localStorage.getItem('oversight-save')).phase)
  check(phase === 'evening', 'game saved after the shift')

  if (claude) await claudeEvening(page)

  if (full) {
    const days = await page.evaluate(
      () => JSON.parse(localStorage.getItem('oversight-save')).daysTotal,
    )
    let slipDay = null
    for (let day = 2; day <= days; day++) {
      if (day === 3) {
        // Reload at the evening report after day 2 and continue
        await page.reload()
        await page.click('text=Continue')
        await page.waitForSelector('.evening-screen')
        check(true, 'reloaded after day 2 and continued at the evening report')
      }
      await page.click('[data-action=evening-continue]')
      await openBoothWithReviews(page, day)

      if (day === 4) {
        // Mid-shift reload: save from phase 'shift' restarts the day cleanly at the morning bulletin
        await page.reload()
        await page.click('text=Continue')
        await page.waitForSelector('.bulletin-screen')
        check(true, 'reloaded mid-shift on day 4 and continued cleanly at morning bulletin')
        await openBoothWithReviews(page, day)
      }

      // Let one infiltrator through on day 6 so the debrief shows both stopped and missed clues
      const letOneSlip = day === 6
      const { count, slipped } = await playByTruth(page, { letOneSlip })
      if (slipped) slipDay = day
      await page.click('[data-action=end-shift]')
      await page.waitForSelector('.evening-screen')
      check(
        true,
        `day ${day}: ${count} people processed${slipped ? ' (1 infiltrator deliberately admitted for debrief check)' : ''}, evening report shown`,
      )
    }

    await page.click('[data-action=evening-continue]')
    await page.waitForSelector('.end-screen')
    const final = await page.locator('.end-screen.final').count()
    check(final === 1, 'final report reached without dismissal')
    check((await page.locator('.end-grade-stamp').count()) === 1, 'final report shows grade stamp')
    await shot(page, 'end-report')

    // Open full debriefing
    await page.click('[data-action=open-debrief]')
    await page.waitForSelector('.debrief-screen')
    check((await page.locator('.db-stat').count()) >= 6, 'debrief overview shows key metrics')
    await shot(page, 'debrief-overview')

    // Day-by-day timeline: visible AI strategy and highlighted unused/missed evidence
    await page.click('[data-tab=timeline]')
    await page.waitForSelector('.db-strategy-card')
    const day1Strategy = (await page.textContent('.db-strategy-text')) ?? ''
    const day1Notes = (await page.textContent('.db-notes-text')) ?? ''
    check(
      day1Strategy.trim().length > 10,
      `day 1 AI strategy visible: ${day1Strategy.slice(0, 60)}...`,
    )
    check(day1Notes.trim().length > 5, 'day 1 AI notes for future self visible')

    if (slipDay) {
      await page.click(`.db-day-btn[data-day="${slipDay}"]`)
      await page.click('.db-filter-btns [data-filter=missed]')
      await page.waitForSelector('.db-ev-row.ev-missed')
      check(true, `day ${slipDay} highlights missed/unused evidence prominently`)
      await shot(page, 'debrief-timeline')
      // Expand the missed infiltrator's papers & visuals drawer and verify documents render
      const missedCard = page.locator('.db-app-card.result-got_through').first()
      await missedCard.locator('.db-visuals-toggle').click()
      await page.waitForSelector('.db-visuals')
      check(true, 'visual comparison and documents drawer opens in debrief')
    } else {
      await shot(page, 'debrief-timeline')
    }

    // Regulars tab
    await page.click('[data-tab=regulars]')
    const regularsCount = await page.locator('.db-char-card').count()
    check(regularsCount >= 1, `regulars tab shows ${regularsCount} recurring character arc(s)`)
    await shot(page, 'debrief-regulars')

    // AI log tab
    await page.click('[data-tab=ailog]')
    check(
      (await page.locator('.db-journal-entry').count()) >= days,
      'AI log tab shows the offline adversary journal for every day',
    )

    // Export as JSON and inspect the downloaded file
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action=export-debrief]'),
    ])
    const downloadPath = await download.path()
    check(Boolean(downloadPath), `debrief JSON downloaded (${download.suggestedFilename()})`)
    const rawExport = fs.readFileSync(downloadPath, 'utf8')
    const parsed = JSON.parse(rawExport)
    check(parsed.game === 'OVERSIGHT', 'exported JSON has game header')
    check(parsed.meta.daysPlayed === days, `exported JSON contains all ${days} days`)
    check(
      parsed.days.every(
        (d) => typeof d.strategySummary === 'string' && d.strategySummary.length > 0,
      ),
      'exported JSON contains AI strategy for every day',
    )
    check(
      !slipDay || parsed.metrics.infiltratorsThrough === 1,
      'exported JSON records infiltrators through accurately',
    )
    check(!rawExport.includes('sk-ant-'), 'exported JSON never includes an API key')

    // Back to title clears the completed save
    await page.click('[data-action=to-title]')
    await page.waitForSelector('.title-screen')
    const afterClear = await page.evaluate(() => localStorage.getItem('oversight-save'))
    check(afterClear === null, 'Back to title clears the finished save')
  }

  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`)
  await browser.close()
}

// ---------- Claude mode against the scripted stand-in ----------

async function setupClaude(page) {
  await page.click('[data-mode=claude]')
  check(await page.isVisible('[data-field=api-key]'), 'Claude mode shows the key field')
  await page.click('text=Report for duty')
  check(
    (await page.textContent('.key-status')).includes('Enter your API key'),
    'starting without a key asks for one',
  )
  await page.fill('[data-field=api-key]', 'sk-ant-invalid-key')
  await page.click('[data-action=check-key]')
  await page.waitForSelector('.key-status.error')
  check(true, `a wrong key is rejected: ${await page.textContent('.key-status')}`)
  await page.fill('[data-field=api-key]', MOCK_KEY)
  await page.click('[data-model=claude-sonnet-5-5]')
  await page.click('[data-action=check-key]')
  await page.waitForSelector('.key-status.ok')
  check(true, `the key check passes: ${await page.textContent('.key-status')}`)
  check(!(await page.isVisible('.key-warning')), 'no storage warning while not remembered')
  await page.check('[data-field=remember-key]')
  check(await page.isVisible('.key-warning'), 'remembering the key shows the warning')
  await page.uncheck('[data-field=remember-key]')
  await shot(page, 'setup-claude')
}

async function checkClaudeSave(page) {
  const info = await page.evaluate((item) => {
    const raw = localStorage.getItem('oversight-save')
    const save = JSON.parse(raw)
    return {
      source: save.days[0].plan.source,
      model: save.settings.model,
      memory: save.adversaryMemory && save.adversaryMemory.kind,
      turns: save.adversaryMemory ? save.adversaryMemory.messages.length : 0,
      keyInSave: raw.includes('sk-ant-'),
      session: sessionStorage.getItem(item),
      local: localStorage.getItem(item),
    }
  }, KEY_ITEM)
  check(info.source === 'claude', 'day 1 was planned by Claude')
  check(info.model === 'claude-sonnet-5-5', 'the chosen model is saved')
  check(info.memory === 'claude' && info.turns === 2, 'the planning conversation is saved')
  check(!info.keyInSave, 'the API key is not in the save game')
  check(info.session === MOCK_KEY && info.local === null, 'the key is kept for this tab only')
}

// A free question goes to Claude and streams into the bubble
async function askFree(page) {
  await page.waitForFunction(() => !document.querySelector('.free-input').disabled, null, {
    timeout: 8000,
  })
  check(true, 'free questions are enabled in Claude mode')
  const before = await page.locator('.tr-applicant').count()
  const question = 'Who will you visit here?'
  await page.fill('.free-input', question)
  await page.press('.free-input', 'Enter')
  const seen = new Set()
  for (let i = 0; i < 150; i++) {
    const text = (await page.textContent('.speech-text')) ?? ''
    if (text.includes(question)) seen.add(text)
    if ((await page.locator('.tr-applicant').count()) > before && text.endsWith('papers.')) break
    await page.waitForTimeout(15)
  }
  const final = await page.textContent('.speech-text')
  check(final.includes(question), `Claude answered the free question: ${final}`)
  check(seen.size >= 2, `the answer streamed into the bubble (${seen.size} steps)`)
  const streams = await page.evaluate(
    () => window.__oversightMock.calls().filter((c) => c.stream).length,
  )
  check(streams >= 1, 'the answer came from a streamed request')
  await shot(page, 'booth-claude')
}

async function claudeEvening(page) {
  await page.waitForFunction(
    () =>
      window.__oversightMock.calls().filter((c) => c.path === '/v1/messages' && !c.stream).length >=
      2,
    null,
    { timeout: 5000 },
  )
  check(true, 'the plan for day 2 was requested during the evening report')
  await page.click('[data-action=evening-continue]')
  await page.waitForSelector('[data-action=start-shift]:enabled', { timeout: 5000 })
  check(true, 'day 2 bulletin ready with the prefetched plan')

  // A new tab without the key: the game asks for it before the next plan
  await page.evaluate((item) => {
    sessionStorage.removeItem(item)
    localStorage.removeItem(item)
  }, KEY_ITEM)
  await page.reload()
  await page.click('text=Continue')
  await page.waitForSelector('.bulletin-screen')
  const started = await page.isEnabled('[data-action=start-shift]')
  if (started) {
    // Day 2 was already prepared before the reload, the key is needed for day 3
    await page.click('[data-action=start-shift]')
    await page.waitForSelector('.booth')
    await playByTruth(page)
    await page.click('[data-action=end-shift]')
    await page.waitForSelector('.evening-screen')
    await page.click('[data-action=evening-continue]')
  }
  await page.waitForSelector('.key-dialog')
  check(true, 'a missing key opens the key dialog')
  await page.fill('.key-dialog [data-field=api-key]', 'sk-ant-invalid-key')
  await page.click('[data-action=key-retry]')
  await page.waitForSelector('.key-dialog .key-status.error')
  check(await page.isVisible('.key-dialog'), 'a wrong key keeps the dialog open')
  await shot(page, 'key-dialog')
  await page.fill('.key-dialog [data-field=api-key]', MOCK_KEY)
  await page.click('[data-action=key-retry]')
  await page.waitForSelector('[data-action=start-shift]:enabled', { timeout: 5000 })
  check(!(await page.locator('.key-dialog').count()), 'a working key closes the dialog')
  const source = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('oversight-save'))
    return save.days[save.days.length - 1].plan.source
  })
  check(source === 'claude', 'the day after the new key was planned by Claude')
}

async function admissible(page) {
  return page.evaluate(() => window.__oversightTest.current().admissible)
}

// Processes the whole line with correct decisions (optionally admitting one infiltrator),
// then closes the booth
async function playByTruth(page, options = {}) {
  let count = 0
  let slipped = false
  for (let i = 0; i < 40; i++) {
    if (await page.locator('[data-action=end-shift]').count()) return { count, slipped }
    const label = await page.textContent('[data-action=call-next]')
    if (label.includes('Close')) {
      await page.click('[data-action=call-next]')
      return { count, slipped }
    }
    await page.click('[data-action=call-next]')
    await page.waitForSelector('.doc[data-applicant]')
    const isAdmissible = await admissible(page)
    let decision = isAdmissible ? 'approve' : 'deny'
    if (options.letOneSlip && !isAdmissible && !slipped) {
      decision = 'approve'
      slipped = true
    }
    await stamp(page, decision)
    count += 1
  }
  return { count, slipped }
}

async function main() {
  const { build, preview } = await import('vite')
  await build({ logLevel: 'warn' })
  const server = await preview({ logLevel: 'warn', preview: { port: 4173 } })
  const url = server.resolvedUrls.local[0]
  try {
    await run(url)
    console.log('smoke test passed')
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
