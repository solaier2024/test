#!/usr/bin/env node
/*
 * The opening is four shots and four captions, and this asks the encoded film
 * which shot each caption actually lands on.
 *
 *   npm run verify:opening
 *
 * Two things made this worth writing.
 *
 * The first is that Intro.tsx has always CLAIMED this property - "captions are
 * placed by fraction of the clip rather than in seconds, so recutting the
 * opening cannot push a line onto the wrong shot" - and nothing measured it.
 * The claim is true about the arithmetic and says nothing about whether the
 * arithmetic still matches the film. Shot lengths come from whatever the video
 * model returned, the joins are one dissolve and two cuts of different
 * lengths, and the running order is a list in build-clips.mjs. Any of those
 * can move a boundary without touching the cue table.
 *
 * The second is that it happened, twice, in one revision. The opening was
 * recut - the exterior street shot came out and the machine moved to the end -
 * and this check caught two captions straddling the new joins on its first
 * run: line three came up 0.2s before the band appeared and line four came up
 * 0.75s before the machine did. Both would have shipped. Two comments
 * elsewhere in the project had ALREADY been wrong about which shot was third,
 * for a whole revision, for the same reason: nothing ever had to agree with
 * the film.
 *
 * WHY IT DOES NOT LOOK FOR CUTS. Detecting a boundary is the obvious approach
 * and it is the weaker one. A cut is a spike in frame difference, a dissolve
 * is not, and a slow dolly through a crowded room produces frame differences
 * of its own; a threshold that separates those is exactly the kind of number
 * that works on the film it was tuned on. So this does not look for
 * boundaries. Every shot in the opening comes from a source take that is still
 * on disk, so "which shot is on screen at time t" can be asked directly:
 * compare the frame to all four takes and see which one it came out of.
 *
 * That also turns out to be far sharper than comparing against the shots'
 * still plates, which was the first version of this. The two wides are the
 * same saloon photographed two ways, and halfway through a dolly a frame has
 * genuinely travelled away from the still it started on:
 *
 *                              right one   next best   margin
 *   against the still plates       19.6        22.8      1.16
 *   against the source takes        1.1        20.6     18.30
 *
 * Both orderings are correct. Only one of them is worth asserting. A margin of
 * 1.16 is a true statement about a coin flip; the takes make the same
 * statement with a factor of eighteen behind it, and no threshold had to be
 * chosen to get there.
 *
 * The expected order is written out below rather than imported, because here
 * it is the SPEC and not a duplicate: the requirement is that the opening
 * starts inside the saloon among people, teaches the bands, and ends on the
 * machine the next screen asks you to choose. The cue windows ARE imported,
 * from src/opening.ts, because those are the implementation's intention and a
 * check held against its own copy of that is not checking anything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CUES, TITLE_AT } from '../src/opening.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FILM = join(ROOT, 'public', 'clips', 'intro.webm')
const FPS = 24

/*
 * Small on purpose, and small enough that comparing every frame of the film to
 * every frame of four takes is a second of work. At this size the comparison
 * is about which ROOM is on screen, which is the question being asked, and not
 * about where anybody's hat is.
 */
const W = 64
const H = 36

/*
 * Shot order, and where each shot came from. This is the spec:
 *
 *   bar      inside already, in the loud hour, among a crowd
 *   room     down the room to the one knot of people not talking
 *   band     the macro that teaches where the odds live
 *   machine  the handover - the next screen asks which machine you want
 *
 * `take` is the generated footage the shot was cut from. `plate` is the still
 * it was conditioned on, and it is the reference in a checkout with no
 * generated footage, where buildOpening falls back to a zoompan move over the
 * still. That fallback has to keep working - a table you can play without a
 * network is a property this project pays for elsewhere - so this check has to
 * work in both states.
 */
const SHOTS = [
  { tag: 'bar', take: 'intro_bar', plate: join(ROOT, 'clipsrc', 'aligned', 'intro_bar.png') },
  { tag: 'room', take: 'intro_room', plate: join(ROOT, 'clipsrc', 'aligned', 'intro_room.png') },
  { tag: 'band', take: 'intro_band', plate: join(ROOT, 'clipsrc', 'aligned', 'intro_band.png') },
  { tag: 'machine', take: 'intro_machine', plate: join(ROOT, 'public', 'art', 'machine_rest.jpg') },
]

