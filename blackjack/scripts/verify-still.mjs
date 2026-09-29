#!/usr/bin/env node
/*
 * Is the camera locked on the page a player actually sees?
 *
 * WHY THIS EXISTS. verify-generated.mjs proves the room is still inside the clip
 * FILES, and it was right: every background patch of every generated clip aligns
 * back to its own frame 0 at exactly zero pixels. The page was moving the whole
 * room anyway, because the drift was never in the footage - it was a CSS keyframe
 * on the element that WRAPS the plate stack and all six video elements:
 *
 *     .breath { animation: breathe 5600ms ease-in-out infinite }
 *     @keyframes breathe { 28% { translate3d(-5px, 4px, 0) scale(1.016) } ... }
 *
 * A 6px pan and a 1.008-to-1.016 zoom on that wrapper moves the bar, the bottles,
 * the lamp, the felt and the dealer together, forever. It was deliberate from when
 * she was a still photograph - the comment called it "a held camera rather than a
 * photograph" - and it survived the move to generated video, where it is both
 * redundant and the only thing shaking.
 *
 * No file-level check could have caught that, and that is the whole lesson: this
 * assertion has to be made on the composited page, in a real browser, over real
 * wall-clock time.
 *
 * WHAT IT MEASURES. Screenshots of the live table spanning longer than a full
 * cycle of any looping animation, then for each background patch the integer
 * (dx, dy) that best aligns it back to the first screenshot. Alignment is the
 * right question rather than mean pixel difference: a one-pixel pan of a dark flat
 * wall barely moves the mean, and a one-pixel pan of the whole room is the most
 * visible defect there is. It is also indifferent to the things that are SUPPOSED
 * to move over the background - drifting dust, the lamp's flame - because none of
 * them shift a bottle highlight or the bar's carved lip.
 *
 * The patches sit out near the edges on purpose: a zoom about the frame centre
 * displaces the corners most, so the corners are where to look for one.
 *
 *   node scripts/verify-still.mjs [url]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const DIR = '/tmp/dc-still'
const W = 1280
const H = 720

/*
 * Background only, all of it clear of her, chosen for contrast as much as for
 * position: the search needs an edge to lock onto, so these are bottle
 * highlights, the lamp's brass body, the bar's carved lip and the card shoe.
 */
const PATCHES = [
  { name: 'bottles far left', x: 150, y: 96, w: 150, h: 200 },
  { name: 'bottles far right', x: 980, y: 96, w: 170, h: 200 },
  { name: 'lamp body', x: 40, y: 196, w: 120, h: 130 },
  { name: 'bar lip left', x: 60, y: 336, w: 210, h: 80 },
  { name: 'bar lip right', x: 1000, y: 330, w: 210, h: 80 },
  { name: 'card shoe', x: 1060, y: 420, w: 160, h: 120 },
]

/*
 * Search radius. Wide enough that a failure reports an honest magnitude instead of
 * saturating: the defect this was written for displaced the corners by 11px, and a
 * radius of 4 would have reported it as 4.
 */
const R = 12
/** Every patch comes back to exactly here, or the camera is not locked. */
const ALLOW = 0

const rgb = (path) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: W * H * 3 * 4,
  })

const luma = (buf) => {
  const out = new Float32Array(W * H)
  for (let p = 0, i = 0; p < W * H; p++, i += 3) {
    out[p] = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
  }
  return out
}

function ssd(a, b, box, dx, dy) {
  let sum = 0
  let n = 0
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const d = a[y * W + x] - b[(y + dy) * W + (x + dx)]
      sum += d * d
      n++
    }
  }
  return sum / n
}

function bestShift(a, b, box) {
  let best = { dx: 0, dy: 0, err: Infinity }
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const err = ssd(a, b, box, dx, dy)
      if (err < best.err) best = { dx, dy, err }
    }
  }
  return best
}

const meanDiff = (a, b, box) => {
  let sum = 0
  let n = 0
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      sum += Math.abs(a[y * W + x] - b[y * W + x])
      n++
    }
  }
  return sum / n
}

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
await skipIntro(page, url)
await page.waitForSelector('.title-page', { timeout: 20000 })
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').first().getByRole('button').click()
await page.waitForSelector('.table-page', { timeout: 20000 })

/*
 * The grain and dust canvas repaints the whole screen every frame, so it comes out
 * the way verify-motion.mjs takes it out: it is not what is under test, and its
 * noise would be the largest term in the mean column below. The alignment search
 * does not care either way - grain has no structure for the search to lock onto.
 */
await page.addStyleTag({ content: '.atmosphere { display: none !important; }' })

// Let the idle bed get going, so this measures a running table, not a first paint.
await page.waitForTimeout(3000)

/*
 * Nine samples over eight seconds. The animation this was written to catch had a
 * 5.6s period, and anything shorter than a full cycle risks sampling two points
 * at the same phase and seeing nothing.
 */
const files = []
for (let i = 0; i < 9; i++) {
  const path = join(DIR, `${String(i).padStart(2, '0')}.png`)
  await page.screenshot({ path })
  files.push(path)
  if (i < 8) await page.waitForTimeout(1000)
}
await browser.close()

const frames = files.map((f) => luma(rgb(f)))
console.log(`the table, ${W}x${H}, ${frames.length} samples over 8 seconds of play\n`)

const fail = []
for (const p of PATCHES) {
  let worst = 0
  let drift = 0
  const found = []
  for (let i = 1; i < frames.length; i++) {
    const { dx, dy } = bestShift(frames[0], frames[i], p)
    found.push(`${dx},${dy}`)
    worst = Math.max(worst, Math.abs(dx), Math.abs(dy))
    drift = Math.max(drift, meanDiff(frames[0], frames[i], p))
  }
  const held = worst <= ALLOW
  console.log(
    `  ${p.name.padEnd(18)} worst shift ${String(worst).padStart(2)}px  mean ${drift.toFixed(2).padStart(5)}` +
      `   ${held ? 'locked' : 'DRIFTS'}   ${found.join(' ')}`,
  )
  if (!held) fail.push(`${p.name} moves by up to ${worst}px`)
}

rmSync(DIR, { recursive: true, force: true })
console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}): the camera is not locked`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: the room holds still - every background patch aligns to the first sample at 0px')
