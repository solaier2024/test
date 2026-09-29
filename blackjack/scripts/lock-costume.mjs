#!/usr/bin/env node
/*
 * Nails every plate to one reference: one room, one woman, one costume.
 *
 * THE FIRST BUG THIS FIXED. The generator re-invents the exact cut of the
 * neckline on every plate - the top edge of the bodice a few pixels higher, the
 * lace trim on a different curve, a strap somewhere else. The clips are dense
 * optical flow between two plates, so a neckline 8px out becomes a neckline that
 * visibly slides up her chest over twenty-four frames.
 *
 * THE SECOND BUG, which the first fix caused. The original fix pasted the
 * master's costume rectangle onto each plate. That is backwards, and it is worth
 * writing down why, because the rectangle was the reported artifact:
 *
 *   - Nothing in these plates is actually still. Measured against the master, the
 *     whole frame moves: the bar 4.2 to 9.3, the left shelf 5.3 to 16.1, the
 *     bottles 2.0 to 3.9, the crate 2.2 to 5.4, the baize 3.2 to 9.1. The "locked
 *     camera" is locked in framing only. So optical flow was warping the bottles,
 *     the crate and the felt on every single transition.
 *   - Into that moving field the fix pasted one rectangle that did NOT move. A
 *     frozen island in a drifting picture is visible however well you feather it,
 *     and the eye reads it as a soft composite edge rather than as a hard line -
 *     which is exactly how it was reported.
 *   - Worse, the rectangle's left edge sat at x=336, and her arm silhouette is not
 *     in the same place on every plate. Scanning for the strongest luminance step
 *     across x=300..420 at y=420:
 *
 *         cool x311   breath x311   warm x362   sharp x362   caught x366
 *
 *     The arm sweeps about 51px between plates and the mask edge was pinned
 *     inside that band. The arm slid; the rectangle did not. That is the seam at
 *     her shoulder and slipped strap.
 *
 * SO THIS RUNS THE OTHER WAY ROUND. The master is the *base* for every plate, and
 * a plate contributes only what it is supposed to change:
 *
 *   head    her face and hair, for the plates where only her expression differs.
 *           Her arms, shoulders, straps, bodice, the bar, the crate and the felt
 *           all come from the master, so they are identical by construction and
 *           there is nothing left for the 51px arm swing to collide with.
 *   reach   the same, plus her arms and hands, for dealing and shuffling - the two
 *           plates where she really does move. The gate's own edges sit out in the
 *           background, where master and plate differ by 2 to 6, so a 30px ramp
 *           there is below the noise floor.
 *
 * On top of that a `keep` box holds the costume itself at the master
 * unconditionally, so even on the plates that may move their arms the bodice can
 * never come from the generator.
 *
 * `dealer_breath` is not composited at all - see BREATH below.
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

const check = process.argv.includes('--check')

/** The reference every other plate is built on. */
export const MASTER = 'dealer_cool'

/*
 * The gates: what a plate is allowed to contribute. Everything outside is master.
 *
 * `arch` lifts the BOTTOM edge at the sides. The centre has to reach down past her
 * chin (y 205) and into the choker band (y 210 to 250) so an expression can carry
 * her jaw with it, and a boundary buried in a band of black velvet is invisible.
 * The sides must NOT reach that far, because at x 424 and x 784 the rows below 200
 * are her shoulders and the slipped strap - the very things that have to stay
 * pinned to the master. So the gate is a dome over her head, not a box.
 *
 * Placed from a 32px difference map of each plate against the master rather than by
 * eye: the expression plates change inside x 530..770, y 0..290, and the two that
 * move their arms change inside x 416..800, y 224..700.
 */
export const GATES = {
  head: [{ x: 424, y: -48, w: 360, h: 292, feather: 26, arch: { from: 500, to: 710, y: 196 } }],
  reach: [
    { x: 424, y: -48, w: 360, h: 292, feather: 26, arch: { from: 500, to: 710, y: 196 } },
    /*
     * Her arms. The right edge stops at 836 so the leather cup at x 840..920 is
     * always the master's - her hand reaches about 810 at the furthest, and a cup
     * that wobbles under her wrist is the kind of thing nobody can name but
     * everybody sees.
     */
    { x: 296, y: 268, w: 540, h: 452, feather: 30 },
  ],
}

/**
 * The costume, held at the master whatever the gate says. Only the plates that
 * move their arms need this - on the others the bodice is already outside the
 * gate, which is the point of shaping the gate as a dome.
 */
