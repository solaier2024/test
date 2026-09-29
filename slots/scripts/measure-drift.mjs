#!/usr/bin/env node
/*
 * How far does a generated clip's casting wander from the approved plate?
 *
 * This is the one number that decides whether generative video can carry this
 * table at all. The reel window is a hole the DOM bands show through, so the
 * question is not "does the clip look good" - it is "does the brass rim stay
 * where src/machine.ts says it is, on every single frame".
 *
 *   node scripts/measure-drift.mjs clipsrc/generated/pull.mp4
 *
 * Reports per-frame translation against the reference plate, and how much
 * residual is left after that translation is taken out. The residual matters
 * as much as the shift: a clip that does not move but repaints the casting
 * every frame is just as broken, and stabilisation cannot fix it.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bestShiftRGB, readRGB, toLuma } from './lib/lock.mjs'

const clip = process.argv[2]
const reference = process.argv[3] ?? 'clipsrc/aligned/machine_rest.png'
if (!clip) throw new Error('usage: measure-drift.mjs <clip.mp4> [reference.png]')

const ref = toLuma(readRGB(reference))

const stage = mkdtempSync(join(tmpdir(), 'drift-'))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', clip, join(stage, '%05d.png')])
const frames = readdirSync(stage).sort()

console.log(`${frames.length} frames of ${clip}`)
console.log('frame     dx    dy   residual')

const shifts = []
let worst = 0
let worstResidual = 0
for (let i = 0; i < frames.length; i++) {
  const cand = toLuma(readRGB(join(stage, frames[i])))
  const { dx, dy, cost } = bestShiftRGB(ref, cand, 16)
  shifts.push({ dx, dy, cost })
  worst = Math.max(worst, Math.abs(dx), Math.abs(dy))
  worstResidual = Math.max(worstResidual, cost)
  // Every frame on a short clip, every fourth on a long one.
  if (frames.length <= 24 || i % 4 === 0 || i === frames.length - 1) {
    console.log(
      `${String(i).padStart(5)} ${String(dx).padStart(5)} ${String(dy).padStart(5)} ${cost.toFixed(2).padStart(10)}`,
    )
  }
}
rmSync(stage, { recursive: true, force: true })

const mean = shifts.reduce((s, f) => s + f.cost, 0) / shifts.length
console.log(`\nworst translation  ${worst}px`)
console.log(`worst residual     ${worstResidual.toFixed(2)}`)
console.log(`mean residual      ${mean.toFixed(2)}`)
