/**
 * Checks that the game is actually making the sounds it thinks it is.
 *
 * Reading the source tells you a cue was requested; it does not tell you
 * anything reached the speakers. This taps the graph where it meets the
 * destination and measures real signal, so a cue that is wired up but silent
 * - the wrong context, a gain left at zero, a release that never fires -
 * fails here rather than in somebody's ears.
 *
 *   node scripts/verify-audio.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const BASE = process.argv[2] ?? 'http://localhost:5173/'

/*
 * Whatever the page connects to the destination also gets connected to an
 * analyser. Patching the graph from outside means the game needs no test
 * hook, and the thing being measured is the real output.
 */
const PROBE = () => {
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !window.__probe) {
      const probe = this.context.createAnalyser()
      probe.fftSize = 2048
      connect.call(this, probe)
      window.__probe = probe
    }
    return connect.call(this, dest, ...rest)
  }

  /*
   * The same peak-hold read, but callable from inside the page so a
   * measurement can be armed before the thing it is measuring is triggered.
   * A one-shot is over in a tenth of a second; asking for it from the test
   * process after the click has already missed it.
   */
  window.__readPeak = async (ms) => {
    const probe = window.__probe
    if (!probe) return -200
    const buf = new Float32Array(probe.fftSize)
    let loudest = 0
    const until = performance.now() + ms
    while (performance.now() < until) {
      probe.getFloatTimeDomainData(buf)
      let sum = 0
      for (const s of buf) sum += s * s
      loudest = Math.max(loudest, Math.sqrt(sum / buf.length))
      await new Promise((r) => requestAnimationFrame(r))
    }
    return loudest > 0 ? 20 * Math.log10(loudest) : -200
  }
}

/** Loudest RMS over a window, in dBFS. Peak-hold, because music has rests. */
const READ = async (ms) => {
  const probe = window.__probe
  if (!probe) return -200
  const buf = new Float32Array(probe.fftSize)
  let loudest = 0
  const until = performance.now() + ms
  while (performance.now() < until) {
    probe.getFloatTimeDomainData(buf)
    let sum = 0
    for (const s of buf) sum += s * s
    loudest = Math.max(loudest, Math.sqrt(sum / buf.length))
    await new Promise((r) => setTimeout(r, 25))
  }
  return loudest > 0 ? 20 * Math.log10(loudest) : -200
}

