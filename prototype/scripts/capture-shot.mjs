/**
 * Frame-accurate check of the gunshot beat.
 *
 * A screen recording of a human play session samples too coarsely to tell a
 * weak effect from a missing one, so this drives the game headlessly, keeps
 * firing until a live round actually goes off, and records video of the page
 * so the muzzle flash and recoil can be inspected frame by frame.
 */
import { mkdir, rm, readdir, rename } from 'node:fs/promises'
import { chromium } from 'playwright'

const URL = process.env.GAME_URL ?? 'http://localhost:5173/'
const OUT = 'shot-capture'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
})
const page = await context.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })

await page.getByRole('button', { name: '坐 下' }).click()
await page.getByRole('button', { name: '5 ×' }).click()
await page.getByRole('button', { name: '装弹并旋转' }).click()
await sleep(2200)

const caption = page.locator('.caption')
let fired = false

for (let attempt = 0; attempt < 8 && !fired; attempt++) {
  const selfShot = page.getByRole('button', { name: '对准自己' })
  const aimAt = page.getByRole('button', { name: '对准他' })

  const btn = (await selfShot.count()) ? selfShot : aimAt
  try {
    await btn.first().waitFor({ state: 'visible', timeout: 12000 })
  } catch {
    break
  }
  await btn.first().click()

  // Watch the caption until the round either survives the chamber or ends.
  for (let i = 0; i < 80; i++) {
    await sleep(100)
    const text = (await caption.textContent().catch(() => '')) ?? ''
    if (text.includes('枪响')) {
      fired = true
      console.log(`live round on attempt ${attempt + 1}: ${text}`)
      break
    }
    if (text.includes('空的')) break
  }
  await sleep(1200)
}

// Let the flash, recoil and smoke finish playing before cutting the tape.
await sleep(3000)
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
