#!/usr/bin/env node
/*
 * Does the reel window hold still, in every picture the table shows.
 *
 *   node scripts/verify-lock.mjs
 *
 * This is the check the table lives or dies by, and it is not the one I
 * reached for first. The obvious statistic is translation: register a frame
 * against the approved plate and report how far the casting wandered.
 * scripts/measure-drift.mjs does exactly that, and on the crowd clips it
 * still reports up to 2px after the build has taken the drift out.
 *
 * Two px sounds like a failure and is the wrong question. The bands are DOM
 * behind a HOLE, so what has to stay put is the hole - the brass rim and the
 * pane inside it. scripts/lib/lock.mjs pins that rectangle by compositing it
 * back from one reference plate, feathered over 22px, so the region is not
 * interpreted by anything. Casting that wanders a pixel further out is under
 * the feather and the vignette and cannot leak a band.
 *
 * So the question this asks is: IS the rim the reference plate's rim? No
 * registration, no tolerance argument about pixels of motion - a direct
 * comparison of the one region that matters against the one picture it is
 * supposed to be, on every frame of every clip AND on every plate.
 *
 * The plates are half the point, and leaving them out is the bug this script
 * was written by finding. Only the footage was pinned. But Scene.tsx
 * cross-fades between plates, and every crowd clip ends by holding its
 * reaction plate - so the last frames of a clip, and the whole time a
 * reaction sat on screen, the brass came from a separately painted image that
 * had never been through the lock. Per frame, `lean` tracked the reference to
 * within 0.9 for forty-two frames, then jumped 4.94 in a single frame and
 * stayed there: the boundary between pinned footage and unpinned hold, landing
 * on exactly the moment the room finishes leaning in.
 *
 * Mean absolute RGB difference over the rim, measured for the thresholds:
 *
 *                                                  core   whole rim
 *   hand-made plates, unpinned (the disease)   2.45-4.08   4.17-6.58
 *   plates pinned, through the shipped JPEG         1.67   2.74-2.95
 *   clip frames pinned, through shipped VP9    0.53-1.57   1.23-2.74
 *
 * The middle row is a codec floor, not a residual: 1.67 is what the SAME
 * pixels cost through JPEG, and it comes out identical to three decimal
 * places on all four plates, which is the evidence that the core really is
 * copied rather than merely close. The whole-rim column is legitimately
 * higher because the outer 22px is a feather, and a feather is supposed to
 * blend in the picture underneath.
 *
 * This deliberately does NOT try to check which plate a clip was locked to.
 * Every approved plate shows the same machine, so their rims are
 * interchangeable and no threshold can separate them. That job belongs to
 * scripts/verify-identity.mjs, which compares whole frames, where the crowd
 * is the difference.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { RIM, readRGB } from './lib/lock.mjs'
import { H, W } from './lib/register.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Must match FEATHER in lib/lock.mjs: outside this the pixels are copied. */
const FEATHER = 22
const CORE = { x0: RIM.x0 + FEATHER, x1: RIM.x1 - FEATHER, y0: RIM.y0 + FEATHER, y1: RIM.y1 - FEATHER }

/*
 * Set from the table above: above the codec floor, below the tightest
 * unpinned reading. Neither of these has to be delicate, which is the
 * property you want in a gate - it fails for the reason it is named after and
 * not for the weather.
 */
const CORE_MAX = 2.2
const RIM_MAX = 3.5

const manifest = JSON.parse(readFileSync(join(ROOT, 'clipsrc', 'generated.json'), 'utf8'))
/** The opening is not laid over the DOM, so it has no window to keep still. */
const clips = Object.keys(manifest.clips).filter((n) => !n.startsWith('intro'))

/** Everything Scene.tsx can cross-fade to. Kept in step with SHOWN in build-clips.mjs. */
const plates = ['machine_rest', 'machine_lean', 'machine_roar', 'machine_sigh', 'machine_breath']

/** Mean absolute RGB difference over a rectangle. */
function diff(a, b, r) {
  let sum = 0
  let n = 0
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = (y * W + x) * 3
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      n += 3
    }
  }
  return sum / n
}

/** Every frame of a video as raw RGB at working size, in one ffmpeg call. */
function frames(file) {
  const stage = mkdtempSync(join(tmpdir(), 'lock-'))
  const raw = join(stage, 'f.raw')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  const buf = readFileSync(raw)
  rmSync(stage, { recursive: true, force: true })
  const bytes = W * H * 3
  if (!Number.isInteger(buf.length / bytes)) throw new Error(`${file}: ${buf.length} bytes is not whole frames`)
  const out = []
  for (let i = 0; i < buf.length / bytes; i++) out.push(buf.subarray(i * bytes, (i + 1) * bytes))
  return out
}

