#!/usr/bin/env node
/*
 * Turns the still keyframes in public/art/ and clipsrc/ into the short video
 * clips the table plays.
 *
 * Every plate is rendered from the same locked-off camera, so two plates that
 * differ by one movement are exactly the input dense optical flow wants:
 *
 *   keyframe pair -> ffmpeg minterpolate -> resample through an easing curve
 *                 -> VP9 / H.264 at two sizes + a poster frame
 *
 *   node scripts/build-clips.mjs            # everything
 *   node scripts/build-clips.mjs deal       # just these
 *   FORCE=1 node scripts/build-clips.mjs    # ignore the cache
 *
 * Three things this has to get right, all learned the hard way on the sibling
 * project and kept here deliberately:
 *
 * 1. minterpolate throws away the first and last input interval, so the input
 *    is padded to [a, b, b]. That leaves one interval to render and yields
 *    exactly steps+1 frames. Anything else silently changes the frame count.
 * 2. The image2 demuxer reads the extension, not the bytes, so a JPEG staged as
 *    .png is dropped without an error and the clip quietly comes out short.
 *    Every frame goes through normalised() first, and the count is asserted.
 * 3. Optical flow is expensive and retiming should not pay for it twice: one
 *    48-step dense morph per pair is cached, and every timing is a resample of
 *    that curve.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ART = join(ROOT, 'public', 'art')
const SRC = join(ROOT, 'clipsrc')
const OUT = join(ROOT, 'public', 'clips')
const CACHE = join(ROOT, 'node_modules', '.clipcache')

const FPS = 30
const W = 1280
const H = 720
const SMALL_W = 768
const SMALL_H = 432

const force = process.env.FORCE === '1'
const only = process.argv.slice(2)

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

/** A keyframe, by bare name, from either source directory. */
function plate(name) {
  for (const dir of [SRC, ART]) {
    for (const ext of ['.jpg', '.png']) {
      const p = join(dir, name + ext)
      if (existsSync(p)) return p
    }
  }
  throw new Error(`no keyframe named ${name}`)
}

const digest = (...parts) =>
  createHash('sha1')
    .update(parts.map((p) => (existsSync(String(p)) ? readFileSync(p) : String(p))).join('\0'))
    .digest('hex')
    .slice(0, 12)

/** Every frame reaching the image demuxer has to be a real PNG at working size. */
function normalised(path) {
  const out = join(CACHE, 'norm', `${digest(path)}.png`)
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true })
    ff(['-i', path, '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgb24', out])
  }
  return out
}

