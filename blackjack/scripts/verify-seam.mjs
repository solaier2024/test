#!/usr/bin/env node
/*
 * Is there a composite edge anywhere on her?
 *
 * verify-costume.mjs asks whether the costume is the same garment. This asks the
 * question the second bug report actually raised, which is different: whether the
 * seam where the compositing happens can be SEEN. A plate can wear exactly the
 * right clothes and still show a soft rectangle around them.
 *
 * Four assertions, in the order the artifact was built out of:
 *
 * 1. ONE ROOM. Outside its gate every plate must be the master, near enough that
 *    only JPEG separates them. This is the one that matters most and it is not
 *    about the costume at all: the plates used to differ across the whole frame -
 *    the bar 4.2 to 9.3, the left shelf 5.3 to 16.1, the baize 3.2 to 9.1 - so
 *    every transition was optical flow dragging the bottles and the crate about,
 *    and the costume patch sat in the middle of that as the one thing not moving.
 *    A frozen island in a drifting picture reads as a soft edge however wide the
 *    feather is, which is exactly how it was reported.
 *
 * 2. THE ARM HOLDS STILL. Her left arm's outer silhouette used to land in a
 *    different place on almost every plate - x311 on the resting one, x362 to x366
 *    on the moods, measured at y=420 - while the mask edge was pinned at x=336,
 *    inside that 51px band. The arm slid across a boundary that did not. Every
 *    plate that is only supposed to change her face must now put that edge in the
 *    same column.
 *
 * 3. NO EDGE AT THE BOUNDARY. In the ramp band itself, fine detail must not be
 *    any stronger than the master's own detail in those same pixels. If the
 *    composite were leaving a step, the second derivative there would rise.
 *
 * 4. BREATH IS A WARP. dealer_breath is not generated, it is the master displaced,
 *    so it must still be exactly that. This is stronger than a threshold: it is
 *    recomputed and compared.
 *
 *   node scripts/verify-seam.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BREATH,
  DERIVED,
  LOOK,
  MASTER,
  REGIONS,
  alphaFor,
  boxDiff,
  core,
  plateFile,
  readRgb,
  warp,
} from './lock-costume.mjs'

const W = 1280
const H = 720

const LIMIT = {
  /** Mean channel difference outside the gate. A JPEG round trip alone is ~0.85. */
  room: 1.5,
  /** No single pixel out there may be more than compression noise either. */
  roomPixel: 24,
  /** Her arm's silhouette, in pixels of column, against the master's. */
  arm: 2,
  /** Recomputed warp against the stored one, whole frame. */
  derived: 1.6,
}

/** Rows to scan for her arm, and the window to scan across. */
const ARM_ROWS = [340, 380, 420, 460]
const ARM_FROM = 300
const ARM_TO = 420

const master = readRgb(plateFile(MASTER))
const lum = (b, x, y) => {
  const i = (y * W + x) * 3
  return 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
}
const lap = (b, x, y) =>
  Math.abs(4 * lum(b, x, y) - lum(b, x - 1, y) - lum(b, x + 1, y) - lum(b, x, y - 1) - lum(b, x, y + 1))

/**
 * Where her silhouette crosses a row: the centroid of the gradient across the
 * window, weighted steeply so the dominant edge dominates. Taking the single
 * strongest column instead makes this jitter by a few pixels between two
 * neighbouring candidates whenever JPEG shifts one of them by a level, which is
 * noise in a measurement that needs to resolve real movement of a pixel or two.
 */
const armEdge = (b, y) => {
  let num = 0
  let den = 0
  for (let x = ARM_FROM; x < ARM_TO; x++) {
    const d = Math.abs(lum(b, x + 2, y) - lum(b, x - 2, y)) ** 3
    num += d * x
    den += d
  }
  return den ? num / den : 0
}

const fail = []

console.log(`one room: everything outside the gate, against ${MASTER}.jpg\n`)
for (const [name, look] of Object.entries(LOOK)) {
  const alpha = alphaFor(look)
  const plate = readRgb(plateFile(name))
  let sum = 0
  let n = 0
  let worst = 0
  for (let p = 0; p < W * H; p++) {
    if (alpha[p] > 0.002) continue
    const i = p * 3
    const d = (Math.abs(master[i] - plate[i]) + Math.abs(master[i + 1] - plate[i + 1]) + Math.abs(master[i + 2] - plate[i + 2])) / 3
    sum += d
    n++
    if (d > worst) worst = d
  }
  const mean = sum / n
  const ok = mean <= LIMIT.room && worst <= LIMIT.roomPixel
  console.log(`  ${name.padEnd(20)} ${look.padEnd(6)} ${(100 * n / (W * H)).toFixed(0).padStart(3)}% pinned   mean ${mean.toFixed(2)}  worst pixel ${worst.toFixed(0).padStart(3)}   ${ok ? 'same room' : 'DIFFERENT ROOM'}`)
  if (mean > LIMIT.room) fail.push(`${name}: the room around her differs by ${mean.toFixed(2)} (limit ${LIMIT.room})`)
  else if (worst > LIMIT.roomPixel) fail.push(`${name}: a pixel outside the gate is ${worst.toFixed(0)} off the master (limit ${LIMIT.roomPixel})`)
}

