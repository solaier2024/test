#!/usr/bin/env node
/*
 * Builds every video file the table serves.
 *
 * There are two sources now, and the split is the point:
 *
 *   the six dealer clips   clipsrc/openart/*.mp4 -> downscale -> VP9 / H.264 at
 *                          two sizes + a poster. Generated video; nothing to
 *                          interpolate, because the motion is already in it.
 *   the opening            stills -> minterpolate / zoompan -> xfade -> the same
 *                          encoder. Still optical flow, and still the right tool:
 *                          the opening is six different camera set-ups, which is
 *                          the one thing a single-plate generator cannot give us.
 *
 *   node scripts/build-clips.mjs            # everything
 *   node scripts/build-clips.mjs deal       # just these
 *   FORCE=1 node scripts/build-clips.mjs    # ignore the cache
 *
 * Three things the opening path has to get right, all learned the hard way on the
 * sibling project and kept here deliberately:
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
/** Where the generated dealer clips land. See clipsrc/openart/README.md. */
const GEN = join(SRC, 'openart')
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
    const ease = EASES[step.ease ?? 'easeInOut']
    const series = morph(plate(step.from), plate(step.to), 48)
    const last = series.length - 1
    for (let i = 0; i < step.frames; i++) {
      const t = step.frames === 1 ? 1 : i / (step.frames - 1)
      frames.push(series[Math.round(ease(t) * last)])
    }
  }
  return frames
}

function stageFrames(frames) {
  const stage = mkdtempSync(join(tmpdir(), 'clip-'))
  frames.forEach((f, i) => cpSync(f, join(stage, `${String(i).padStart(5, '0')}.png`)))
  return stage
}

/**
 * The four files and the poster the table serves for one clip, from whatever
 * ffmpeg input, with the frame count asserted afterwards.
 *
 * `-an` on every output matters for the generated clips as well as the built
 * ones: Wan attaches a silent AAC track whether or not it is asked to, and the
 * score owns the audio.
 */
function render(name, input, poster, expected) {
  /*
   * CRF 34 was too lossy for this costume. VP9 smooths fine black lace against
   * skin, so the trim came out visibly thinner in the clips than on the JPEG
   * plate underneath them - which reads as the costume changing when the clip
   * starts, even though the plates are byte-locked. 28 holds the lace.
   */
  for (const [suffix, w, h, crf, bitrate] of [
    ['', W, H, 28, '0'],
    ['.sm', SMALL_W, SMALL_H, 33, '0'],
  ]) {
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', bitrate,
      '-row-mt', '1', '-an', join(OUT, `${name}${suffix}.webm`)])
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libx264', '-crf', String(crf - 6),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(OUT, `${name}${suffix}.mp4`)])
  }
  // Poster is the clip's own first frame, so the still underneath matches it.
  ff([...poster, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-q:v', '4', join(OUT, `${name}.jpg`)])

  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-count_frames', '-of', 'csv=p=0',
    join(OUT, `${name}.webm`)]).toString().trim()
  if (expected != null && Number(probe) !== expected) {
    throw new Error(`${name}: encoded ${probe} frames, expected ${expected}`)
  }
  return Number(probe)
}

function encode(name, frames) {
  const stage = stageFrames(frames)
  try {
    return render(
      name,
      ['-framerate', String(FPS), '-i', join(stage, '%05d.png')],
      ['-i', join(stage, '00000.png')],
      frames.length,
    )
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

/**
 * A generated clip, transcoded straight from the mp4 OpenArt returned.
 *
 * There is no interpolation left to do here, which is the point: the motion
 * already exists in the source. It arrives at 1920x1080 and the table serves
 * 1280x720, so this downsamples rather than upscales, which is the one place
 * this pipeline is cheaper AND better than the one it replaced.
 */
function encodeGenerated(name) {
  const src = join(GEN, `${name}.mp4`)
  if (!existsSync(src)) throw new Error(`no generated source for ${name} at ${src}`)
  return render(name, ['-i', src], ['-i', src], null)
}

/*
 * The table's whole vocabulary, one generated clip each.
 *
 * Her movements are orthogonal to the cards, so no matter what is dealt she only
 * ever does these things - which is the reason a video-based blackjack table is
 * affordable at all. Every clip is generated with the resting plate as both its
 * first and its last frame, so the resting pose stays the hub of a star: N clips
 * instead of N squared, and any two of them join through the pose the still
 * underneath is already showing.
 *
 * These were optical flow between pairs of stills until the motion itself became
 * the problem - a displacement field cannot rotate a head or move an eye behind a
 * lid, and two reviewers independently called the idle loop frozen. What each clip
 * now costs, what it is allowed to contain, and why none of them use her hands,
 * is in clipsrc/openart/README.md.
 */
const CLIPS = ['idle', 'deal', 'warm', 'sharp', 'shuffle', 'natural']

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

/*
 * Dissolve length per join, in order. Shots three and four are CUTS, not
 * dissolves: four is a macro of her hands from a different camera, and its
 * out-of-focus background is the same costume at a completely different scale
 * sitting in the same part of the frame. Cross-fading those two makes the
 * neckline and the straps appear to morph, which reads as the costume changing -
 * a reviewer reported it as exactly that. Cutting to a detail and cutting back is
 * better grammar anyway.
 */
const DISSOLVE = [0.4, 0.4, 0, 0, 0.4]

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
    // xfade needs a duration, so a "cut" is the shortest one it will take: two
    // frames, which is below the threshold of anything reading as a blend.
    const want = DISSOLVE[i - 1] ?? 0.4
    const d = want === 0 ? 2 / FPS : want
    chain.push(`[${label}][${i}:v]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}[${out}]`)
    acc = acc + segs[i].seconds - d
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
 * Refuse to encode from plates whose costume has drifted. This now guards the
 * opening only - the dealer clips carry the master plate as their own first frame,
 * and are checked by verify-generated.mjs instead - but the opening cross-fades
 * between stills, so a neckline a few pixels out on one plate still becomes a
 * neckline sliding up her chest on screen.
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

const wanted = only.length ? only.filter((c) => c !== 'intro') : CLIPS
const report = []
for (const name of wanted) {
  if (!CLIPS.includes(name)) throw new Error(`unknown clip ${name}`)
  const n = encodeGenerated(name)
  report.push(`${name.padEnd(10)} ${String(n).padStart(3)} frames  ${(n / FPS).toFixed(2)}s`)
  console.log(report.at(-1))
}
console.log(`\n${report.length} clips -> ${OUT}`)