/** Synthesises `steps` frames of motion from a to b and returns their paths. */
function morph(a, b, steps) {
  const dir = join(CACHE, `morph-${digest(a, b, steps)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length === steps + 1) {
    return readdirSync(dir)
      .sort()
      .map((f) => join(dir, f))
  }

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const stage = mkdtempSync(join(tmpdir(), 'morph-'))
  cpSync(normalised(a), join(stage, 'in0.png'))
  cpSync(normalised(b), join(stage, 'in1.png'))
  cpSync(normalised(b), join(stage, 'in2.png'))

  ff([
    '-framerate', '1',
    '-start_number', '0',
    '-i', join(stage, 'in%d.png'),
    '-vf', `minterpolate=fps=${steps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir:search_param=48`,
    join(dir, '%04d.png'),
  ])
  rmSync(stage, { recursive: true, force: true })

  const frames = readdirSync(dir).sort().map((f) => join(dir, f))
  if (frames.length !== steps + 1) {
    throw new Error(`morph ${a} -> ${b} produced ${frames.length} frames, wanted ${steps + 1}`)
  }
  return frames
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const easeOut = (t) => 1 - (1 - t) ** 3
const linear = (t) => t
const EASES = { easeInOut, easeOut, linear }

/**
 * Builds a frame list from a timeline of holds and moves. The dense morph is
 * synthesised once and then sampled through an easing curve, so retiming a beat
 * costs nothing and never re-runs the optical flow.
 */
function timeline(steps) {
  const frames = []
  for (const step of steps) {
    if (step.hold) {
      const at = normalised(plate(step.hold))
      for (let i = 0; i < step.frames; i++) frames.push(at)
      continue
    }
    const dense = morph(plate(step.from), plate(step.to), 48)
    const ease = EASES[step.ease ?? 'easeInOut']
    for (let i = 0; i < step.frames; i++) {
      const t = step.frames === 1 ? 1 : i / (step.frames - 1)
      frames.push(dense[Math.round(ease(t) * (dense.length - 1))])
    }
  }
  return frames
}

function stageFrames(frames) {
  const stage = mkdtempSync(join(tmpdir(), 'clip-'))
  frames.forEach((f, i) => cpSync(f, join(stage, `${String(i).padStart(5, '0')}.png`)))
  return stage
}

function encode(name, frames) {
  const stage = stageFrames(frames)
  const input = ['-framerate', String(FPS), '-i', join(stage, '%05d.png')]

  for (const [suffix, w, h, crf, bitrate] of [
    ['', W, H, 34, '0'],
    ['.sm', SMALL_W, SMALL_H, 38, '0'],
  ]) {
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', bitrate,
      '-row-mt', '1', '-an', join(OUT, `${name}${suffix}.webm`)])
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libx264', '-crf', String(crf - 6),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(OUT, `${name}${suffix}.mp4`)])
  }
  // Poster is the clip's own first frame, so the still underneath matches it.
  ff(['-i', join(stage, '00000.png'), '-vf', `scale=${W}:${H}`, '-q:v', '4', join(OUT, `${name}.jpg`)])
  rmSync(stage, { recursive: true, force: true })

  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-count_frames', '-of', 'csv=p=0',
    join(OUT, `${name}.webm`)]).toString().trim()
  if (Number(probe) !== frames.length) {
    throw new Error(`${name}: encoded ${probe} frames, staged ${frames.length}`)
  }
  return Number(probe)
}

/*
 * The table's whole vocabulary. Her movements are orthogonal to the cards, so
 * no matter what is dealt she only ever does these things - which is the reason
 * a video-based blackjack table is affordable at all.
 *
 * Every clip starts and ends on the same resting plate, so the resting pose is
 * the hub of a star: N clips instead of N squared, and any two movements join
 * through the pose the still underneath is already showing.
 */
const CLIPS = {
  /* She slides a card across. The hand is furthest out at the moment the card
   * touches the felt (CARD_LANDS_AT in the engine), then withdraws. */
  deal: [
    { from: 'dealer_cool', to: 'dealer_deal', frames: 15, ease: 'easeOut' },
    { hold: 'dealer_deal', frames: 2 },
    { from: 'dealer_deal', to: 'dealer_cool', frames: 6, ease: 'easeInOut' },
  ],
  /* The cut card came up. This doubles as the seam the score changes phrase on. */
  shuffle: [
    { from: 'dealer_cool', to: 'dealer_shuffle', frames: 14, ease: 'easeOut' },
    { hold: 'dealer_shuffle', frames: 4 },
    { from: 'dealer_shuffle', to: 'dealer_cool', frames: 14, ease: 'easeInOut' },
    { hold: 'dealer_cool', frames: 3 },
  ],
  warm: [
    { from: 'dealer_cool', to: 'dealer_warm', frames: 18, ease: 'easeOut' },
    { hold: 'dealer_warm', frames: 6 },
  ],
  sharp: [
    { from: 'dealer_cool', to: 'dealer_sharp', frames: 14, ease: 'easeOut' },
    { hold: 'dealer_sharp', frames: 6 },
  ],
  cool: [
    { from: 'dealer_warm', to: 'dealer_cool', frames: 16, ease: 'easeInOut' },
  ],
  /* Not a dissolve. Caught is a cut hidden under the room going quiet. */
  caught: [
    { from: 'dealer_cool', to: 'dealer_caught', frames: 5, ease: 'easeOut' },
    { hold: 'dealer_caught', frames: 22 },
  ],
  /*
   * The hardest clip to do without: the one the table sits on between hands.
   *
   * The first cut of this held a single plate for four and a half of its five
   * seconds and only blinked, and on a recording it read as a photograph. It now
   * breathes the whole way through - an inhale plate morphed in and back out, so
   * something is moving in every frame - with the blinks landing inside it.
   */
  idle: [
    { from: 'dealer_cool', to: 'dealer_breath', frames: 44, ease: 'easeInOut' },
    { from: 'dealer_breath', to: 'dealer_cool', frames: 50, ease: 'easeInOut' },
    { from: 'dealer_cool', to: 'dealer_cool_blink', frames: 3, ease: 'linear' },
    { from: 'dealer_cool_blink', to: 'dealer_cool', frames: 4, ease: 'linear' },
    { from: 'dealer_cool', to: 'dealer_breath', frames: 46, ease: 'easeInOut' },
    { from: 'dealer_breath', to: 'dealer_cool', frames: 52, ease: 'easeInOut' },
    { from: 'dealer_cool', to: 'dealer_cool_blink', frames: 3, ease: 'linear' },
    { from: 'dealer_cool_blink', to: 'dealer_cool', frames: 4, ease: 'linear' },
  ],
}

/* ----------------------------------------------------------- the opening */

/**
 * A slow push on a single still, baked in rather than done with CSS so the cuts
 * stay on their marks however the page is scaled. Upscaling first keeps zoompan
 * from stepping in whole source pixels, which stutters.
 */
function pushIn(name, seconds, { from = 1.0, to = 1.09, panX = 0, panY = 0 } = {}) {
  const n = Math.round(seconds * FPS)
  const dir = join(CACHE, `push-${digest(plate(name), seconds, from, to, panX, panY)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length === n) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const z = `${from}+${(to - from).toFixed(5)}*on/${n}`
  const x = `iw/2-(iw/zoom/2)+(${panX.toFixed(4)})*iw*on/${n}`
  const y = `ih/2-(ih/zoom/2)+(${panY.toFixed(4)})*ih*on/${n}`
  ff([
    '-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', normalised(plate(name)),
    '-vf', `scale=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${FPS}`,
    '-frames:v', String(n),
    join(dir, '%04d.png'),
  ])
  const frames = readdirSync(dir).sort().map((f) => join(dir, f))
  if (frames.length !== n) throw new Error(`push ${name} produced ${frames.length} frames, wanted ${n}`)
  return frames
}

/** Encodes a frame list to a lossless intermediate so xfade can chain them. */
function intermediate(frames, tag) {
  const stage = stageFrames(frames)
  const out = join(CACHE, `seg-${tag}.mkv`)
  ff(['-framerate', String(FPS), '-i', join(stage, '%05d.png'), '-c:v', 'ffv1', '-level', '3', out])
  rmSync(stage, { recursive: true, force: true })
  return { path: out, seconds: frames.length / FPS }
}

const DISSOLVE = 0.4

/*
 * Six shots, twelve seconds. Shot four is her hands cutting the deck and it is
 * the reason the opening exists: with the last caption it teaches the player to
 * watch her hands, which is the whole game, without a tutorial saying so.
 *
 * The captions are positioned by fraction of the clip in Intro.tsx rather than
 * in seconds, so recutting this cannot push a line onto the wrong shot.
 */
function buildOpening() {
  const shots = [
    // Warm light spilling out of a doorway. A slow push toward it: an invitation.
    { tag: 'street', frames: pushIn('intro_street', 2.4, { from: 1.0, to: 1.12, panX: 0.03 }) },
    // Through the room, past the faro layout and the birdcage.
    { tag: 'hall', frames: pushIn('intro_hall', 2.2, { from: 1.12, to: 1.02, panX: 0.05 }) },
    /*
     * She looks up and finds you. The target is the warm plate rather than the
     * resting one on purpose: the resting plate looks down and away, so meeting
     * the lens is an event that happens to you rather than her default state.
     */
    {
      tag: 'look',
      frames: timeline([
        { hold: 'intro_down', frames: 12 },
        { from: 'intro_down', to: 'dealer_warm', frames: 42, ease: 'easeOut' },
        { hold: 'dealer_warm', frames: 18 },
      ]),
    },
    /*
     * Her hands, cutting - and keeping one card back. The teaching shot, and the
     * longest one in the cut: it is the only thing in the opening the player has
     * to carry into the game, and the bokeh behind the gloves is her own bodice
     * and choker so there is no doubt whose hands these are.
     */
    {
      tag: 'hands',
      frames: timeline([
        { hold: 'intro_hands_a', frames: 10 },
        { from: 'intro_hands_a', to: 'intro_hands_b', frames: 44, ease: 'easeInOut' },
        { hold: 'intro_hands_b', frames: 18 },
      ]),
    },
    // One card, a glass poured, and the chair it is all waiting for. That chair
    // is yours - the only shot in the opening addressed to the player.
    { tag: 'chair', frames: pushIn('intro_chair', 2.3, { from: 1.14, to: 1.0, panY: -0.015 }) },
    // And a smile, under the title.
    {
      tag: 'smile',
      frames: timeline([
        { from: 'dealer_cool', to: 'dealer_warm', frames: 34, ease: 'easeOut' },
        { hold: 'dealer_warm', frames: 41 },
      ]),
    },
  ]

  const segs = shots.map((s) => intermediate(s.frames, s.tag))
  const inputs = segs.flatMap((s) => ['-i', s.path])

  // Each xfade eats DISSOLVE seconds, so the offset walks along the running
  // length of what has been joined so far rather than along the source times.
  let acc = segs[0].seconds
  let label = '0:v'
  const chain = []
  for (let i = 1; i < segs.length; i++) {
    const out = `x${i}`
    chain.push(`[${label}][${i}:v]xfade=transition=fade:duration=${DISSOLVE}:offset=${(acc - DISSOLVE).toFixed(3)}[${out}]`)
    acc = acc + segs[i].seconds - DISSOLVE
    label = out
  }
  chain.push(`[${label}]fade=t=in:st=0:d=0.6,fade=t=out:st=${(acc - 0.5).toFixed(3)}:d=0.5[v]`)

  const total = Math.round(acc * FPS)
  const combined = join(CACHE, 'opening.mkv')
  ff([...inputs, '-filter_complex', chain.join(';'), '-map', '[v]', '-c:v', 'ffv1', '-level', '3', combined])

  // Back out to frames so the opening goes through exactly the same encoder,
  // poster and frame-count assertion as every other clip.
  const dir = join(CACHE, 'opening-frames')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  ff(['-i', combined, join(dir, '%05d.png')])
  const frames = readdirSync(dir).sort().map((f) => join(dir, f))
  if (Math.abs(frames.length - total) > 2) {
    throw new Error(`opening: ${frames.length} frames out of the chain, expected about ${total}`)
  }
  return frames
}

/*
 * Refuse to encode from plates whose costume has drifted. The clips are optical
 * flow between two stills, so a neckline a few pixels out on one plate becomes a
 * neckline sliding up her chest on screen - and it is far cheaper to catch that
 * here than to notice it in a recording after six minutes of encoding.
 */
if (process.env.SKIP_COSTUME_CHECK !== '1') try {
  execFileSync('node', [join(HERE, 'verify-costume.mjs')], { stdio: 'inherit' })
} catch {
  console.error('\nthe plates are not costume-locked; refusing to build clips from them')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })

if (!only.length || only.includes('intro')) {
  const frames = buildOpening()
  const n = encode('intro', frames)
  console.log(`${'intro'.padEnd(10)} ${String(n).padStart(3)} frames  ${(n / FPS).toFixed(2)}s`)
  if (only.length === 1) process.exit(0)
}

const wanted = only.length ? only.filter((c) => c !== 'intro') : Object.keys(CLIPS)
const report = []
for (const name of wanted) {
  const spec = CLIPS[name]
  if (!spec) throw new Error(`unknown clip ${name}`)
  const frames = timeline(spec)
  const n = encode(name, frames)
  report.push(`${name.padEnd(10)} ${String(n).padStart(3)} frames  ${(n / FPS).toFixed(2)}s`)
  console.log(report.at(-1))
}
console.log(`\n${report.length} clips -> ${OUT}`)
