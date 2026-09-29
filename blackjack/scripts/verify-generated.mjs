#!/usr/bin/env node
/*
 * Is a generated clip usable as the dealer layer?
 *
 * The plate-and-optical-flow pipeline had its own assertions; a generated video
 * needs different ones, because the failure modes are different. A generator does
 * not drift a neckline by 8px - it redesigns the garment, walks the camera, or
 * decides the bottles behind her should sway. So this measures the five things
 * that decide whether a clip can be dropped into the existing video layer:
 *
 * 1. IT STARTS ON OUR PLATE. The clip is submitted with the master as startFrame,
 *    which is the only reason the costume is locked at all. If frame 0 is not the
 *    master, nothing downstream is guaranteed.
 * 2. THE LOOP CLOSES. Submitted with the master as endFrame too, so the last frame
 *    has to come back. This is what lets the idle clip loop without a crossfade.
 * 3. THE COSTUME HOLDS. Worst deviation of the costume box from the master over
 *    every frame - the generator adding fabric or moving a strap shows up here.
 * 4. THE ROOM STAYS STILL. The bottles, lamp, crate and baize must not move. This
 *    is the defect that made the displacement-field idle loop read as unnatural:
 *    the room breathed with her at half her own amplitude.
 * 5. SHE IS ACTUALLY ALIVE. The opposite failure: a clip that satisfies 1-4 by
 *    simply not moving. Her face has to change.
 *
 *   node scripts/verify-generated.mjs <clip.mp4> [more.mp4 ...]
 */
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { MASTER, REGIONS, boxDiff, core, plateFile, readRgb } from './lock-costume.mjs'

const W = 1280
const H = 720
const FRAME = W * H * 3

/** Where she is, and where the room is. Placed off the master plate. */
const HER = {
  costume: core(REGIONS.torso),
  face: { x: 560, y: 90, w: 160, h: 130 },
  /* Her right hand where it rests on the baize, beside the card shoe. */
  hands: { x: 700, y: 480, w: 180, h: 100 },
}

/*
 * Clips whose whole point is the hands. A shuffle in which her face twitches and
 * her hands never leave the felt passes a face-only check and is still the wrong
 * clip, so these have to be named.
 */
const HAND_CLIPS = ['deal', 'shuffle']
/*
 * Objects that must not move, all of them placed clear of her. Two of these were
 * wrong on the first pass and both errors read as a defect in the clip rather
 * than in the box: one overlapped her hair, so a nod scored as the shelf swaying,
 * and one sat on the card shoe, which is exactly where the dealing hand goes.
 */
const ROOM = {
  'bottles left': { x: 320, y: 100, w: 100, h: 200 },
  'bottles right': { x: 820, y: 100, w: 120, h: 200 },
  'oil lamp': { x: 70, y: 80, w: 90, h: 110 },
  'dice cup': { x: 1055, y: 500, w: 90, h: 140 },
  chips: { x: 10, y: 555, w: 120, h: 100 },
  baize: { x: 250, y: 570, w: 250, h: 100 },
}

/*
 * Budgets. A JPEG round trip of the master against itself is about 0.85, and these
 * clips arrive as h264, so the floor is a little higher than that.
 */
const LIMIT = {
  /** Frame 0 against the master. Generous: the encoder gets a first frame too. */
  start: 6,
  /** Last frame against frame 0. */
  loop: 6,
  /** Worst costume deviation from the master, any frame. */
  costume: 14,
  /*
   * Worst room movement, any frame. Her breath must not reach the furniture.
   *
   * 6 rather than something tighter because that is where the noise floor
   * actually is, measured rather than guessed: the chip stacks score 4.41 on the
   * idle clip and a crop of the worst frame against the first shows them in
   * identical positions, differing only in the speckle along the chip edges. The
   * defect this is here to catch - Veo swaying the shelf - scored 14.29.
   */
  room: 6,
  /** Her face has to move at least this much somewhere, or she is a photograph. */
  alive: 4,
  /** And on a hand clip, the hands have to actually leave the felt. */
  gesture: 6,
}

const master = readRgb(plateFile(MASTER))

