/**
 * Checks a built, deployed copy of the game the way a first-time visitor
 * meets it: no login, no warm cache, nothing but the URL.
 *
 * Serving from a sub-path is the part that breaks silently - an asset
 * referenced from the domain root still returns GitHub's 404 page with a 200
 * in some setups, so this fails on any non-OK response rather than trusting
 * the page to look right.
 */
import { chromium } from 'playwright'

const SITE = process.argv[2]
if (!SITE) {
  console.error('usage: node scripts/verify-deploy.mjs <url> [screenshot.png]')
  process.exit(1)
}
const SHOT = process.argv[3]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await context.newPage()

// The githack mirror wraps the page in an interstitial that loads its own
// analytics and ads, and those fail in a headless browser. Only what the
// deployment itself serves is this script's business.
const origin = new URL(SITE).origin
const ours = (u) => u.startsWith(origin)

const failures = []
const consoleErrors = []
page.on('response', (r) => {
  if (r.status() >= 400 && ours(r.url())) failures.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => {
  if (ours(r.url())) failures.push(`FAILED ${r.url()} (${r.failure()?.errorText})`)
})
page.on('console', (m) => {
  if (m.type() === 'error' && ours(m.location()?.url ?? origin)) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 })

// The githack mirror puts an interstitial in front of anything it serves as
// HTML. It is one click and then the real page loads in place.
const interstitial = page.getByRole('button', { name: 'Open the page' })
if (await interstitial.count()) {
  await interstitial.click()
  await page.waitForLoadState('networkidle')
}

/** Reads a <video> the way a viewer would: is there picture, and is it moving? */
const rolling = async (selector) => {
  const el = page.locator(selector)
  await el.waitFor({ timeout: 30000 })
  const before = await el.evaluate((v) => v.currentTime)
  await page.waitForTimeout(1200)
  return el.evaluate(
    (v, t0) => ({
      file: v.currentSrc.split('/').pop(),
      width: v.videoWidth,
      advanced: +(v.currentTime - t0).toFixed(2),
    }),
    before,
  )
}

// A first-time visitor lands on the opening cinematic, not the title card.
await page.waitForTimeout(1500)
const opening = await rolling('.intro__film')
console.log(`opening:      ${opening.file}, ${opening.width}px, +${opening.advanced}s`)

await page.getByRole('button', { name: 'SKIP' }).click()
await page.waitForTimeout(1200)

const title = await page.locator('.title__name').textContent()
console.log(`title card:   ${title}`)
console.log(`disclaimer:   ${await page.locator('.title__note').textContent()}`)

await page.getByRole('button', { name: 'TAKE A SEAT' }).click()
await page.waitForTimeout(1800)

const modes = await page.locator('.menu__col .pick__name').allTextContents()
console.log(`table picker: ${modes.join(' | ')}`)

// The portraits are the assets most likely to break under a base path,
// because they are the only ones set from CSS rather than an <img> tag.
const portraits = await page.locator('.pick__face').evaluateAll((els) =>
  els.map((e) => getComputedStyle(e).backgroundImage),
)
console.log(`portraits:    ${portraits.join(' ')}`)

// Every plate must have decoded, not merely been requested.
const plates = await page.locator('.scene__plate').evaluateAll((els) =>
  els.map((e) => ({ src: e.getAttribute('src'), w: e.naturalWidth })),
)
const broken = plates.filter((p) => !p.w)
console.log(`plates:       ${plates.length} loaded, ${broken.length} broken`)

if (SHOT) await page.screenshot({ path: SHOT })

// The clips are the presentation now, so a deployment that serves everything
// else and no video is still broken. Loading the cylinder is the shortest
// route to one, and it is the same encode the rest of the table plays.
await page.getByRole('button', { name: 'SIT DOWN' }).click()
await page.waitForTimeout(1400)
await page.getByRole('button', { name: 'LOAD AND SPIN' }).click()
const chamber = await rolling('.scene__clip')
console.log(`table clip:   ${chamber.file}, ${chamber.width}px, +${chamber.advanced}s`)

await browser.close()

if (failures.length) console.error('\nHTTP failures:\n  ' + failures.join('\n  '))
if (consoleErrors.length) console.error('\nConsole errors:\n  ' + consoleErrors.join('\n  '))
if (broken.length) console.error('\nBroken plates:\n  ' + broken.map((p) => p.src).join('\n  '))

const playing = (v) => v.width > 0 && v.advanced > 0.2

const ok =
  !failures.length &&
  !consoleErrors.length &&
  !broken.length &&
  modes.length >= 6 &&
  portraits.every((p) => p !== 'none') &&
  playing(opening) &&
  playing(chamber)
console.log(ok ? '\nOK: reachable, film rolls, table picker renders, all assets load' : '\nFAILED')
process.exit(ok ? 0 : 1)
