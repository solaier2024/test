#!/usr/bin/env node
/*
 * Nails the costume to one reference plate.
 *
 * THE BUG THIS FIXES. Every plate is generated from the same reference and the
 * same wardrobe description, and the generator still re-invents the exact cut of
 * the neckline each time: the top edge of the bodice sits a few pixels higher on
 * one plate than the next, the lace trim takes a different curve, a strap lands
 * somewhere else. On a still nobody notices. But the clips are dense optical flow
 * between two plates, so a neckline 8px higher on the target frame becomes a
 * neckline that visibly slides up her chest over twenty-four frames - and across
 * seven clips the costume reads as though it is changing by itself.
 *
 * Measured on the offending build, costume-region difference from the master:
 *
 *   dealer_deal      39.6      dealer_sharp       13.8
 *   dealer_caught    22.2      dealer_breath      10.8
 *   dealer_shuffle   24.2      dealer_cool_blink   9.8
 *
 * Prompting harder does not fix this; it is not a description problem. What fixes
 * it is remembering that every plate is the SAME LOCKED CAMERA, so the costume is
 * not supposed to be re-drawn at all - it is supposed to be the same pixels. The
 * master's costume is composited into every derived plate behind a feathered
 * mask, which makes it identical by construction rather than by hope.
 *
 * Two regions, because there are two kinds of plate:
 *
 *   torso   the whole bodice, both straps, the shoulders and the upper-arm lace.
 *           For plates where only her face changes and the torso is supposed to
 *           be pixel-identical anyway.
 *   bodice  the neckline and chest only, leaving the arms free. For the plates
 *           where she really does move - dealing and shuffling.
 *
 * Her face is above both regions, so expressions are untouched.
 *
 * The compositing goes through raw RGB rather than ffmpeg's overlay filter. That
 * is not fussiness: overlay quietly colour-converts the rectangle it draws into,
 * so pasting a plate onto ITSELF came back with a mean difference of 7.96 in the
 * pasted region and zero everywhere else. Raw pixels in, raw pixels out, and the
 * same self-paste is exact.
 *
 *   node scripts/lock-costume.mjs            # lock, and report
 *   node scripts/lock-costume.mjs --check    # report only, change nothing
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ART = join(ROOT, 'public', 'art')
/** Whatever the generator produced, kept so this can always re-run from source. */
const ORIG = join(ROOT, 'clipsrc', 'unlocked')
const SRC = join(ROOT, 'clipsrc')

/** Plates live in public/art, except the opening's own, which lives in clipsrc. */
export const plateFile = (name) =>
  name.startsWith('intro_') ? join(SRC, `${name}.jpg`) : join(ART, `${name}.jpg`)

const W = 1280
const H = 720
/** Width of the blend ramp at the region edge, in pixels. */
const FEATHER = 18

const check = process.argv.includes('--check')

/** The reference every other plate's costume is taken from. */
export const MASTER = 'dealer_cool'

/*
 * Region boxes in plate pixels, verified by drawing them on the master.
 *
 * The first version of the torso box started at y 252, which turned out to be
 * below her shoulders - so the straps, including the one slipped off her left
 * shoulder, and the sides of the choker were all still free to drift, and they
 * measured 7 to 17 apart. A reviewer spotted exactly that: slipped in the
 * opening, up on both shoulders at the table.
 *
 * The straps sit at the sides, well clear of her face, so the top edge can come
 * up to 210 there. Her chin is at 207 and her mouth just above it, both of which
 * have to stay free, so `arch` lifts the top edge back down to 252 across the
 * centre column. The mask is that arch rather than a rectangle.
 */
export const REGIONS = {
  torso: { x: 336, y: 210, w: 528, h: 260, arch: { from: 540, to: 720, y: 252 } },
  bodice: { x: 404, y: 252, w: 352, h: 172 },
}

/** Which plates get which lock. */
export const PLATES = {
  /*
   * The opening's own plate of her shares the locked camera, so it locks too -
   * otherwise the costume changes between the opening and the table, which is
   * half of what the bug report was about.
   *
   * The macro shot of her hands is a different camera entirely and is deliberately
   * not in here; its costume only appears as background bokeh.
   */
  intro_down: 'torso',
  dealer_warm: 'torso',
  dealer_sharp: 'torso',
  dealer_cool_blink: 'torso',
  dealer_breath: 'torso',
  dealer_caught: 'torso',
  dealer_deal: 'bodice',
  dealer_shuffle: 'bodice',
}

/** The opaque middle of a region, inset past the ramp: what the assertion measures. */
export const core = (r) => {
  const top = (r.arch ? r.arch.y : r.y) + FEATHER + 4
  return {
    x: r.x + FEATHER + 4,
    y: top,
    w: r.w - (FEATHER + 4) * 2,
    h: r.y + r.h - (FEATHER + 4) - top,
  }
}