const problems = []
const results = []
function expect(what, ok, detail) {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what.padEnd(42)} ${detail}`)
  if (!ok) problems.push(`${what}: ${detail}`)
}

async function open(url, { seenIntro = false } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  if (seenIntro) await skipIntro(context)
  await context.addInitScript(PROBE)
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })

  /*
   * The githack mirror puts an interstitial in front of anything it serves as
   * HTML. Note that dismissing it also satisfies the autoplay block, because
   * the real page loads in place on the same origin: behind the mirror the
   * control reads `is-on` from the start rather than `is-blocked`. That is
   * what a player meets there, so the checks below accept either.
   */
  const interstitial = page.getByRole('button', { name: 'Open the page' })
  if (await interstitial.count()) {
    await interstitial.click()
    await page.waitForLoadState('networkidle')
    problems.length = 0
  }
  return { browser, page }
}

const soundClass = (page) =>
  page.locator('.soundtoggle').first().getAttribute('class').then((c) => c ?? '')

/** Presses the control until sound is on, whatever state it started in. */
async function soundOn(page) {
  for (let i = 0; i < 3; i++) {
    if (/is-on/.test(await soundClass(page))) return true
    await page.locator('.soundtoggle').first().click()
    await page.waitForTimeout(600)
  }
  return /is-on/.test(await soundClass(page))
}

/* ---- a first visit: the opening ---------------------------------------- */

const first = await open(BASE)
const page = first.page
await page.waitForSelector('.intro__film')
await page.waitForTimeout(500)

const started = await soundClass(page)
console.log(`\nsound control starts: ${/is-blocked/.test(started) ? 'blocked' : started.trim()}`)

// The control is also the way out of the browser's autoplay block, so
// pressing it is exactly what a player with the volume up would do.
expect('the sound control turns audio on', await soundOn(page), await soundClass(page))

const opening = await page.evaluate(READ, 2400)
expect('the opening has a score', opening > -45, `${opening.toFixed(1)} dBFS`)

/* ---- skipping stops it ------------------------------------------------- */

await page.getByRole('button', { name: 'SKIP' }).click()
await page.waitForTimeout(1500)
const afterSkip = await page.evaluate(READ, 2000)
expect(
  'skipping quietens the opening score',
  afterSkip < opening - 3,
  `${afterSkip.toFixed(1)} dBFS, opening was ${opening.toFixed(1)}`,
)
expect('the title card still has music', afterSkip > -62, `${afterSkip.toFixed(1)} dBFS`)

/* ---- the table plays harder -------------------------------------------- */

await page.getByRole('button', { name: 'TAKE A SEAT' }).click()
await page.waitForTimeout(1100)
await page.getByRole('button', { name: 'SIT DOWN' }).click()
await page.waitForTimeout(2400)

// An empty cylinder is the bottom of the arrangement's range. Measuring it
// is the only way to know the build has anywhere to build from: a bed that
// is already near the top when nothing is loaded cannot get tenser later,
// which is exactly what it used to do.
const calm = await page.evaluate(READ, 2600)

// Five live rounds in six puts the odds readout near the top of its range,
// which is what the arrangement is gated on.
await page.locator('.chamberbtn').nth(4).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'LOAD AND SPIN' }).click()
await page.waitForTimeout(4200)

const odds = (await page.locator('.readout__oddsValue').textContent()) ?? '?'
const table = await page.evaluate(READ, 2800)
expect(
  'the table plays harder than the title',
  table > afterSkip + 2,
  `${table.toFixed(1)} dBFS at ${odds} live, title was ${afterSkip.toFixed(1)}`,
)
expect(
  'and far harder than the empty table',
  table > calm + 7,
  `${table.toFixed(1)} dBFS at ${odds} live, empty was ${calm.toFixed(1)}`,
)

/* ---- the gun is louder than the band ----------------------------------- */

// The whole point of ducking the music bus is that a shot is the loudest
// thing in the room. Fired over the densest bed the game has, so if it wins
// here it wins everywhere.
const before = await page.evaluate(READ, 900)
const shot = await page.evaluate(async (ms) => {
  const button = [...document.querySelectorAll('.btn--risk')][0]
  const read = window.__readPeak(ms)
  button?.click()
  return read
}, 1400)
expect(
  'the gunshot beats the bed under it',
  shot > before + 4,
  `${shot.toFixed(1)} dBFS against a ${before.toFixed(1)} bed`,
)
await page.waitForTimeout(3200)

/* ---- mute really mutes -------------------------------------------------- */

await page.locator('.soundtoggle').first().click()
await page.waitForTimeout(900)
expect('the control reads muted', /is-off/.test(await soundClass(page)), await soundClass(page))
const muted = await page.evaluate(READ, 1600)
expect('mute silences everything', muted < -70, `${muted.toFixed(1)} dBFS`)

await page.locator('.soundtoggle').first().click()
await page.waitForTimeout(1400)
const back = await page.evaluate(READ, 2400)
expect('unmuting brings it back', back > -50, `${back.toFixed(1)} dBFS`)

await first.browser.close()

/* ---- a return visit: the opening can be replayed, with sound ------------ */

const second = await open(BASE, { seenIntro: true })
await soundOn(second.page)
await second.page.getByRole('button', { name: 'WATCH THE OPENING' }).click()
await second.page.waitForTimeout(1600)
const replay = await second.page.evaluate(READ, 2400)
expect('replaying the opening scores it again', replay > -45, `${replay.toFixed(1)} dBFS`)

// And it has to stop again when it hands back to the title.
await second.page.getByRole('button', { name: 'SKIP' }).click()
await second.page.waitForTimeout(1500)
const settled = await second.page.evaluate(READ, 2000)
expect(
  'and stops again on the way out',
  settled < replay - 3,
  `${settled.toFixed(1)} dBFS, was ${replay.toFixed(1)}`,
)
await second.browser.close()

if (problems.length) console.error('\n' + problems.join('\n'))
console.log(
  problems.length
    ? '\nFAILED'
    : `\nOK: ${results.length} checks, every cue measured at the destination`,
)
process.exit(problems.length ? 1 : 0)
