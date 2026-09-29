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
 * 3. THE STRAP STAYS DOWN. The one costume detail a generator reaches to "fix",
 *    and the only one a fixed box can judge on a body that moves. See LIMIT.
 * 4. THE ROOM STAYS STILL. The bottles, lamp, crate and baize must not move. This
 *    is the defect that made the displacement-field idle loop read as unnatural:
 *    the room breathed with her at half her own amplitude. Asked two ways - do
 *    those pixels change, and do they shift - because a camera move can slip past
 *    the first question and is the loudest possible answer to the second.
 * 5. SHE IS ACTUALLY ALIVE. The opposite failure: a clip that satisfies 1-4 by
 *    simply not moving. Her face has to change.
 *
 *   node scripts/verify-generated.mjs                        # the shipped set
 *   node scripts/verify-generated.mjs <clip.mp4> [more.mp4]  # a candidate take
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MASTER, REGIONS, boxDiff, core, plateFile, readRgb } from './lock-costume.mjs'

const GEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'clipsrc', 'openart')

const W = 1280
const H = 720
const FRAME = W * H * 3

/** Where she is, and where the room is. Placed off the master plate. */
const HER = {
  costume: core(REGIONS.torso),
  /* The slipped left shoulder strap - the detail a generator reaches to "fix". */
  strap: { x: 430, y: 225, w: 110, h: 100 },
  face: { x: 560, y: 90, w: 160, h: 130 },
  /* Her right hand where it rests on the baize, beside the card shoe. */
  hands: { x: 700, y: 480, w: 180, h: 100 },
}

/*
 * Hand movement is printed rather than required, and no clip in the set uses it.
 *
 * Four takes went into trying. The model will move her hands on request - 23.77
 * and 41.88 against a 2.4 noise floor - and it cannot do it without breaking
 * something else. Asked to riffle a deck, it conjured one out of empty air,
 * melted her fingers into a red block and vanished it again; asked to work the
 * card shoe that is really in the plate, it fused her fingers into the wood; and
 * on two of the three takes her shoulder came up and took the slipped strap with
 * it, which fails the check below and breaks the loop. There is nothing in the
 * source photograph for a hand to hold, and that is the root of it.
 *
 * So deal and shuffle are attention beats now - her eyes follow the card out, and
 * she asks for a moment between shoes - and the cards stay what they always were,
 * which is the game's own elements animating over the top. Her hands never leave
 * the felt in any clip, so a figure above about 3 here means something has changed
 * and wants looking at.
 */
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
 * Which of those to run an alignment search on, and why not all of them.
 *
 * The room check below compares pixels in place, which answers "did this change?"
 * but not "did it move?", and those come apart badly on a camera move: a one-pixel
 * pan of a dark flat wall barely shifts a mean, and a one-pixel pan of the whole
 * room is the most visible defect there is. So these boxes also get searched for
 * the integer offset that best puts them back on their own first frame, which must
 * be exactly zero. A zoom shows up as well as a pan, because a zoom displaces boxes
 * at different distances from the frame centre by different amounts.
 *
 * That is not a theoretical gap. Re-encoding idle.mp4 through a deliberate two
 * pixel circular crop drift leaves three of the six room boxes below their in-place
 * budget - the baize at 4.30 against a limit of 6, because a flat expanse of green
 * weave looks much the same one pixel over - while all five patches here report the
 * pan. Every honest clip in the set comes back at exactly 0px on all five.
 *
 * The oil lamp sits this one out. It is the one piece of furniture whose light is
 * supposed to change - the flame flickers in every clip - and a brightness swing
 * that large can pull a sum-of-squares minimum off a true zero. Its position is
 * still covered in place by the room budget.
 */
const ALIGN = ['bottles left', 'bottles right', 'dice cup', 'chips', 'baize']

/*
 * Budgets. A JPEG round trip of the master against itself is about 0.85, and these
 * clips arrive as h264, so the floor is a little higher than that.
 */
