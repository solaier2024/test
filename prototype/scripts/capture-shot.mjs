/**
 * Frame-accurate check of the gunshot beat and the end-of-hand panel.
 *
 * A screen recording of a human play session samples too coarsely to tell a
 * weak effect from a missing one - a 340ms flash lands on one frame or none -
 * so this drives the game headlessly, loads the cylinder full so a live round
 * is certain, and records video of the page for frame-by-frame inspection.
 */
import { mkdir, rm, readdir, rename } from 'node:fs/promises'
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const URL = process.env.GAME_URL ?? 'http://localhost:5173/'
const OUT = process.env.OUT_DIR ?? 'shot-capture'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
})
await skipIntro(context)
const page = await context.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })

const btn = (name) => page.getByRole('button', { name })
const shown = async (name) =>
  (await btn(name).count()) ? btn(name).first().isVisible().catch(() => false) : false

await btn('TAKE A SEAT').click()
await sleep(700)
await btn('SIT DOWN').click()
await sleep(900)

// Five live rounds in six chambers: the first shot is almost certainly live.
await page.locator('.chamberbtn').nth(4).click()
await sleep(400)
await btn('LOAD AND SPIN').click()
await sleep(3400)

let fired = false
for (let attempt = 0; attempt < 8 && !fired; attempt++) {
  if (await shown('CALL ')) {
    await btn('CALL ').first().click()
    await sleep(2400)
    continue
  }
  if (!(await shown('ACROSS THE TABLE'))) {
    await sleep(400)
    continue
  }
  await btn('ACROSS THE TABLE').first().click()

  for (let i = 0; i < 90; i++) {
    await sleep(100)
    if (await shown('NEXT HAND')) {
      fired = true
      break
    }
  }
  await sleep(1200)
}

// Hold on the settled hand so the result panel is on tape too.
await sleep(3500)
await page.screenshot({ path: `${OUT}/hand-settled.png` })
await sleep(1500)
await context.close()
await browser.close()

const files = await readdir(OUT)
const webm = files.find((f) => f.endsWith('.webm'))
if (webm) await rename(`${OUT}/${webm}`, `${OUT}/session.webm`)

if (!fired) {
  console.error('no live round fired; rerun the capture')
  process.exit(1)
}
console.log(`recorded ${OUT}/session.webm`)
