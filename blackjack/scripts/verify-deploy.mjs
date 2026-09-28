#!/usr/bin/env node
/*
 * Walks a deployed build as a brand new visitor with an empty cache, and fails
 * on anything a real first-time player would hit:
 *
 *   - any HTTP 4xx or 5xx for any asset
 *   - any console error or uncaught exception
 *   - any image that did not decode
 *   - any video that is present but will not actually play
 *
 * The last one matters more than it sounds. A deploy where every asset is
 * present and every status code is 200, but not one frame of video ever moves,
 * is a broken deploy - and looking at stills and status codes cannot find it.
 *
 *   node scripts/verify-deploy.mjs <url>
 */
import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('usage: node scripts/verify-deploy.mjs <url>')
  process.exit(2)
}

const fail = []
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  bypassCSP: false,
})
await context.route('**/*', (route) => route.continue())
const page = await context.newPage()

const bad = []
const cancelled = []

/*
 * Listening starts only once the app's own document is loading. A proxy may put
 * its own page - with its own ads and its own console errors - in front of the
 * build, and none of that is the deploy under test.
 */
function watch() {
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') fail.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => fail.push(`uncaught: ${String(e)}`))
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? ''
    // ERR_ABORTED is the browser reporting a fetch the page itself cancelled -
    // swapping a video's source drops its poster mid-flight. Reported, not fatal.
    if (why.includes('ERR_ABORTED')) {
      cancelled.push(r.url().split('/').pop())
      return
    }
    if (r.resourceType() === 'other') return
    fail.push(`request failed: ${r.url()} (${why})`)
  })
}

console.log(`opening ${url} with an empty cache`)
const res = await page.goto(url, { waitUntil: 'load', timeout: 60000 })
if (!res || !res.ok()) fail.push(`landing page returned ${res ? res.status() : 'nothing'}`)

/*
 * githack puts a one-time "External Content Notice" in front of any HTML page it
 * proxies. That is a real click a real visitor has to make, so the check makes it
 * too rather than pretending it is not there.
 */
const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
if (await notice.count()) {
  console.log('notice:       githack External Content Notice, clicking through')
  watch()
  await notice.first().click()
  await page.waitForLoadState('load', { timeout: 60000 })
} else {
  watch()
  // Listeners went on after the first load, so do one more to see it all.
  await page.reload({ waitUntil: 'load', timeout: 60000 })
}

/* ---------------------------------------------------- the opening actually plays */

await page.waitForSelector('.intro-video, .title-page', { timeout: 30000 })

if (await page.locator('.intro-video').count()) {
  const played = await page.evaluate(async () => {
    const v = document.querySelector('.intro-video')
    if (!v) return { ok: false, why: 'no video element' }
    const t0 = v.currentTime
    await new Promise((r) => setTimeout(r, 2500))
    return {
      ok: v.currentTime > t0 + 0.4,
      from: t0,
      to: v.currentTime,
      w: v.videoWidth,
      h: v.videoHeight,
      src: v.currentSrc.split('/').pop(),
      duration: v.duration,
    }
  })
  if (!played.ok) fail.push(`the opening does not play (${played.why ?? `${played.from} -> ${played.to}`})`)
  else console.log(`opening:      ${played.src}, ${played.w}x${played.h}, ${played.duration.toFixed(2)}s, advanced to +${played.to.toFixed(2)}s`)

  await page.locator('.chrome.skip').click()
} else {
  console.log('opening:      already seen, went straight to the title')
}

/* --------------------------------------------------------------- the front pages */

await page.waitForSelector('.title-page', { timeout: 20000 })
const title = await page.locator('.title-block h1').innerText()
const tagline = await page.locator('.tagline').innerText()
const disclaimer = await page.locator('.disclaimer').first().innerText()
console.log(`title card:   ${title}`)
console.log(`tagline:      ${tagline}`)
console.log(`disclaimer:   ${disclaimer}`)
if (!/no real money/i.test(disclaimer) && !/dinero real/i.test(disclaimer)) {
  fail.push('the entertainment-only notice is missing from the title page')
}

await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page', { timeout: 20000 })
const tables = await page.locator('.table-card h3').allInnerTexts()
console.log(`table picker: ${tables.join(' | ')}`)
if (tables.length !== 3) fail.push(`expected 3 tables, found ${tables.length}`)

/* ------------------------------------------------------------------- the table */

await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page', { timeout: 20000 })

// Every plate has to have decoded, not merely returned 200.
const plates = await page.evaluate(() =>
  [...document.images].map((i) => ({ src: i.currentSrc.split('/').pop(), ok: i.complete && i.naturalWidth > 0 })),
)
const broken = plates.filter((p) => !p.ok)
console.log(`plates:       ${plates.length - broken.length} decoded, ${broken.length} broken`)
if (broken.length) fail.push(`plates did not decode: ${broken.map((b) => b.src).join(', ')}`)

// And the idle loop has to be moving, not just present.
const idle = await page.evaluate(async () => {
  const v = document.querySelector('video.clip')
  if (!v) return { ok: false, why: 'no clip element on the table' }
  const t0 = v.currentTime
  await new Promise((r) => setTimeout(r, 1800))
  return { ok: v.currentTime !== t0, from: t0, to: v.currentTime, src: v.currentSrc.split('/').pop(), w: v.videoWidth }
})
if (!idle.ok) fail.push(`the table clip does not play (${idle.why ?? `${idle.from} -> ${idle.to}`})`)
else console.log(`table clip:   ${idle.src}, ${idle.w}px, running`)

/* ------------------------------------------------- a hand, played to settlement */

await page.locator('[data-act="deal"]').click()
await page.waitForTimeout(1400)
const dealt = await page.locator('.card').count()
console.log(`cards dealt:  ${dealt}`)
if (dealt < 4) fail.push(`only ${dealt} cards reached the felt`)

for (let i = 0; i < 10; i++) {
  if (await page.locator('.banner').count()) break
  const hit = page.locator('[data-act="hit"]')
  const stand = page.locator('[data-act="stand"]')
  const mine = Number(await page.locator('.hand.player .hand-label b').first().innerText())
  if ((await hit.count()) && mine < 15) await hit.click()
  else if (await stand.count()) await stand.click()
  await page.waitForTimeout(650)
}
if (!(await page.locator('.banner').count())) fail.push('the hand never settled')
else console.log(`settled:      ${await page.locator('.banner strong').innerText()}`)

await page.locator('[data-act="next"]').click()
await page.waitForTimeout(700)
if (!(await page.locator('[data-act="deal"]').count())) fail.push('could not get back to a fresh bet')
else console.log('next hand:    the table came back round')

console.log(`cancelled:    ${cancelled.length ? cancelled.join(', ') : 'none'}`)
console.log(`bad responses: ${bad.length}`)
for (const b of bad) fail.push(`http: ${b}`)

await browser.close()

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: reachable, the film rolls, the table deals, a hand settles, every asset loads')
