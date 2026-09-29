#!/usr/bin/env node
/*
 * Does the picture actually run smoothly while you play a hand?
 *
 * The complaint this exists for was "stuttery, laggy, transitions look
 * unnatural", and none of the other checks could see it: verify-motion.mjs proves
 * something moves, verify-timing.mjs proves the judgement window does not drift,
 * and neither of them looks at whether the frames arrive evenly.
 *
 * Three things get measured, all of them from inside the page while a real hand
 * is played:
 *
 *   dropped frames   the decoder's own count, via getVideoPlaybackQuality(). A
 *                    video that is being asked for more than the machine can
 *                    decode reports it here and nowhere else.
 *   long rAF gaps    a frame callback that arrives more than 50ms late is a
 *                    main-thread stall the player sees as a hitch. The grain
 *                    layer redrawing a full-viewport radial gradient at device
 *                    pixel ratio 2 used to cause these.
 *   blind frames     how long the dealer layer shows nothing at all. Swapping the
 *                    src on one video element tore the picture down on every
 *                    state change, and the gap was this.
 *
 *   node scripts/verify-smoothness.mjs [url]
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'

/*
 * Budgets. These are not aspirational: they are what the fixed build measures.
 */
const BUDGET = {
  dropRatio: 0.04,
  longGaps: 6,
  worstGapMs: 220,
  blindMs: 120,
}

/*
 * How many times the whole hand-playing pass is run, and why more than once.
 *
 * Three of the four numbers below are main-thread measurements and they are
 * steady: the page holds 60fps rAF with a 17ms worst gap even with the CPU
 * throttled six times over, which is well past any phone. The drop ratio is
 * different in kind. It is the decoder's own count, and the decoder lives in
 * another process competing with everything else on the host - so it measures the
 * machine at least as much as the page. On this four-core box at load average 3
 * the same unchanged build measured 2.41%, 3.31%, 4.02% and 5.07% against a 4%
 * limit, which is a gate that fails for reasons the code cannot fix.
 *
 * So the drop ratio is asserted on the MEDIAN of the passes. That is robust to one
 * contended sample while still moving if decoding genuinely gets more expensive -
 * which a best-of-N would not be. Every sample is printed, because the spread is
 * the interesting part and hiding it would be how this goes wrong again.
 *
 * The other three are asserted on the WORST pass. They are cheap to satisfy when
 * the code is right and a single genuine stall is worth failing for.
 */
const PASSES = 3

async function measure() {
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
await skipIntro(page, url)
await page.waitForSelector('.title-page', { timeout: 30000 })
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')
// The clips have to be in the cache before pacing means anything; a cold fetch is
// a network measurement, not a smoothness one.
await page.waitForTimeout(6000)

await page.evaluate(() => {
  const gaps = []
  const blind = []
  let last = performance.now()
  let blindFrom = 0
  let stop = false

  const tick = (now) => {
    gaps.push(now - last)
    last = now

    /*
     * "Blind" means every video in the dealer stack is transparent or has no
     * frame yet, so what the player is looking at is whatever still is behind
     * them - or nothing. One element being swapped to a new src is the case this
     * catches.
     */
    const vids = [...document.querySelectorAll('.scene video')]
    const showing = vids.some((v) => Number(getComputedStyle(v).opacity) > 0.5 && v.readyState >= 2)
    if (!showing && !blindFrom) blindFrom = now
    if (showing && blindFrom) {
      blind.push(now - blindFrom)
      blindFrom = 0
    }
    if (!stop) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  window.__pace = {
    finish() {
      stop = true
      if (blindFrom) blind.push(performance.now() - blindFrom)
      const vids = [...document.querySelectorAll('.scene video')]
      let total = 0
      let dropped = 0
      for (const v of vids) {
        const q = v.getVideoPlaybackQuality?.()
        if (!q) continue
        total += q.totalVideoFrames
        dropped += q.droppedVideoFrames
      }
      return { gaps, blind, total, dropped }
    },
  }
})

// A whole hand, the way it is actually played: bet, deal, hit, stand, next, with
// a lean in the middle of it, because that is the one input that moves the camera.
const click = async (act, waitMs = 900) => {
  const b = page.locator(`[data-act="${act}"]`)
  if (await b.count() && await b.first().isEnabled()) {
    await b.first().click()
    await page.waitForTimeout(waitMs)
    return true
  }
  return false
}

for (let hand = 0; hand < 3; hand++) {
  await click('deal', 1600)
  await page.locator('[data-act="lean"]').click()
  await page.waitForTimeout(500)
  await click('hit', 900)
  for (let i = 0; i < 6 && (await page.locator('[data-act="stand"]').count()); i++) {
    if (!(await click('stand', 1100))) break
  }
  await click('next', 1200)
}

const { gaps, blind, total, dropped } = await page.evaluate(() => window.__pace.finish())
await browser.close()

return {
  seconds: gaps.length / 60,
  frames: gaps.length,
  total,
  dropped,
  dropRatio: total ? dropped / total : 0,
  longGaps: gaps.filter((g) => g > 50).length,
  worstGap: Math.max(0, ...gaps),
  worstBlind: Math.max(0, ...blind),
}
}

const runs = []
for (let i = 0; i < PASSES; i++) runs.push(await measure())

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const dropRatio = median(runs.map((r) => r.dropRatio))
const longGaps = Math.max(...runs.map((r) => r.longGaps))
const worstGap = Math.max(...runs.map((r) => r.worstGap))
const worstBlind = Math.max(...runs.map((r) => r.worstBlind))

console.log(`${PASSES} passes of three hands each\n`)
for (const [i, r] of runs.entries()) {
  console.log(
    `  pass ${i + 1}  ${r.seconds.toFixed(0).padStart(2)}s  ` +
      `decoded ${String(r.total).padStart(4)}  dropped ${String(r.dropped).padStart(3)} ` +
      `(${(r.dropRatio * 100).toFixed(2).padStart(5)}%)  gaps>50ms ${r.longGaps}  ` +
      `worst gap ${r.worstGap.toFixed(0)}ms  blind ${r.worstBlind.toFixed(0)}ms`,
  )
}

console.log('')
console.log(`  dropped by the decoder   ${(dropRatio * 100).toFixed(2)}%  median of ${PASSES}  (limit ${BUDGET.dropRatio * 100}%)`)
console.log(`  frame gaps over 50ms     ${longGaps}  worst pass  (limit ${BUDGET.longGaps})`)
console.log(`  worst frame gap          ${worstGap.toFixed(0)}ms  (limit ${BUDGET.worstGapMs}ms)`)
console.log(`  longest blind stretch    ${worstBlind.toFixed(0)}ms  (limit ${BUDGET.blindMs}ms)`)

const fail = []
if (dropRatio > BUDGET.dropRatio) fail.push(`the decoder dropped ${(dropRatio * 100).toFixed(2)}% of frames`)
if (longGaps > BUDGET.longGaps) fail.push(`${longGaps} main-thread stalls over 50ms`)
if (worstGap > BUDGET.worstGapMs) fail.push(`worst main-thread stall was ${worstGap.toFixed(0)}ms`)
if (worstBlind > BUDGET.blindMs) fail.push(`the dealer layer went blank for ${worstBlind.toFixed(0)}ms`)

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: the picture keeps up, and never goes blank between clips')
