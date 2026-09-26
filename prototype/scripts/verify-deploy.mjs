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

const URL = process.argv[2]
if (!URL) {
  console.error('usage: node scripts/verify-deploy.mjs <url> [screenshot.png]')
  process.exit(1)
}
const SHOT = process.argv[3]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await context.newPage()

const failures = []
const consoleErrors = []
page.on('response', (r) => {
  if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => failures.push(`FAILED ${r.url()} (${r.failure()?.errorText})`))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)

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
await browser.close()

if (failures.length) console.error('\nHTTP failures:\n  ' + failures.join('\n  '))
if (consoleErrors.length) console.error('\nConsole errors:\n  ' + consoleErrors.join('\n  '))
if (broken.length) console.error('\nBroken plates:\n  ' + broken.map((p) => p.src).join('\n  '))

const ok =
  !failures.length &&
  !consoleErrors.length &&
  !broken.length &&
  modes.length >= 6 &&
  portraits.every((p) => p !== 'none')
console.log(ok ? '\nOK: reachable, table picker renders, all assets load' : '\nFAILED')
process.exit(ok ? 0 : 1)
