/**
 * Walks the game at a phone viewport, screenshotting every step and checking
 * at each one that the layout still holds. Portrait is easy to break without
 * noticing, because all of these screens are fine at desktop width.
 *
 *   node scripts/shots-mobile.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.argv[3] ?? '/tmp/mobile'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext(devices['iPhone 14'])
const page = await context.newPage()

const problems = []
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

/**
 * A control the thumb cannot reach is not a control. Checked on every screen
 * rather than once at the end, because each one lays out differently.
 */
async function audit(step) {
  const found = await page.evaluate(() => {
    const h = window.innerHeight
    const w = window.innerWidth
    const bad = []
    for (const el of document.querySelectorAll('button, input')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const tag = `${el.tagName.toLowerCase()}.${el.className || '-'}`
      if (r.bottom > h + 1 || r.top < -1 || r.right > w + 1 || r.left < -1) {
        bad.push(`${tag} outside the viewport (${Math.round(r.top)}..${Math.round(r.bottom)})`)
      } else if (r.height < 44) {
        bad.push(`${tag} only ${Math.round(r.height)}px tall`)
      }
    }
    if (document.documentElement.scrollWidth > w) bad.push('the page scrolls sideways')

    /*
     * Anything painting in the last few pixels of the screen is either a
     * pinned control bar or copy that has slipped underneath one and is
     * being sliced off. Checking the controls alone misses this entirely:
     * the buttons were fine, the rules text behind them was not.
     */
    for (const x of [w * 0.15, w * 0.5, w * 0.85]) {
      const el = document.elementFromPoint(x, h - 3)
      if (!el || el.closest('.menu__go, .actions, .intro, .hud__top, .langtoggle')) continue
      // Only a node that holds the text itself; an ancestor would report the
      // whole screen's copy and drown the check in noise.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim()
      if (own) bad.push(`"${own.slice(0, 44)}" is sliced by the bottom of the screen`)
    }
    return bad
  })
  found.forEach((f) => problems.push(`${step}: ${f}`))
}

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await audit(name)
  console.log(name)
}

const tap = async (name, settle = 900) => {
  await page.getByRole('button', { name, exact: true }).tap()
  await page.waitForTimeout(settle)
}

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })

// The githack mirror puts an interstitial in front of anything it serves as
// HTML, so running this against the live preview needs one click first.
const interstitial = page.getByRole('button', { name: 'Open the page' })
if (await interstitial.count()) {
  await interstitial.tap()
  await page.waitForLoadState('networkidle')
  problems.length = 0
}

await page.waitForTimeout(1400)
await shot('01-intro')

await tap('SKIP', 800)
await shot('02-title')

await tap('TAKE A SEAT', 900)
await shot('03-picker')

// Prove the picker responds to a finger, not only that it renders.
await page.getByText('WIDOWMAKER', { exact: true }).tap()
await page.getByText('La Viuda', { exact: true }).tap()
await page.waitForTimeout(400)
await shot('04-picker-widowmaker')

await tap('SIT DOWN', 1400)
await shot('05-load')

await tap('LOAD AND SPIN', 1100)
await shot('06-chamber-clip')
await page.waitForTimeout(3400)
await shot('07-betting')

const self = page.getByRole('button', { name: /AT YOURSELF/ })
if (await self.count()) {
  await self.tap()
  await page.waitForTimeout(3000)
  await shot('08-after-shot')
}

// Keep going until a hand settles, so the result panel gets audited too.
for (let i = 0; i < 12; i++) {
  if (await page.locator('.result').count()) break
  const next = page.getByRole('button', { name: /AT YOURSELF|ACROSS THE TABLE|CALL /i }).first()
  if (!(await next.count())) {
    await page.waitForTimeout(1200)
    continue
  }
  await next.tap()
  await page.waitForTimeout(3000)
}
if (await page.locator('.result').count()) await shot('09-result')

await browser.close()

if (problems.length) console.error('\n' + problems.join('\n'))
console.log(problems.length ? '\nFAILED' : '\nOK: portrait layout holds, every control is reachable')
process.exit(problems.length ? 1 : 0)
