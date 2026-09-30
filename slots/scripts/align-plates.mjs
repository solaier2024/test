#!/usr/bin/env node
/*
 * Registers every plate to the first one.
 *
 * The plates come out of an image model conditioned on an approved plate, which
 * holds the machine to within a handful of pixels but not to zero. On the other
 * tables in this series a few pixels of drift is a costume that appears to
 * breathe; here it is worse, because the reel window is a HOLE the DOM bands
 * show through. Ten pixels of drift on one plate is the bands sliding out from
 * under the brass - and since which plate is showing depends on what the crowd
 * is doing, it would only happen on a groan, or only on a cheer.
 *
 * Optical flow makes it worse again: morphing between two plates whose castings
 * do not agree renders the whole machine sliding sideways.
 *
 * So the pipeline registers them instead of tolerating them. Translation only -
 * the casting does not change size between plates, and a scale search that is
 * not needed is a scale search that will eventually find something.
 *
 *   node scripts/align-plates.mjs
 *
 * Output goes to clipsrc/aligned/, which is what build-clips.mjs reads. Every
 * plate INCLUDING the reference takes the same crop and rescale, so the framing
 * stays identical across the set and the geometry in src/machine.ts describes
 * all of them or none of them.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { H, W, bestShift, cost, luma } from './lib/register.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'clipsrc')
const OUT = join(SRC, 'aligned')

/** The reference, and the plate every clip starts and ends on. */
const REFERENCE = 'machine_rest'
const PLATES = ['machine_rest', 'machine_breath', 'machine_pull', 'machine_lean', 'machine_roar', 'machine_sigh']

/** Bigger than any drift seen so far, small enough that the search stays cheap. */
const RANGE = 14
/** Trimmed off every plate after shifting, so none of them shows a black edge. */
const MARGIN = 18

/*
 * NOTHING COSMETIC HAPPENS IN THIS SCRIPT, and that is a rule rather than an
 * omission. Grain removal used to live here and it caused a real bug: the glass
 * that verify-window.mjs measures came out 46px narrower once a denoise filter
 * was added, because the filter lifted the darkest pixels at the right edge of
 * the pane over the detector's threshold. Nothing about the picture had moved.
 *
 * So this stage is geometry only and its output is the thing geometry is
 * measured on. Appearance is build-clips.mjs's business, applied per frame on
 * the way to the encoder.
 */

/** Plates are authored as JPEG, like the sibling projects; accept either. */
function src(name) {
  for (const ext of ['.png', '.jpg']) {
    const p = join(SRC, name + ext)
    if (existsSync(p)) return p
  }
  throw new Error(`missing plate ${join(SRC, name)}.{png,jpg}`)
}

mkdirSync(OUT, { recursive: true })
const ref = luma(src(REFERENCE))

console.log('plate                dx   dy   residual   before')
for (const name of PLATES) {
  const path = src(name)
  const cand = name === REFERENCE ? ref : luma(path)
  const { dx, dy, cost: after } = name === REFERENCE ? { dx: 0, dy: 0, cost: 0 } : bestShift(ref, cand, RANGE)
  const before = name === REFERENCE ? 0 : cost(ref, cand, 0, 0)

  /*
   * Shift into a padded frame, then take the same crop off every plate and
   * scale back up. Uniform, so the set stays mutually consistent - which is the
   * property that matters here, not preserving the last two percent of frame.
   */
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error', '-i', path,
      '-vf',
      `pad=${W + 2 * RANGE}:${H + 2 * RANGE}:${RANGE}:${RANGE}:color=black,` +
        `crop=${W}:${H}:${RANGE - dx}:${RANGE - dy},` +
        `crop=${W - 2 * MARGIN}:${H - 2 * MARGIN}:${MARGIN}:${MARGIN},` +
        `scale=${W}:${H}:flags=lanczos`,
      '-pix_fmt', 'rgb24',
      join(OUT, `${name}.png`),
    ],
    { stdio: 'inherit' },
  )

  console.log(
    `${name.padEnd(18)} ${String(dx).padStart(3)} ${String(dy).padStart(4)} ` +
      `${after.toFixed(2).padStart(10)} ${before.toFixed(2).padStart(8)}`,
  )
}

/* The opening shots are their own cameras, so there is nothing to register them
 * against - they are copied through at the working size and nothing else. */
for (const name of ['intro_bar', 'intro_room', 'intro_band']) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src(name),
    '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgb24', join(OUT, `${name}.png`)], { stdio: 'inherit' })
}

console.log(`\n${PLATES.length} plates registered -> ${OUT}`)
