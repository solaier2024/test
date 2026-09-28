/**
 * Records a real-time walkthrough of a full session.
 *
 * Desktop screen capture time-compresses a long session, which crushes the
 * sub-second beats this game is built on: a 340ms muzzle flash collapses to a
 * single frame and a 900ms dissolve looks like a hard cut. Recording the page
 * directly keeps the footage at true rate, so the pacing on tape matches what
 * a player actually sees.
 */
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { chromium } from 'playwright'

const URL = process.env.GAME_URL ?? 'http://localhost:5173/'
const OUT = process.env.OUT_DIR ?? 'demo-capture'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const width = 1600
const height = 900

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width, height },
  recordVideo: { dir: OUT, size: { width, height } },
})
const page = await context.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })

/** Slides the pointer across the plate so the parallax drift is on camera. */
async function sweep(from, to, steps = 32, pause = 26) {
  for (let i = 0; i <= steps; i++) {
    const k = i / steps
    await page.mouse.move(from + (to - from) * k, height * 0.5)
    await sleep(pause)
  }
}

const btn = (name) => page.getByRole('button', { name })

async function shown(name) {
  const b = btn(name).first()
  if (!(await btn(name).count())) return false
  return b.isVisible().catch(() => false)
}

async function click(name, settle = 900) {
  if (!(await shown(name))) return false
  await btn(name).first().click()
  await sleep(settle)
  return true
}

/** Current odds the next chamber is live, read straight off the HUD. */
async function odds() {
  const el = page.locator('.readout__oddsValue')
  if (!(await el.count())) return 0
  const text = (await el.first().textContent()) ?? '0%'
  return parseInt(text, 10) / 100
}

/**
 * Plays one hand by reading the screen rather than counting turns, so it works
 * across every table variant regardless of which actions a mode offers.
 */
async function playHand({ raiseOnce = true, passOnce = true } = {}) {
  let raised = !raiseOnce
  let passed = !passOnce

  for (let step = 0; step < 220; step++) {
    if (await shown('NEXT HAND')) return 'hand-over'
    if (await shown('DEAL AGAIN')) return 'match-over'

    if (await shown('CALL ')) {
      await sleep(1600)
      await click('CALL ', 2400)
      continue
    }

    if (!(await shown('AT YOURSELF'))) {
      // The opponent is acting; give the cinematic room to play out.
      await sleep(300)
      continue
    }

    // Beat before acting, so the read on their face lands on camera.
    await sleep(1800)
    const p = await odds()

    if (!raised) {
      const slider = page.locator('.raisebox input[type=range]')
      if ((await slider.count()) && (await slider.first().isEnabled())) {
        await slider.first().focus()
        for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
        await sleep(800)
        if (await click('PUSH ', 3000)) {
          raised = true
          continue
        }
      }
      raised = true
    }

    if (!passed && p >= 0.6 && (await shown('PASS THE IRON'))) {
      passed = true
      await click('PASS THE IRON', 3000)
      continue
    }

    // Ride out a chamber that is probably empty to hold the turn; otherwise
    // hand it across, which is also what puts the opponent on camera firing.
    await click(p < 0.5 ? 'AT YOURSELF' : 'ACROSS THE TABLE', 3400)
  }
  return 'stalled'
}

/** Walks the picker to a given table and sits down. */
async function sitAt(mode, opponent) {
  await click(mode, 900)
  await click(opponent, 1500)
  await click('SIT DOWN', 1800)
}

async function dealAndPlay(live, opts) {
  if (live !== null) {
    const chamber = page.locator('.chamberbtn').nth(live)
    if (await chamber.count()) {
      await chamber.click()
      await sleep(900)
    }
  }
  await click('LOAD AND SPIN', 3400)
  return playHand(opts)
}

// ---------- the opening ----------
// The cinematic is the first thing a player meets, so it is the first thing
// on tape, and it runs its middle in Spanish to put both caption tracks in
// shot. It hands over to the title card on its own; nothing here skips it.
await sleep(3400)
await click('Español (MX)', 3200)
await click('English', 1200)
await page.waitForSelector('.title', { timeout: 30000 })

// ---------- title ----------
await sleep(2600)
await click('TAKE A SEAT', 1800)

// ---------- the picker ----------
await click('QUICK DRAW', 1600)
await click('WIDOWMAKER', 1600)
await click('EL PASE', 1600)
await click('La Viuda', 2200)
await click('STRAIGHT SIX', 1600)
await click('Amos Calloway', 2000)

// ---------- a hand of the house game ----------
await sitAt('STRAIGHT SIX', 'Amos Calloway')
await sweep(width * 0.3, width * 0.72)
await sleep(800)

// Two live rounds keeps the opening self-shot survivable and stretches the
// hand out, so the odds readout climbs on camera before anyone has to draw.
let result = await dealAndPlay(1, { raiseOnce: true, passOnce: false })
await sleep(2800)

if (result === 'hand-over') {
  await click('NEXT HAND', 2400)
  result = await dealAndPlay(3, { raiseOnce: false, passOnce: false })
  await sleep(2600)
}

// ---------- change tables: cantina rules, second opponent ----------
await click('CHANGE TABLE', 2000)
await sitAt('EL PASE', 'La Viuda')
await sweep(width * 0.68, width * 0.34)
await sleep(800)
await dealAndPlay(null, { raiseOnce: true, passOnce: true })

await sleep(3200)
await context.close()
await browser.close()

const files = await readdir(OUT)
const webm = files.find((f) => f.endsWith('.webm'))
if (!webm) {
  console.error('no video produced')
  process.exit(1)
}
await rename(`${OUT}/${webm}`, `${OUT}/demo.webm`)
console.log(`recorded ${OUT}/demo.webm`)