export function readRgb(path) {
  const out = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: W * H * 3 * 4 },
  )
  if (out.length !== W * H * 3) throw new Error(`${path}: got ${out.length} bytes, wanted ${W * H * 3}`)
  return out
}

function writeJpeg(buf, path) {
  execFileSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-',
      '-q:v', '2', path],
    { input: buf },
  )
}

/** Mean absolute channel difference over a box. Exact, on raw pixels. */
export function boxDiff(a, b, r) {
  let sum = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    let i = (y * W + r.x) * 3
    for (let x = 0; x < r.w * 3; x++, i++) sum += Math.abs(a[i] - b[i])
  }
  return sum / (r.w * r.h * 3)
}

/**
 * Per-pixel alpha for a region with a smooth ramp at its edges. When the region
 * carries an `arch`, the top edge dips to the deeper y across the named column and
 * eases back up either side of it, so her chin stays out of the mask while the
 * straps at the shoulders come in.
 */
function alphaFor(r) {
  const a = new Float32Array(W * H)
  const smooth = (t) => t * t * (3 - 2 * t)
  const bottom = r.y + r.h - 1
  const topAt = (x) => {
    if (!r.arch) return r.y
    const { from, to, y } = r.arch
    const ramp = 70
    if (x <= from - ramp || x >= to + ramp) return r.y
    if (x >= from && x <= to) return y
    const t = x < from ? (x - (from - ramp)) / ramp : ((to + ramp) - x) / ramp
    return Math.round(r.y + (y - r.y) * smooth(t))
  }
  for (let x = r.x; x < r.x + r.w; x++) {
    const top = topAt(x)
    for (let y = top; y <= bottom; y++) {
      const d = Math.min(x - r.x, r.x + r.w - 1 - x, y - top, bottom - y)
      const v = d >= FEATHER ? 1 : smooth(d / FEATHER)
      if (v > a[y * W + x]) a[y * W + x] = v
    }
  }
  return a
}

function composite(base, top, alpha) {
  const out = Buffer.from(base)
  for (let p = 0; p < W * H; p++) {
    const t = alpha[p]
    if (t === 0) continue
    const i = p * 3
    if (t === 1) {
      out[i] = top[i]
      out[i + 1] = top[i + 1]
      out[i + 2] = top[i + 2]
      continue
    }
    out[i] = Math.round(base[i] + (top[i] - base[i]) * t)
    out[i + 1] = Math.round(base[i + 1] + (top[i + 1] - base[i + 1]) * t)
    out[i + 2] = Math.round(base[i + 2] + (top[i + 2] - base[i + 2]) * t)
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const masterPath = join(ART, `${MASTER}.jpg`)
  if (!existsSync(masterPath)) throw new Error(`no master plate at ${masterPath}`)
  const master = readRgb(masterPath)

  mkdirSync(ORIG, { recursive: true })
  for (const name of Object.keys(PLATES)) {
    const kept = join(ORIG, `${name}.jpg`)
    if (!existsSync(kept)) copyFileSync(plateFile(name), kept)
  }

  // A self-paste has to be exact, or the compositing path is lying.
  const selfDiff = boxDiff(master, composite(master, master, alphaFor(REGIONS.torso)), core(REGIONS.torso))
  if (selfDiff > 0.001) {
    console.error(`the compositing path is not exact: pasting the master onto itself differs by ${selfDiff}`)
    process.exit(1)
  }

  console.log(`master: ${MASTER}.jpg   feather: ${FEATHER}px   self-paste error: ${selfDiff}`)
  console.log('')

  const rows = []
  for (const [name, region] of Object.entries(PLATES)) {
    const r = REGIONS[region]
    const inner = core(r)
    const source = readRgb(join(ORIG, `${name}.jpg`))
    const before = boxDiff(master, source, inner)

    if (check) {
      const now = boxDiff(master, readRgb(plateFile(name)), inner)
      rows.push({ name, region, before, after: now })
      continue
    }

    const locked = composite(source, master, alphaFor(r))
    writeJpeg(locked, plateFile(name))
    rows.push({ name, region, before, after: boxDiff(master, readRgb(plateFile(name)), inner) })
  }

  for (const { name, region, before, after } of rows) {
    const drop = before > 0.05 ? ` (${(100 * (1 - after / before)).toFixed(0)}% closer)` : ''
    console.log(`  ${name.padEnd(20)} ${region.padEnd(7)} ${before.toFixed(2).padStart(6)} -> ${after.toFixed(2).padStart(5)}${drop}`)
  }

  const worst = Math.max(...rows.map((r) => r.after))
  console.log('')
  console.log(`worst costume-core difference after locking: ${worst.toFixed(2)}`)
  if (!check) {
    console.log('originals kept in clipsrc/unlocked/, so this re-runs from source')
    console.log('now rebuild: FORCE=1 node scripts/build-clips.mjs')
  }
}
