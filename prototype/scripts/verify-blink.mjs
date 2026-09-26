/**
 * Proves the idle blink both fires on its own and looks like a blink.
 *
 * Sampling the plate for brightness does not work: film grain, lamp flicker
 * and the camera breathe all move every frame, and they swamp a 120ms event.
 * So this checks the two halves of the claim separately - a MutationObserver
 * records that the blink layer really is switched on and off on an irregular
 * schedule, and forcing it on and off writes out matched crops of the eyes and
 * of a control region for eyeballing side by side.
 */
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173/'
const OUT = process.argv[3] ?? '/tmp/blink'

/** Eye region and a control region, as fractions of the viewport. */
const REGIONS = {
  calloway: { eyes: [0.56, 0.11, 0.16, 0.09], control: [0.3, 0.55, 0.16, 0.09] },
  viuda: { eyes: [0.47, 0.155, 0.16, 0.085], control: [0.28, 0.55, 0.16, 0.09] },
}

const W = 1280
const H = 720

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const who = process.argv[2] ?? 'calloway'
if (who === 'viuda') {
  await page.getByRole('button', { name: 'TAKE A SEAT' }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'La Viuda' }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'SIT DOWN' }).click()
  await page.waitForTimeout(1500)
}

// --- part one: does it fire by itself, and on an irregular schedule? ---
await page.evaluate(() => {
  const target = document.querySelector('.scene__plate--blink')
  window.__blinks = []
  if (!target) return
  new MutationObserver(() => {
    window.__blinks.push({ t: performance.now(), on: target.classList.contains('is-active') })
  }).observe(target, { attributes: true, attributeFilter: ['class'] })
})

await page.waitForTimeout(30000)
const events = await page.evaluate(() => window.__blinks ?? [])
const closes = events.filter((e) => e.on)
const gaps = closes.slice(1).map((e, i) => Math.round(e.t - closes[i].t))
const holds = closes
  .map((e) => events.find((o) => !o.on && o.t > e.t))
  .filter(Boolean)
  .map((o, i) => Math.round(o.t - closes[i].t))

console.log(`${who}: ${closes.length} blinks in 30s`)
console.log(`  gaps between blinks (ms): ${gaps.join(', ')}`)
console.log(`  eyes held shut (ms):      ${holds.join(', ')}`)

// --- part two: when it is on, what actually changed? ---
const rect = ([x, y, w, h]) => ({
  x: Math.round(x * W),
  y: Math.round(y * H),
  width: Math.round(w * W),
  height: Math.round(h * H),
})
const regions = REGIONS[who]

// The atmosphere canvas repaints grain every frame, so it is parked for the
// comparison; everything under it is what the blink is supposed to affect.
await page.evaluate(() => {
  document.querySelectorAll('.atmosphere').forEach((el) => (el.style.visibility = 'hidden'))
  document.querySelectorAll('.scene__plate, .scene__lamp').forEach((el) => {
    el.style.animation = 'none'
  })
})
await page.waitForTimeout(400)

const force = (on) =>
  page.evaluate((flag) => {
    const el = document.querySelector('.scene__plate--blink')
    el?.classList.toggle('is-active', flag)
  }, on)

/*
 * The crops are written out rather than compared here: these are PNG buffers,
 * and comparing compressed bytes says nothing about the pixels. ffmpeg decodes
 * them and reports the real per-pixel difference.
 */
for (const [state, on] of [
  ['open', false],
  ['shut', true],
]) {
  await force(on)
  await page.waitForTimeout(350)
  for (const [name, box] of Object.entries(regions)) {
    writeFileSync(`${OUT}-${who}-${name}-${state}.png`, await page.screenshot({ clip: rect(box) }))
  }
}
console.log(`  crops written to ${OUT}-${who}-*.png`)

await browser.close()
process.exit(closes.length > 0 ? 0 : 1)
