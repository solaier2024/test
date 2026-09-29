/*
 * Shared between align-plates.mjs and verify-window.mjs: read a plate as luma,
 * and find the whole-pixel shift that best lines one plate up with another.
 *
 * Both scripts have to agree about what "lined up" means or the build can pass
 * a check it has already failed, so the definition lives in one file.
 */
import { execFileSync } from 'node:child_process'

export const W = 1280
export const H = 720

/* The casting only. Not the crowd, which is supposed to move between plates,
 * and not the hand, which is supposed to move on two of them. */
export const ROI = { x0: 330, x1: 700, y0: 90, y1: 560 }
const STEP = 2

export function luma(path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 1 << 28,
  })
  if (raw.length !== W * H) throw new Error(`${path}: expected ${W}x${H}, got ${raw.length} bytes`)
  return raw
}

/** Mean absolute difference over the casting, with the candidate shifted. */
export function cost(ref, cand, dx, dy) {
  let sum = 0
  let n = 0
  for (let y = ROI.y0; y <= ROI.y1; y += STEP) {
    const ry = y * W
    const cy = (y - dy) * W
    for (let x = ROI.x0; x <= ROI.x1; x += STEP) {
      sum += Math.abs(ref[ry + x] - cand[cy + x - dx])
      n++
    }
  }
  return sum / n
}

export function bestShift(ref, cand, range) {
  let best = { dx: 0, dy: 0, cost: Infinity }
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const c = cost(ref, cand, dx, dy)
      if (c < best.cost) best = { dx, dy, cost: c }
    }
  }
  return best
}
