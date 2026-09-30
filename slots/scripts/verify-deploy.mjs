#!/usr/bin/env node
/*
 * Checks a built, deployed copy of the table the way a first-time visitor
 * meets it: no login, no warm cache, nothing but the URL.
 *
 *   node scripts/verify-deploy.mjs <url> [screenshot.jpg]
 *
 * IS IT EVEN THE BUILD YOU JUST PUSHED? That is the first thing this asks,
 * because every other line below it is worthless if the answer is no, and the
 * answer is not visible. Vite content-hashes the assets, so a stale one cannot
 * be served under a fresh name - but index.html has a fixed name, it names the
 * hashed bundle, and a CDN holding an old copy of it keeps an entire old
 * release on the air. The page looks perfect. It is last week's.
 *
 * So the build signs itself (see vite.config.ts) and this reads the signature
 * back off the deployed page in both places it is written: the <meta> in the
 * HTML, and __BUILD__ inside the bundle that ran. Set BUILD_SHA to the commit
 * that should be live, or let it default to local HEAD.
 *
 * The page is fetched with the cache disabled, so what is being tested is the
 * deployment rather than this machine's memory of it.
 *
 * Serving from a sub-path is the part that breaks silently. Every runtime
 * asset URL on this table goes through import.meta.env.BASE_URL (see
 * src/art.ts), which is exactly one edit away from being wrong, and a missing
 * asset does not always announce itself - some static hosts answer a bad path
 * with a 200 and an HTML error page. So this fails on any non-OK response
 * rather than trusting the page to look right.
 *
 * It also insists on two things a screenshot cannot tell you:
 *
 *   THE FILM ROLLS. A deployment that serves every plate and no video is
 *     still broken, and it looks completely fine in a still. The check reads
 *     currentTime twice and requires it to have advanced.
 *
 *   THE BANDS ARE IN THE GLASS. The reels are DOM showing through a hole in
 *     the picture, and the hole is positioned in fractions of the plate. If
 *     the plate fails to load, or loads at the wrong size, the bands end up
 *     somewhere on the bar. Comparing the two rectangles is the only way to
 *     catch that without a human looking at it.
 */
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'

const SITE = process.argv[2]
if (!SITE) {
  console.error('usage: node scripts/verify-deploy.mjs <url> [screenshot.jpg]')
  process.exit(1)
}
const SHOT = process.argv[3]

/** The commit that should be live. Empty means "report it, do not judge it". */
const WANT = (
  process.env.BUILD_SHA ??
  (() => {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  })()
).trim()

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Headless Chromium asks for reduced motion, and this table honours that by
  // skipping the opening entirely - which would skip most of what is being
  // checked here.
  reducedMotion: 'no-preference',
  // A fresh context already has an empty cache; this is aimed past it, at the
  // CDNs in between, which are the ones capable of serving a stale index.html
  // long after the deployment that replaced it.
  extraHTTPHeaders: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
})
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

const interstitial = page.getByRole('button', { name: 'Open the page' })
if (await interstitial.count()) {
  await interstitial.click()
  await page.waitForLoadState('networkidle')
}

/*
 * Before anything else: whose build is this? The two stamps are read from the
 * live DOM - the meta out of the served HTML, the dataset written by the
 * bundle that executed - so a page assembled from a cached half answers
 * differently in the two halves.
 */
const built = await page.evaluate(() => ({
  html: document.querySelector('meta[name="build"]')?.getAttribute('content') ?? '',
  js: document.documentElement.dataset.build ?? '',
  when: document.documentElement.dataset.built ?? '',
}))
const htmlSha = built.html.split(' ')[0]
console.log(`build (html): ${htmlSha || '(unstamped)'}`)
console.log(`build (js):   ${built.js || '(unstamped)'} ${built.when}`)