export const KEEP = {
  head: null,
  reach: { x: 404, y: 252, w: 352, h: 172, feather: 22 },
}

/** Which gate each plate gets. */
export const LOOK = {
  /*
   * The opening's own plate of her shares the locked camera, so it locks too -
   * otherwise the costume changes between the opening and the table, which is
   * half of what the first bug report was about.
   *
   * The macro shot of her hands is a different camera entirely and is deliberately
   * not in here; its costume only appears as background bokeh.
   */
  intro_down: 'head',
  dealer_warm: 'head',
  dealer_sharp: 'head',
  dealer_cool_blink: 'head',
  dealer_caught: 'head',
  dealer_deal: 'reach',
  dealer_shuffle: 'reach',
}

/*
 * Breath is DERIVED, not generated.
 *
 * The idle loop is on screen for most of a session, and it was the worst offender:
 * a dense morph between the master and a separately generated "inhale" plate, which
 * meant every breath warped the entire room and then had a frozen costume rectangle
 * sitting in the middle of it. Her chest measured 11.8 from the master and her arms
 * 9.9, and there is no way to tell which part of that was breathing and which part
 * was the generator drawing a different woman.
 *
 * A breath is a displacement, so this is a displacement: the master's own pixels,
 * lifted and spread about her sternum, falling to zero before the field reaches
 * anything that is not her. The costume cannot drift because it is the same
 * pixels, the room cannot drift because the room is untouched, and the whole idle
 * loop becomes warps of one image with no optical flow in it at all.
 *
 * The field is centred on her sternum and kept short vertically on purpose. A
 * rounder field reached the wooden crate at x 680..860 and the cup beside it, and
 * a crate that rises and falls with her breathing is the kind of thing nobody can
 * name but everybody notices. It is also just wrong: forearms planted on a table
 * do not lift when you inhale, shoulders do. At the crate this field is worth
 * about 0.4px, which is under the JPEG noise it is stored in.
 */
export const BREATH = { cx: 560, cy: 230, rx: 250, ry: 200, lift: 6.5, spread: 2.8 }

/** The derived plates, and how to build each one. */
export const DERIVED = {
  dealer_breath: (master) => warp(master, BREATH, 1),
}

/*
 * Measurement regions, unchanged from the build that shipped, so the costume
 * numbers stay directly comparable across this change. These are what
 * verify-costume.mjs and verify-clip-costume.mjs score; they are deliberately not
 * the same shapes as the gates above.
 */
export const REGIONS = {
  torso: { x: 336, y: 210, w: 528, h: 260, arch: { from: 540, to: 720, y: 252 } },
  bodice: { x: 404, y: 252, w: 352, h: 172 },
}

/** Which region each plate is measured over. */
export const PLATES = {
  intro_down: 'torso',
  dealer_warm: 'torso',
  dealer_sharp: 'torso',
  dealer_cool_blink: 'torso',
  dealer_breath: 'torso',
  dealer_caught: 'torso',
  dealer_deal: 'bodice',
  dealer_shuffle: 'bodice',
}