const LIMIT = {
  /** Frame 0 against the master. Generous: the encoder gets a first frame too. */
  start: 6,
  /** Last frame against frame 0. */
  loop: 6,
  /*
   * The strap is the assertion, and it earned that place by catching a defect a
   * human eye had already passed.
   *
   * The one detail generators cannot leave alone is the strap slipped down off her
   * left shoulder: it reads to a model as a mistake to be tidied up. Veo pulled it
   * up, and so did a take of the deal clip - at 00:02, after which it stayed up
   * through the final frame, which also breaks the loop. That take scored 24.96
   * here while every clean clip sat at or under 10.70.
   *
   * It was very nearly thrown away. Cropping the worst frame of the bodice box
   * showed the same satin, the same lace and the strap still down, which looked
   * like the metric being over-sensitive to a body that had simply moved. It was
   * not: the crop was of frame 44 and the strap does not snap up until frame 60.
   * The number was right and the spot-check was too coarse. Hence 14 - wide of the
   * 10.70 the honest clips reach, and nowhere near the 24.96 of one that lies.
   */
  strap: 14,
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
}

/*
 * How far the alignment search looks. A clip only has to be off by one to fail, so
 * this is about reporting an honest magnitude, not about detection - and every
 * shift costs (2R+1)^2 passes over the box. verify-still.mjs searches wider because
 * on the page there was a real 11px defect to size up.
 */
const R = 4

const lumaAt = (buf, x, y) => {
  const i = (y * W + x) * 3
  return 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
}

/*
 * The offset that best puts box `b` back on box `a`. Every second pixel in each
 * direction is enough - a shift is a property of the whole box, not of any one
 * pixel - and it makes the search four times cheaper.
 */
function bestShift(a, b, box) {
  let best = { dx: 0, dy: 0, err: Infinity }
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let sum = 0
      for (let y = box.y; y < box.y + box.h; y += 2) {
        for (let x = box.x; x < box.x + box.w; x += 2) {
          const d = lumaAt(a, x, y) - lumaAt(b, x + dx, y + dy)
          sum += d * d
        }
      }
      if (sum < best.err) best = { dx, dy, err: sum }
    }
  }
  return best
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

const paths = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(GEN).filter((f) => f.endsWith('.mp4')).sort().map((f) => join(GEN, f))

for (const path of paths) {
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
  const alive = worst(HER.face)
  const strap = worst(HER.strap)
  console.log(`  costume, worst frame vs master    ${worst(HER.costume).toFixed(2).padStart(6)}  (reported only)`)
  console.log(`  left strap stays slipped down     ${strap.toFixed(2).padStart(6)}  (limit ${LIMIT.strap})   ${strap <= LIMIT.strap ? 'down' : 'RIDES UP'}`)
  console.log(`  her face, worst frame vs master   ${alive.toFixed(2).padStart(6)}  (needs > ${LIMIT.alive})   ${alive >= LIMIT.alive ? 'alive' : 'A PHOTOGRAPH'}`)
  if (strap > LIMIT.strap) fail.push(`${name}: the left strap rides up onto her shoulder (${strap.toFixed(2)})`)
  if (alive < LIMIT.alive) fail.push(`${name}: she barely moves (${alive.toFixed(2)})`)

  const gesture = Math.max(...f.map((fr) => boxDiff(f[0], fr, HER.hands)))
  console.log(`  her hands stay on the felt        ${gesture.toFixed(2).padStart(6)}  (reported only)`)

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

  /*
   * Every third frame. A camera does not pan for one frame and come back, so the
   * search does not need every frame to find one - and this is the expensive check.
   */
  let worstShift = 0
  let where = ''
  for (const label of ALIGN) {
    const box = ROOM[label]
    let shift = 0
    for (let i = 3; i < f.length; i += 3) {
      const { dx, dy } = bestShift(f[0], f[i], box)
      shift = Math.max(shift, Math.abs(dx), Math.abs(dy))
    }
    if (shift > worstShift) {
      worstShift = shift
      where = label
    }
    console.log(`  locked: ${label.padEnd(14)} worst offset back to frame 0 ${String(shift).padStart(2)}px   ${shift === 0 ? 'bolted down' : 'PANS'}`)
  }
  if (worstShift > 0) fail.push(`${name}: the camera moves - ${where} is off by ${worstShift}px`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: starts on the plate, closes, costume holds, camera bolted down, and she moves')
