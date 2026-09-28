#!/usr/bin/env node
/*
 * Does the costume move *inside* a clip?
 *
 * verify-costume.mjs compares the stills. This one is the thing the bug report was
 * actually about: the clips are dense optical flow between two plates, so a
 * neckline a few pixels out at one end turns into a neckline that slides over
 * twenty-four frames. Measuring the stills cannot see that; measuring the frames
 * can.
 *
 * It decodes each clip, crops the costume out of every frame, and adds up how far
 * that region travels from frame to frame. A locked clip should be near zero on
 * the transitions where only her face changes, and small everywhere else - the
 * only motion left in the box being her arms on the plates that move them.
 *
 *   node scripts/verify-clip-costume.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGIONS, boxDiff, core } from './lock-costume.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIPS = join(HERE, '..', 'public', 'clips')
const WORK = '/tmp/dc-clip-costume'

/*
 * Travel budgets, in mean-channel-difference summed over the clip. Her face
 * changing does not touch the costume box, so those clips have to be almost
 * still; dealing and shuffling move her arms through the box on purpose, so they
 * get room. The unlocked build scored 60 to 240 on these same clips.
 */
const BUDGET = {
  warm: 9,
  sharp: 9,
  cool: 9,
  caught: 12,
  idle: 14,
  deal: 130,
  shuffle: 150,
}

const r = core(REGIONS.torso)
const fail = []

console.log(`costume travel inside each clip, over the torso box\n`)
for (const [name, budget] of Object.entries(BUDGET)) {
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

  const ok = travel <= budget
  console.log(`  ${name.padEnd(9)} ${frames.length.toString().padStart(3)} frames   travel ${travel.toFixed(1).padStart(6)} (<=${budget})   worst frame step ${worst.toFixed(2)}   ${ok ? 'steady' : 'MOVING'}`)
  if (!ok) fail.push(`${name}: the costume travels ${travel.toFixed(1)} over the clip, budget ${budget}`)
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
console.log('OK: the costume holds still inside every clip')
