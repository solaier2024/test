#!/usr/bin/env node
/*
 * Every clip has to start and end on a picture that already exists as a still.
 *
 *   npm run verify:identity
 *
 * This is VIDEO.md section 6 - "把第一帧锁死在已批准的成片上" - turned into a
 * check. That section asks for the first frame to be locked to an approved
 * plate so drift is bounded inside one clip. This table needs the same thing
 * at the other end too, and for a reason specific to how it plays:
 *
 * Scene.tsx runs the clip over the plate and then DROPS the clip, revealing
 * whatever plate is underneath. If the last frame of sigh_held is not the
 * machine_sigh plate, the room changes in one frame at the moment the video
 * goes away - and it goes away at a time the engine chose, so there is no
 * dissolve to hide it behind. A clip that ends on the wrong picture is not a
 * slightly worse clip; it is a visible cut in the middle of a reaction.
 *
 * What it would catch, in rough order of how likely it is:
 *
 *   - a generated take that drifted off its conditioning. The model is ASKED
 *     for both endpoints and mostly obliges, and "mostly" is the problem.
 *   - a clip rebuilt after its plate was re-rendered, or not rebuilt after it
 *     was. The plates are a build product; the footage is a source asset;
 *     nothing else notices when they stop agreeing.
 *   - a wiring mistake in App.tsx's CROWD_CLIP: playing a from-resting clip
 *     while the room is already leaning is exactly a first-frame mismatch,
 *     and it reads to a player as the video glitching rather than as a bug.
 *
 * The expectations are read from clipsrc/generated.json rather than written
 * out again here, because that file is where the two plates were named when
 * the footage was ordered. Checking a clip against a second copy of its own
 * intention is not checking anything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { H, ROI, W } from './lib/register.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIPS = join(ROOT, 'public', 'clips')

/*
 * Prefer the plate the browser is actually shown, because the thing being
 * checked is whether the handover from clip to plate is visible - and what
 * the player sees is the JPEG, codec loss and all.
 *
 * Not every plate is one of those. machine_pull only ever exists at the
 * bottom of the lever's arc, inside the pull and release clips, so it is
 * never served and public/art/ has no copy of it. For those the registered
 * plate in clipsrc/aligned/ is the approved picture, which is what the
 * conditioning used anyway.
 */
const plateFor = (name) => {
  for (const p of [join(ROOT, 'public', 'art', `${name}.jpg`), join(ROOT, 'clipsrc', 'aligned', `${name}.png`)]) {
    if (existsSync(p)) return p
  }
  throw new Error(`no plate named ${name}; run npm run clips`)
}

/*
 * Two thresholds, doing two different jobs. Both are mean absolute luma
 * difference on a 0-255 scale, and both numbers were set by measuring rather
 * than by picking something that sounded strict.
 *
 * CASTING covers the machine only, and it asks: IS THE LOCK STILL ON? Those
 * pixels are registered and rim-pinned frame by frame, so a reading much
 * above the codec's own noise means lib/lock.mjs has stopped working. It is
 * deliberately not the plate-identity check, because it cannot be one: the
 * machine looks the same in every plate, which is the entire point of it.
 *
 * WHOLE covers the frame, which means it covers the CROWD, and the crowd is
 * the only thing that differs between one plate and another. This is the one
 * that answers "is this the right picture".
 *
 * Every correct pairing, and then some deliberately wrong ones:
 *
 *                                         casting   whole
 *   correct, worst of the 16               5.18      3.44
 *   roar ending on the sigh plate         12.54     19.57   a wrong reaction
 *   roar_held starting from rest           9.21      8.19   a CROWD_CLIP slip
 *   sigh starting from lean                7.97      6.68   the same slip back
 *   idle starting from breath              4.87      2.85   invisible, below
 *
 * So WHOLE at 5 sits with 45% headroom over the worst honest reading and
 * still 25% under the closest dishonest one, and CASTING at 8 is loose enough
 * that it only fires when registration has actually failed.
 *
 * The last row is not a gap in the check, it is a gap that cannot exist:
 * machine_breath is a plate of the same room a moment later, drawn to be
 * almost the same picture, so "this clip used breath instead of rest" is a
 * statement with no observable consequence.
 */
const CASTING = 8
const WHOLE = 5

const manifest = JSON.parse(readFileSync(join(ROOT, 'clipsrc', 'generated.json'), 'utf8'))

/** Luma of one frame of a video, or of a plate, at working size. */
function luma(path, at) {
  const seek = at === 'last' ? ['-sseof', '-0.1'] : []
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', ...seek, '-i', path, '-frames:v', '1', '-vf', `scale=${W}:${H}`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1 << 28 },
  )
  /* -sseof lands on a keyframe boundary and can hand back more than one
   * frame; the last whole one is the one that was asked for. */
  if (raw.length % (W * H)) throw new Error(`${path}: ${raw.length} bytes is not whole frames`)
  return raw.subarray(raw.length - W * H)
}

const meanAbs = (a, b, region) => {
  let sum = 0
  let n = 0
  const { x0, x1, y0, y1 } = region ?? { x0: 0, x1: W - 1, y0: 0, y1: H - 1 }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++, n++) sum += Math.abs(a[y * W + x] - b[y * W + x])
  }
  return sum / n
}

let bad = 0
console.log(
  ['clip', 'end', 'plate', 'casting', 'whole'].map((s, i) => (i < 3 ? s.padEnd(16) : s.padStart(9))).join(''),
)

for (const [name, spec] of Object.entries(manifest.clips)) {
  // The opening is four moving-camera shots with nothing laid over them, so
  // it has no plate to hold to and no DOM to hold it for. See shotFrames.
  if (name.startsWith('intro_')) continue

  const clip = join(CLIPS, `${name}.webm`)
  if (!existsSync(clip)) {
    console.error(`  MISSING  ${name}.webm - run npm run clips`)
    bad++
    continue
  }

  for (const [end, plateName] of [['first', spec.from], ['last', spec.to]]) {
    if (!plateName) continue
    const a = luma(clip, end)
    const b = luma(plateFor(plateName))
    const casting = meanAbs(a, b, ROI)
    const whole = meanAbs(a, b)
    const over = casting > CASTING || whole > WHOLE
    if (over) bad++
    console.log(
      name.padEnd(16) + end.padEnd(16) + plateName.padEnd(16) +
        casting.toFixed(2).padStart(9) + whole.toFixed(2).padStart(9) + (over ? '   OFF' : ''),
    )
  }
}

if (bad) {
  console.error(`\n${bad} clip end(s) do not match the plate they were conditioned on`)
  process.exit(1)
}
console.log(`\nOK: every clip starts and ends on the plate it was ordered to`)