/*
 * How much closer the right reference has to be than the next best one.
 *
 * This is NOT the identity test - getting the shot wrong fails on the name,
 * not on the margin. What the margin catches is a sample taken inside a
 * transition, where the frame is a blend of two takes and is honestly about
 * equidistant from both, so the winner is noise. That puts the failure mode at
 * a margin near 1.0 and every honest reading well above it.
 *
 * Measured over all thirteen sample points of this film:
 *
 *                     worst honest   a dissolve midpoint
 *   against takes            12.0                   ~1.0
 *   against plates            1.14                  ~1.0
 *
 * So the takes get 4, which is three times clear of an ambiguous reading and
 * three times under the worst honest one. The plates cannot be given a useful
 * floor at all - 1.14 leaves no room between honest and ambiguous - so on that
 * path the margin is reported and not enforced, and the check is only the
 * identity. That is a real difference in how much the two paths prove, and
 * printing which reference was used is how it stays visible.
 */
const MARGIN = 4

/** Where inside a caption's window to sample. Not the edges: a window sits
 *  inside its shot, but there is no reason to spend the check's teeth
 *  measuring how close to a join the cue table dares to put a line. */
const SAMPLE_AT = [0.3, 0.5, 0.7]

if (!existsSync(FILM)) {
  console.error(`no ${FILM} - run npm run clips`)
  process.exit(1)
}

const gray = (args) =>
  execFileSync('ffmpeg', ['-v', 'error', ...args, '-vf', `scale=${W}:${H}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 })

const split = (buf) => {
  if (buf.length % (W * H)) throw new Error(`${buf.length} bytes is not whole frames`)
  const out = []
  for (let i = 0; i < buf.length / (W * H); i++) out.push(buf.subarray(i * W * H, (i + 1) * W * H))
  return out
}

const film = split(gray(['-i', FILM]))

let fromTakes = true
const references = SHOTS.map((s) => {
  const mp4 = join(ROOT, 'clipsrc', 'generated', `${s.take}.mp4`)
  if (existsSync(mp4)) return split(gray(['-i', mp4]))
  if (!existsSync(s.plate)) {
    console.error(`no footage and no plate for ${s.tag} - run npm run clips`)
    process.exit(1)
  }
  fromTakes = false
  return split(gray(['-i', s.plate]))
})

const distance = (a, b) => {
  let sum = 0
  for (let i = 0; i < W * H; i++) sum += Math.abs(a[i] - b[i])
  return sum / (W * H)
}

/** Which shot the frame at this fraction of the film came out of, and by how much. */
function identify(fraction) {
  const at = Math.min(film.length - 1, Math.max(0, Math.round(fraction * (film.length - 1))))
  const frame = film[at]
  const d = references.map((set) => Math.min(...set.map((f) => distance(frame, f))))
  const order = d.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
  return { at, d, best: order[0][1], margin: order[1][0] / Math.max(0.001, order[0][0]) }
}

const line = (label, { at, d, best, margin }, want) => {
  const wrong = best !== want || (fromTakes && margin < MARGIN)
  console.log(
    label.padEnd(9) + `${(at / FPS).toFixed(2).padStart(6)}s  ` +
      d.map((v) => v.toFixed(1).padStart(8)).join('') +
      `   ${SHOTS[best].tag.padStart(8)}${margin.toFixed(1).padStart(8)}` +
      (wrong ? `   WRONG, wanted ${SHOTS[want].tag}` : ''),
  )
  return wrong ? 1 : 0
}

let bad = 0
console.log(
  `${film.length} frames, ${(film.length / FPS).toFixed(2)}s at ${FPS}fps, ` +
    `against the ${fromTakes ? 'source takes' : 'still plates (no generated footage here)'}\n`,
)
console.log('caption      at  ' + SHOTS.map((s) => s.tag.padStart(8)).join('') + '   reads as  margin')

CUES.forEach(([a, b], i) => {
  for (const where of SAMPLE_AT) bad += line(String(i + 1), identify(a + (b - a) * where), i)
})

/* The card is the last thing in the film and it belongs over the machine,
 * because the screen it hands over to asks which machine you want. */
console.log('')
bad += line('title', identify((TITLE_AT + 1) / 2), SHOTS.length - 1)

if (bad) {
  console.error(`\n${bad} caption(s) land on the wrong shot`)
  process.exit(1)
}
console.log(
  `\nOK: ${CUES.length} shots, all of them inside the saloon, ` +
    'each caption on the shot it was written for, and the film ends on the machine',
)
