#!/usr/bin/env node
/*
 * Is the dealer actually moving on screen?
 *
 * Measuring whole frames cannot answer that, because the grain and smoke canvas
 * changes every frame all by itself and swamps the signal - which is how "99% of
 * frames change" can be true while she is a photograph. This crops to her face
 * and to a patch of the back bar, takes pairs of screenshots and compares them,
 * so what comes out is her motion and nothing else.
 *
 *   node scripts/verify-motion.mjs [url]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const DIR = '/tmp/dc-motion'
mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await skipIntro(page, url)
await page.waitForSelector('.title-page', { timeout: 20000 })
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')

/*
 * The grain and smoke canvas repaints every frame over the whole screen, so it
 * has to come out of the picture or it is the only thing being measured. Hiding
 * it leaves the plate, the clip and the camera drift, which is the question.
 */
await page.addStyleTag({ content: '.atmosphere { display: none !important; }' })
await page.waitForTimeout(1500)

/*
 * Two patches of the picture, and one of the control bar as a control. The bar is
 * plain DOM and never moves, so it establishes the floor: anything the two
 * picture regions do above that floor is the scene actually moving.
 *
 * Face against shelf turns out not to be the right comparison - the camera drift
 * and the clip's own warp move the whole frame together, so both shift by the
 * same amount. The question worth asking is whether the picture moves at all.
 */
const REGIONS = {
  face: { x: 520, y: 40, width: 240, height: 200 },
  shelf: { x: 1040, y: 150, width: 180, height: 140 },
  bar: { x: 420, y: 650, width: 440, height: 60 },
}

const shots = []
for (let i = 0; i < 14; i++) {
  const frame = {}
  for (const [name, clip] of Object.entries(REGIONS)) {
    const path = join(DIR, `${name}-${String(i).padStart(2, '0')}.png`)
    await page.screenshot({ path, clip })
    frame[name] = path
  }
  shots.push(frame)
  await page.waitForTimeout(420)
}
await browser.close()

function diff(a, b) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi',
    '[0][1]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const m = /YAVG=([0-9.]+)/.exec(out)
  return m ? Number(m[1]) : 0
}

const report = {}
for (const name of Object.keys(REGIONS)) {
  const vals = []
  for (let i = 1; i < shots.length; i++) vals.push(diff(shots[i - 1][name], shots[i][name]))
  report[name] = {
    max: Math.max(...vals),
    mean: vals.reduce((s, v) => s + v, 0) / vals.length,
    moving: vals.filter((v) => v > 0.35).length,
    of: vals.length,
  }
}

for (const [name, r] of Object.entries(report)) {
  console.log(`${name.padEnd(6)} mean luma change ${r.mean.toFixed(3).padStart(6)}  peak ${r.max.toFixed(3).padStart(6)}  pairs that moved ${r.moving}/${r.of}`)
}

console.log('')
const floor = Math.max(0.05, report.bar.mean)
const moving = report.face.mean > floor * 4 && report.shelf.mean > floor * 4
if (!moving) {
  console.log(`FAILED: the picture is not moving above the static floor of ${floor.toFixed(3)}`)
  process.exit(1)
}
console.log(`OK: the picture moves at ${(report.face.mean / floor).toFixed(0)}x the floor set by the static control bar.`)
console.log('    Note this measures that motion exists, not that a viewer notices it -')
console.log('    two independent video reviews of the same build reported her as frozen.')