const frames = (path) => {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: FRAME * 600 },
  )
  const out = []
  for (let i = 0; i + FRAME <= raw.length; i += FRAME) out.push(raw.subarray(i, i + FRAME))
  return out
}

const fail = []

for (const path of process.argv.slice(2)) {
  const name = basename(path)
  const f = frames(path)
  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path,
  ]).toString().trim()

  console.log(`\n${'='.repeat(72)}\n${name}   ${probe}   ${f.length} frames\n`)

  const start = boxDiff(master, f[0], { x: 0, y: 0, w: W, h: H })
  const loop = boxDiff(f[0], f[f.length - 1], { x: 0, y: 0, w: W, h: H })
  console.log(`  starts on the master plate        ${start.toFixed(2).padStart(6)}  (limit ${LIMIT.start})   ${start <= LIMIT.start ? 'yes' : 'NO'}`)
  console.log(`  last frame back to the first      ${loop.toFixed(2).padStart(6)}  (limit ${LIMIT.loop})   ${loop <= LIMIT.loop ? 'closed' : 'OPEN'}`)
  if (start > LIMIT.start) fail.push(`${name}: frame 0 is not the master (${start.toFixed(2)})`)
  if (loop > LIMIT.loop) fail.push(`${name}: the loop does not close (${loop.toFixed(2)})`)

  // Worst case over every frame, not the mean: one frame with a redesigned bodice
  // is a visible pop, and a mean would bury it.
  const worst = (box) => Math.max(...f.map((fr) => boxDiff(master, fr, box)))
  const costume = worst(HER.costume)
  const alive = worst(HER.face)
  console.log(`  costume, worst frame vs master    ${costume.toFixed(2).padStart(6)}  (limit ${LIMIT.costume})   ${costume <= LIMIT.costume ? 'holds' : 'DRIFTED'}`)
  console.log(`  her face, worst frame vs master   ${alive.toFixed(2).padStart(6)}  (needs > ${LIMIT.alive})   ${alive >= LIMIT.alive ? 'alive' : 'A PHOTOGRAPH'}`)
  if (costume > LIMIT.costume) fail.push(`${name}: the costume drifted (${costume.toFixed(2)})`)
  if (alive < LIMIT.alive) fail.push(`${name}: she barely moves (${alive.toFixed(2)})`)

  const gesture = Math.max(...f.map((fr) => boxDiff(f[0], fr, HER.hands)))
  const handClip = HAND_CLIPS.some((c) => name.startsWith(c))
  console.log(`  her hands move                    ${gesture.toFixed(2).padStart(6)}  ${handClip ? `(needs > ${LIMIT.gesture})   ${gesture >= LIMIT.gesture ? 'gestures' : 'HANDS NEVER MOVE'}` : '(not a hand clip)'}`)
  if (handClip && gesture < LIMIT.gesture) fail.push(`${name}: the hands never move (${gesture.toFixed(2)})`)

  /*
   * Two different questions about the room, and only the second one is a defect.
   *
   *   vs master  - how far the generator's render of a static object is from our
   *                JPEG of it. A constant offset here is re-encoding, not motion:
   *                the clip arrives as h264 at 1080p and gets scaled to 720p, so
   *                bottle highlights and baize weave land a level or two off.
   *   vs frame 0 - how far the object departs from its own first frame. THAT is
   *                movement, and it is the thing that made the old displacement
   *                field read as unnatural: the shelf breathed with her.
   */
  console.log('')
  let worstRoom = 0
  for (const [label, box] of Object.entries(ROOM)) {
    const render = worst(box)
    const moved = Math.max(...f.map((fr) => boxDiff(f[0], fr, box)))
    if (moved > worstRoom) worstRoom = moved
    console.log(`  room: ${label.padEnd(15)} render ${render.toFixed(2).padStart(5)}   moves ${moved.toFixed(2).padStart(5)}  (limit ${LIMIT.room})   ${moved <= LIMIT.room ? 'still' : 'MOVING'}`)
  }
  if (worstRoom > LIMIT.room) fail.push(`${name}: the room moves (${worstRoom.toFixed(2)})`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: starts on the plate, closes, costume holds, room still, and she moves')
