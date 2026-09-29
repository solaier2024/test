#!/usr/bin/env node
/*
 * Does the costume survive the encoder?
 *
 * There are three costume checks and they ask three different questions, so it is
 * worth being clear which one this is. verify-costume.mjs compares the stills.
 * verify-generated.mjs measures the 1080p masters OpenArt returns, and it is the
 * one that asserts the garment: the slipped left strap has to stay slipped.
 * This one measures the files the browser actually downloads, after VP9 at CRF 28
 * and 33 have been through them, which is the only place the encoder can be
 * caught damaging her.
 *
 * That is not a hypothetical. CRF 34 smoothed the fine black lace against skin
 * until the trim came out visibly thinner in the clip than on the JPEG plate
 * underneath it, which reads as the costume changing the moment a clip starts.
 * Nothing upstream of the encoder can see that.
 *
 * It decodes each clip, crops the costume out of every frame, and adds up how far
 * that region travels from frame to frame.
 *
 *   node scripts/verify-clip-costume.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGIONS, core } from './lock-costume.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIPS = join(HERE, '..', 'public', 'clips')
const WORK = '/tmp/dc-clip-costume'

/*
 * One budget for the whole dealer set, because there is one source now.
 *
 * These numbers changed character completely when the clips stopped being optical
 * flow between pairs of stills. Travel used to mean DRIFT: the costume was pinned
 * by a pasted rectangle, so anything moving inside the box was the generator
 * drawing different clothes, and the per-clip budgets ran from 10 for a change of
 * expression up to 170 for a shuffle that swung her arms through the box.
 *
 * It now means she moved. The clips are generated video wearing the master plate
 * as their own first and last frame, and what the box sees is her chest and
 * shoulders under cloth that cannot be redrawn without failing the strap check in
 * verify-generated.mjs. The proof that this is her and not the cloth is that the
 * figure tracks how much her FACE moves, which is measured in a different box
 * entirely and by a different script:
 *
 *       natural  face 15.85   travel 15.4        sharp    face  5.60   travel 6.5
 *       warm     face 14.96   travel 14.3        shuffle  face  5.40   travel 6.2
 *       idle     face  9.80   travel 15.4        deal     face  7.77   travel 5.7
 *
 * The three clips where she moves sit at 14 to 15.4 and the three quiet ones at
 * 5.7 to 6.5, and the two hand clips came DOWN from 150 and 170 because they no
 * longer use her hands at all.
 *
 * So 26 - carried over unchanged from what idle already had, rather than invented
 * for this - which is comfortably above the 15.4 the liveliest clip reaches and
 * still four times under the 60 to 240 the unlocked build scored.
 */
const BUDGET = 26
const CLIP_NAMES = ['idle', 'deal', 'warm', 'sharp', 'shuffle', 'natural']

const r = core(REGIONS.torso)
const fail = []

console.log(`costume travel inside each clip, over the torso box\n`)
for (const name of CLIP_NAMES) {
  const dir = join(WORK, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(CLIPS, `${name}.webm`),
    '-vf', `crop=${r.w}:${r.h}:${r.x}:${r.y}`, '-f', 'image2', join(dir, '%04d.png')])

  const frames = readdirSync(dir).sort().map((f) => join(dir, f))
  const box = { x: 0, y: 0, w: r.w, h: r.h }
  let travel = 0
  let worst = 0
  let prev = null
  for (const f of frames) {
    const px = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { maxBuffer: r.w * r.h * 3 * 4 })
    if (prev) {
      const d = boxDiffRaw(prev, px, box)
      travel += d
      if (d > worst) worst = d
    }
    prev = px
  }

  const ok = travel <= BUDGET
  console.log(`  ${name.padEnd(9)} ${frames.length.toString().padStart(3)} frames   travel ${travel.toFixed(1).padStart(6)} (<=${BUDGET})   worst frame step ${worst.toFixed(2)}   ${ok ? 'steady' : 'MOVING'}`)
  if (!ok) fail.push(`${name}: the costume travels ${travel.toFixed(1)} over the clip, budget ${BUDGET}`)
}

/** boxDiff, but on buffers already cropped to the region. */
function boxDiffRaw(a, b, box) {
  let sum = 0
  for (let i = 0; i < box.w * box.h * 3; i++) sum += Math.abs(a[i] - b[i])
  return sum / (box.w * box.h * 3)
}

rmSync(WORK, { recursive: true, force: true })
console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: the costume survives the encoder in every clip')
