// Browser smoke test for the game interface. Run with `npm run smoke`.
// Builds the game, serves it with `vite preview`, plays day 1 of an Easy game against the
// offline adversary and fails on any console error.
// Playwright comes preinstalled in the development container: require('playwright').
//
// Options: --shots <dir> saves screenshots of bulletin, booth and evening report there.

const { chromium } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')

const SEED = 7
const args = process.argv.slice(2)
const shotsIndex = args.indexOf('--shots')
const shotsDir = shotsIndex >= 0 ? path.resolve(args[shotsIndex + 1] ?? 'shots') : null

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
  // The person may interrupt the first stamp with last words; then stamp again
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

async function run(url) {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: shotsDir ? 2 : 1,
  })
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${url}?test&seed=${SEED}`)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.click('text=New game')
  await page.click('[data-difficulty=easy]')
  await page.click('[data-mode=offline]')
  await page.click('text=Report for duty')
  await page.waitForSelector('.bulletin-screen')
  await shot(page, 'bulletin')
  check(true, 'offline game started, bulletin shown')

  await page.click('[data-action=start-shift]')
  await page.waitForSelector('.booth')
  check(true, 'bulletin dismissed, booth open')

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
        await page.waitForTimeout(400)
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
    if (!decision) decision = approved ? 'deny' : 'approve'
    if (approved && denied) decision = 'approve'
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
  check(errors.length === 0, `no console errors ${errors.length ? JSON.stringify(errors) : ''}`)
  await browser.close()
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