const stamped = Boolean(htmlSha && built.js)
const agree = htmlSha === built.js
const isWanted = !WANT || built.js === WANT
if (WANT) console.log(`expected:     ${WANT}${isWanted && agree ? ' - match' : ' - MISMATCH'}`)
if (stamped && !agree) {
  console.error(
    '\nThe HTML and the bundle were built from different commits. A cache is ' +
      'serving part of an old release.',
  )
}
if (WANT && stamped && agree && !isWanted) {
  console.error(
    `\nThe live page is ${built.js.slice(0, 7)}, not ${WANT.slice(0, 7)}. Either the ` +
      'deployment has not finished, or a cache is still serving the old build.',
  )
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

// A first-time visitor lands on the opening, not the machine picker.
await page.waitForTimeout(1500)
const opening = await rolling('.intro-video')
console.log(`opening:      ${opening.file}, ${opening.width}px, +${opening.advanced}s`)

await page.locator('button.skip').click()
await page.waitForTimeout(1000)

console.log(`title:        ${await page.locator('.pick h1').textContent()}`)
console.log(`disclaimer:   ${await page.locator('.pick .disclaimer').textContent()}`)

const machines = await page.locator('.machine-name').allTextContents()
console.log(`machines:     ${machines.join(' | ')}`)

await page.locator('.machines button').first().click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(1400)

// Every plate must have decoded, not merely been requested.
const plates = await page.locator('.plate').evaluateAll((els) =>
  els.map((e) => ({ src: e.getAttribute('src'), w: e.naturalWidth })),
)
const broken = plates.filter((p) => !p.w)
console.log(`plates:       ${plates.length} loaded, ${broken.length} broken`)

/*
 * The bands against the hole they show through. Both rectangles are read from
 * the live page rather than from src/machine.ts, because the failure this is
 * looking for is precisely the case where the page disagrees with the source.
 */
const glass = await page.evaluate(() => {
  const win = document.querySelector('.window')?.getBoundingClientRect()
  const reels = document.querySelector('.reels')?.getBoundingClientRect()
  const plate = document.querySelector('.plate.arriving')?.getBoundingClientRect()
  if (!win || !reels || !plate) return null
  return {
    inside:
      reels.left >= win.left - 1 && reels.right <= win.right + 1 &&
      reels.top >= win.top - 1 && reels.bottom <= win.bottom + 1,
    // Where the hole sits on the picture, which is the number src/machine.ts
    // declares and scripts/verify-window.mjs measures on the plates.
    left: +((win.left - plate.left) / plate.width).toFixed(4),
    top: +((win.top - plate.top) / plate.height).toFixed(4),
    width: +(win.width / plate.width).toFixed(4),
  }
})
console.log(`glass:        left ${glass?.left} top ${glass?.top} width ${glass?.width}, bands inside: ${glass?.inside}`)

const cells = await page.locator('.reels .cell').count()
console.log(`bands:        ${cells} cells rendered`)

if (SHOT) await page.screenshot({ path: SHOT, quality: 88, type: 'jpeg' })

/*
 * The idle loop is what gets timed, not the pull. A pull swaps the source
 * twice inside a second and a quarter - pull, release, back to idle - so
 * currentTime is measured against a different file than it started on and
 * reads as a clip that has barely advanced. The loop the table rests on is
 * the honest thing to time, and it exercises the same decode path.
 */
const idle = await rolling('video.clip')
console.log(`table clip:   ${idle.file}, ${idle.width}px, +${idle.advanced}s`)

// And the lever separately: it only has to prove the swap happens at all.
await page.locator('button.lever').click()
await page.waitForTimeout(250)
const pulled = await page.locator('video.clip').getAttribute('src')
console.log(`lever:        ${pulled?.split('/').pop()}`)

await browser.close()

if (failures.length) console.error('\nHTTP failures:\n  ' + failures.join('\n  '))
if (consoleErrors.length) console.error('\nConsole errors:\n  ' + consoleErrors.join('\n  '))
if (broken.length) console.error('\nBroken plates:\n  ' + broken.map((p) => p.src).join('\n  '))

const playing = (v) => v.width > 0 && v.advanced > 0.2

const ok =
  stamped &&
  agree &&
  isWanted &&
  !failures.length &&
  !consoleErrors.length &&
  !broken.length &&
  machines.length === 3 &&
  cells > 0 &&
  glass?.inside === true &&
  playing(opening) &&
  playing(idle) &&
  /pull\./.test(pulled ?? '')
console.log(
  ok
    ? `\nOK: ${built.js.slice(0, 7)} is live, film rolls, bands sit in the glass, every asset loads`
    : '\nFAILED',
)
process.exit(ok ? 0 : 1)