/** The opaque middle of a measurement region, inset past the ramp. */
export const core = (r) => {
  const feather = 18
  const top = (r.arch ? r.arch.y : r.y) + feather + 4
  return {
    x: r.x + feather + 4,
    y: top,
    w: r.w - (feather + 4) * 2,
    h: r.y + r.h - (feather + 4) - top,
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

export function writeJpeg(buf, path) {
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

const smooth = (t) => t * t * (3 - 2 * t)

/**
 * Per-pixel alpha for one box with a smooth ramp at its edges. `arch` raises the
 * bottom edge outside the named column span and eases it back down across it, so
 * the gate can reach her chin without reaching her shoulders.
 */
function alphaBox(box, into) {
  const a = into ?? new Float32Array(W * H)
  const { x: bx, y: by, w, h, feather } = box
  const left = Math.max(0, bx)
  const right = Math.min(W - 1, bx + w - 1)
  const deepBottom = by + h - 1
  const bottomAt = (x) => {
    if (!box.arch) return deepBottom
    const { from, to, y } = box.arch
    const ramp = 80
    if (x >= from && x <= to) return deepBottom
    if (x <= from - ramp || x >= to + ramp) return y
    const t = x < from ? (x - (from - ramp)) / ramp : ((to + ramp) - x) / ramp
    return Math.round(y + (deepBottom - y) * smooth(t))
  }
  for (let x = left; x <= right; x++) {
    const bottom = Math.min(H - 1, bottomAt(x))
    const top = Math.max(0, by)
    for (let y = top; y <= bottom; y++) {
      // Distance to the nearest edge, ignoring any edge that is off-frame: a gate
      // that runs off the top of the picture must not fade out against it.
      let d = Math.min(x - bx, bx + w - 1 - x, bottom - y)
      if (by >= 0) d = Math.min(d, y - by)
      const v = d >= feather ? 1 : smooth(Math.max(0, d) / feather)
      if (v > a[y * W + x]) a[y * W + x] = v
    }
  }
  return a
}

/** The gate for a plate: the union of its boxes, with the keep box subtracted. */
export function alphaFor(look) {
  const a = new Float32Array(W * H)
  for (const box of GATES[look]) alphaBox(box, a)
  const keep = KEEP[look]
  if (keep) {
    const k = alphaBox(keep)
    for (let p = 0; p < a.length; p++) if (k[p] > 0) a[p] *= 1 - k[p]
  }
  return a
}

/**
 * Resamples an image through a radial displacement field: content inside the
 * ellipse lifts by `lift` and spreads by `spread`, both scaled by `amount` and
 * both easing to nothing at the rim. Bilinear, because whole-pixel steps in a
 * 5px move are exactly the stutter this is here to avoid.
 */
export function warp(src, field, amount) {
  const out = Buffer.from(src)
  const { cx, cy, rx, ry, lift, spread } = field
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(W - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(H - 1, Math.ceil(cy + ry))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const u = (x - cx) / rx
      const v = (y - cy) / ry
      const d = Math.sqrt(u * u + v * v)
      if (d >= 1) continue
      const w = smooth(1 - d) * amount
      const sx = x - spread * w * u
      const sy = y + lift * w
      const fx = Math.max(0, Math.min(W - 1.001, sx))
      const fy = Math.max(0, Math.min(H - 1.001, sy))
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const tx = fx - ix
      const ty = fy - iy
      const i00 = (iy * W + ix) * 3
      const i10 = i00 + 3
      const i01 = i00 + W * 3
      const i11 = i01 + 3
      const o = (y * W + x) * 3
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * tx
        const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * tx
        out[o + c] = Math.round(top + (bot - top) * ty)
      }
    }
  }
  return out
}

export function composite(base, top, alpha) {
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
  for (const name of Object.keys(LOOK)) {
    const kept = join(ORIG, `${name}.jpg`)
    if (!existsSync(kept)) copyFileSync(plateFile(name), kept)
  }

  // A self-paste has to be exact, or the compositing path is lying.
  const selfDiff = boxDiff(master, composite(master, master, alphaFor('head')), core(REGIONS.torso))
  if (selfDiff > 0.001) {
    console.error(`the compositing path is not exact: pasting the master onto itself differs by ${selfDiff}`)
    process.exit(1)
  }

  console.log(`base: ${MASTER}.jpg for every plate   self-paste error: ${selfDiff}`)
  console.log('')

  const rows = []
  for (const [name, look] of Object.entries(LOOK)) {
    const inner = core(REGIONS[PLATES[name]])
    const source = readRgb(join(ORIG, `${name}.jpg`))
    const before = boxDiff(master, source, inner)

    if (!check) {
      writeJpeg(composite(master, source, alphaFor(look)), plateFile(name))
    }
    rows.push({ name, look, before, after: boxDiff(master, readRgb(plateFile(name)), inner) })
  }

  for (const [name, build] of Object.entries(DERIVED)) {
    const inner = core(REGIONS[PLATES[name]])
    const before = existsSync(join(ORIG, `${name}.jpg`))
      ? boxDiff(master, readRgb(join(ORIG, `${name}.jpg`)), inner)
      : 0
    if (!check) writeJpeg(build(master), plateFile(name))
    rows.push({ name, look: 'derived', before, after: boxDiff(master, readRgb(plateFile(name)), inner) })
  }

  for (const { name, look, before, after } of rows) {
    const drop = before > 0.05 ? ` (${(100 * (1 - after / before)).toFixed(0)}% closer)` : ''
    console.log(`  ${name.padEnd(20)} ${look.padEnd(8)} ${before.toFixed(2).padStart(6)} -> ${after.toFixed(2).padStart(5)}${drop}`)
  }

  console.log('')
  console.log('worst costume-core difference after locking:',
    Math.max(...rows.filter((r) => r.look !== 'derived').map((r) => r.after)).toFixed(2))
  if (!check) {
    console.log('originals kept in clipsrc/unlocked/, so this re-runs from source')
    console.log('now rebuild: FORCE=1 node scripts/build-clips.mjs')
  }
}