const failures = []
const row = (what, n, core, rim, jitter) => {
  const bad = core > CORE_MAX || rim > RIM_MAX
  console.log(
    `${what.padEnd(21)} ${String(n).padStart(6)} ${core.toFixed(2).padStart(7)} ${rim.toFixed(2).padStart(10)} ` +
      `${jitter === null ? '     -' : jitter.toFixed(2).padStart(6)}${bad ? '   <-- the window moved' : ''}`,
  )
  if (bad) failures.push(`${what}: core ${core.toFixed(2)} / rim ${rim.toFixed(2)} at worst`)
}

/*
 * Clips are compared against the registration reference itself - the raw
 * aligned PNG - because that is literally what pinRim composited in.
 */
const ref = readRGB(join(ROOT, 'clipsrc', 'aligned', 'machine_rest.png'))

console.log(`worst rim difference per subject (core <= ${CORE_MAX}, whole rim <= ${RIM_MAX})\n`)
console.log('subject               frames    core  whole rim  frame-to-frame')

let frameTotal = 0
for (const name of clips) {
  const file = join(ROOT, 'public', 'clips', `${name}.webm`)
  if (!existsSync(file)) {
    failures.push(`${name}: no public/clips/${name}.webm - run npm run clips`)
    continue
  }
  const fs = frames(file)
  let core = 0
  let rim = 0
  /* A pop matters even if both sides of it are in tolerance, because the eye
   * reads change rather than level. This is the number that caught the
   * unpinned holds: it was 4.94 on one frame of lean and 0.87 everywhere. */
  let jitter = 0
  for (let i = 0; i < fs.length; i++) {
    core = Math.max(core, diff(fs[i], ref, CORE))
    rim = Math.max(rim, diff(fs[i], ref, RIM))
    if (i) jitter = Math.max(jitter, diff(fs[i], fs[i - 1], RIM))
  }
  frameTotal += fs.length
  row(`clip ${name}`, fs.length, core, rim, jitter)
  if (jitter > RIM_MAX) failures.push(`clip ${name}: the rim jumps ${jitter.toFixed(2)} between two frames`)
}

/*
 * Plates are compared against the SHIPPED reference rather than the PNG, so
 * the JPEG quantiser is on both sides of the subtraction and what is left is
 * the pin. Comparing a jpg against the png instead reads 3.27 on the
 * reference plate against itself, which is a measurement of libjpeg.
 */
const shippedRef = readRGB(join(ROOT, 'public', 'art', 'machine_rest.jpg'))
for (const name of plates) {
  const file = join(ROOT, 'public', 'art', `${name}.jpg`)
  if (!existsSync(file)) {
    failures.push(`${name}: no public/art/${name}.jpg - run npm run clips`)
    continue
  }
  const img = readRGB(file)
  row(`plate ${name}`, 1, diff(img, shippedRef, CORE), diff(img, shippedRef, RIM), null)
}

/*
 * And the pinned rectangle has to still surround the window the stylesheet
 * punches. Pinning a rim that no longer contains the glass would pass every
 * measurement above and still leak bands in the browser.
 */
const src = readFileSync(join(ROOT, 'src', 'machine.ts'), 'utf8')
const frac = (key) => Number(src.match(new RegExp(`${key}:\\s*([0-9.]+)`))?.[1])
const win = {
  x0: frac('left') * W,
  y0: frac('top') * H,
  x1: (frac('left') + frac('width')) * W,
  y1: (frac('top') + frac('height')) * H,
}
const surrounds = win.x0 > RIM.x0 && win.x1 < RIM.x1 && win.y0 > RIM.y0 && win.y1 < RIM.y1
console.log(
  `\npinned ${RIM.x0},${RIM.y0}..${RIM.x1},${RIM.y1} vs the glass ` +
    `${win.x0.toFixed(0)},${win.y0.toFixed(0)}..${win.x1.toFixed(0)},${win.y1.toFixed(0)}: ` +
    `${surrounds ? 'the glass is inside the pin' : 'THE GLASS IS NOT INSIDE THE PIN'}`,
)
if (!surrounds) failures.push('RIM in lib/lock.mjs no longer surrounds WINDOW in src/machine.ts')

if (failures.length) console.error('\n' + failures.join('\n'))
console.log(
  failures.length
    ? '\nFAILED'
    : `\nOK: ${frameTotal} frames and ${plates.length} plates, and the reel window is the approved one in all of them`,
)
process.exit(failures.length ? 1 : 0)