console.log(`\nher arm: the column its outer edge lands in, by row\n`)
const ref = ARM_ROWS.map((y) => armEdge(master, y))
console.log(`  ${MASTER.padEnd(20)} ${ref.map((x, i) => `y${ARM_ROWS[i]}:x${x.toFixed(1)}`).join('  ')}`)
for (const [name, look] of Object.entries(LOOK)) {
  // The two plates that move their arms are supposed to move their arms.
  if (look !== 'head') continue
  const plate = readRgb(plateFile(name))
  const got = ARM_ROWS.map((y) => armEdge(plate, y))
  const off = Math.max(...got.map((x, i) => Math.abs(x - ref[i])))
  const ok = off <= LIMIT.arm
  console.log(`  ${name.padEnd(20)} ${got.map((x, i) => `y${ARM_ROWS[i]}:x${x.toFixed(1)}`).join('  ')}   off by ${off.toFixed(1)}   ${ok ? 'pinned' : 'SWINGING'}`)
  if (!ok) fail.push(`${name}: her arm silhouette is ${off.toFixed(1)}px off the master (limit ${LIMIT.arm})`)
}

console.log(`\nthe boundary itself: fine detail in the ramp band, against the master there\n`)
for (const [name, look] of Object.entries(LOOK)) {
  const alpha = alphaFor(look)
  const plate = readRgb(plateFile(name))
  let mine = 0
  let theirs = 0
  let n = 0
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const t = alpha[y * W + x]
      if (t <= 0.12 || t >= 0.88) continue
      mine += lap(plate, x, y)
      theirs += lap(master, x, y)
      n++
    }
  }
  // A composite that left a step would put MORE second derivative into the band
  // than the picture naturally has there. Softer than the original is fine.
  const ok = mine <= theirs * 1.15
  console.log(`  ${name.padEnd(20)} ${String(n).padStart(6)} ramp px   plate ${(mine / n).toFixed(2)}   master there ${(theirs / n).toFixed(2)}   ${ok ? 'no edge' : 'EDGE'}`)
  if (!ok) fail.push(`${name}: the ramp band is sharper than the picture around it`)
}

console.log(`\nderived plates: recomputed and compared\n`)
for (const name of Object.keys(DERIVED)) {
  if (!existsSync(plateFile(name))) {
    fail.push(`${name}: missing`)
    continue
  }
  const d = boxDiff(warp(master, BREATH, 1), readRgb(plateFile(name)), { x: 0, y: 0, w: W, h: H })
  const ok = d <= LIMIT.derived
  console.log(`  ${name.padEnd(20)} against a fresh warp of the master: ${d.toFixed(2)}   ${ok ? 'is the warp' : 'NOT THE WARP'}`)
  if (!ok) fail.push(`${name} is not the master warped (${d.toFixed(2)} > ${LIMIT.derived})`)
}

/*
 * The idle loop, frame by frame, against the warp series it is supposed to be.
 *
 * This replaces what verify-clip-costume.mjs could say about idle, and it is a
 * stronger claim. That script measures how far the costume travels inside a clip,
 * which was the right question when the costume was pinned by a pasted rectangle:
 * travel meant drift. Now the breathing is the master displaced, so the costume
 * *should* travel - she is wearing it while she breathes - and the number went up
 * for the right reason.
 *
 * So instead of asking "did it move", this asks "is every frame of it the master".
 * For each sampled frame it finds the amplitude of the breath field that fits best
 * and reports what is left over. If the encoder, the pipeline or a stray plate had
 * put a different garment in there, no amplitude would fit.
 */
const IDLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'clips', 'idle.webm')
if (existsSync(IDLE)) {
  const box = core(REGIONS.torso)
  const LEVELS = 24
  /** Every 4th frame, every 3rd pixel: enough to catch a garment, fast enough to run. */
  const STRIDE = 4
  const STEP = 3
  const LIMIT_FIT = 7

  const crop = (buf) => {
    const out = []
    for (let y = box.y; y < box.y + box.h; y += STEP) {
      for (let x = box.x; x < box.x + box.w; x += STEP) {
        const i = (y * W + x) * 3
        out.push(buf[i], buf[i + 1], buf[i + 2])
      }
    }
    return out
  }
  const ladder = []
  for (let i = 0; i <= LEVELS; i++) ladder.push(crop(warp(master, BREATH, i / LEVELS)))

  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', IDLE, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: W * H * 3 * 512 },
  )
  const total = raw.length / (W * H * 3)
  let worstFit = 0
  let checked = 0
  for (let f = 0; f < total; f += STRIDE) {
    const frame = crop(raw.subarray(f * W * H * 3, (f + 1) * W * H * 3))
    let best = Infinity
    for (const level of ladder) {
      let sum = 0
      for (let i = 0; i < frame.length; i++) sum += Math.abs(frame[i] - level[i])
      const d = sum / frame.length
      if (d < best) best = d
    }
    if (best > worstFit) worstFit = best
    checked++
  }
  const ok = worstFit <= LIMIT_FIT
  console.log(`\nthe idle loop: is every frame the master, warped?\n`)
  console.log(`  ${checked} of ${total} frames, best-fitting amplitude out of ${LEVELS + 1}`)
  console.log(`  worst residual in the costume box: ${worstFit.toFixed(2)}  (limit ${LIMIT_FIT})   ${ok ? 'all warps of the master' : 'SOMETHING ELSE IN THERE'}`)
  if (!ok) fail.push(`idle has a frame the breath field cannot account for (${worstFit.toFixed(2)} > ${LIMIT_FIT})`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  console.log('\nrun: node scripts/lock-costume.mjs && FORCE=1 node scripts/build-clips.mjs')
  process.exit(1)
}
console.log('OK: one room, her arm pinned, no edge at any boundary, breath still a warp')
