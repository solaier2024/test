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
async function sweep(from, to, steps = 36, pause = 26) {
  for (let i = 0; i <= steps; i++) {
    const k = i / steps
    await page.mouse.move(from + (to - from) * k, height * 0.5)
    await sleep(pause)
  }
}

const caption = () => page.locator('.caption').textContent().catch(() => '')

// Accessible names include each button's subtitle, and "对准自己" carries the
// word 继续 in its own hint text, so these must be matched precisely.
const continueBtn = () => page.getByRole('button', { name: '继续', exact: true })
const callBtn = () => page.getByRole('button', { name: /^跟\s/ })

/** Waits out a shot cinematic, reporting whether the chamber was live. */
async function awaitChamber() {
  for (let i = 0; i < 90; i++) {
    await sleep(100)
    const text = (await caption()) ?? ''
    if (text.includes('枪响')) return 'live'
    if (text.includes('空的')) return 'blank'
  }
  return 'timeout'
}

/** Names of every button currently on screen, for diagnosing a stalled script. */
async function visibleButtons() {
  return page
    .getByRole('button')
    .evaluateAll((els) =>
      els.filter((e) => e.offsetParent !== null).map((e) => e.textContent?.trim().slice(0, 24)),
    )
}

async function clickIfPresent(name) {
  const btn = page.getByRole('button', { name })
  if (!(await btn.count())) return false
  if (!(await btn.first().isVisible().catch(() => false))) return false
  await btn.first().click()
  return true
}

/**
 * Plays one round to its conclusion. After an opening self-shot and a raise it
 * always fires across the table, which hands the turn back to the opponent and
 * gets him to draw on the camera rather than ending the round on our own shot.
 */
async function playRound(live, { raiseOn = 2 } = {}) {
  const loadBtn = page.getByRole('button', { name: `${live} ×` })
  try {
    await loadBtn.waitFor({ state: 'visible', timeout: 15000 })
  } catch {
    console.error('load panel never appeared; on screen:', await visibleButtons())
    console.error('caption:', await caption())
    throw new Error('cannot start round')
  }
  await loadBtn.click()
  await sleep(1400)
  await page.getByRole('button', { name: '装弹并旋转' }).click()
  await sleep(3200)

  for (let turn = 1; turn <= 14; turn++) {
    // Settle any bet the opponent has pushed before taking a chamber.
    if (await callBtn().count()) {
      await callBtn().first().click()
      await sleep(2400)
      continue
    }

    const self = page.getByRole('button', { name: '对准自己' })
    const across = page.getByRole('button', { name: '对准他' })
    const mine = (await self.count()) && (await self.first().isVisible().catch(() => false))
    if (!mine) {
      // The opponent is acting; give his cinematic room to play.
      const outcome = await awaitChamber()
      if (outcome === 'timeout') break
      await sleep(2600)
      if (await continueBtn().count()) break
      continue
    }

    await sleep(2200)

    if (turn === raiseOn) {
      const slider = page.locator('.raisebox input[type=range]')
      if (await slider.count()) {
        await slider.focus()
        for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
        await sleep(900)
        if (await clickIfPresent('推出')) {
          await sleep(3000)
          continue
        }
      }
    }

    await (turn === 1 ? self : across).first().click()
    const outcome = await awaitChamber()
    if (outcome === 'timeout') break
    await sleep(2800)
    if (await continueBtn().count()) break
  }

  await sleep(2600)
}

await sleep(2600)
await page.getByRole('button', { name: '坐 下' }).click()
await sleep(2600)

await sweep(width * 0.28, width * 0.74)
await sweep(width * 0.74, width * 0.42)
await sleep(1400)

// A single live round makes the opening self-shot survivable and stretches the
// round out, so the odds readout climbs on camera and the opponent is forced to
// draw once the cylinder can no longer miss.
await playRound(1, { raiseOn: 2 })

if (await continueBtn().count()) {
  await continueBtn().click()
  await sleep(2200)
  await playRound(4, { raiseOn: 99 })
}

await sleep(3000)
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
