/**
 * Turns the still keyframes in clipsrc/ and public/art/ into the short video
 * clips the game plays for its actions.
 *
 * The plates are all full frames shot from the same camera with the same
 * lighting, which is what makes this work: optical flow can track between two
 * of them and synthesise the motion in between, so a handful of stills becomes
 * real movement rather than a cross-fade. Everything here is deterministic and
 * cached, so re-running after editing one clip only rebuilds that clip.
 *
 *   node scripts/build-clips.mjs            # build whatever is out of date
 *   node scripts/build-clips.mjs fire idle  # only clips matching these names
 *   FORCE=1 node scripts/build-clips.mjs    # ignore the cache
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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'clipsrc')
const ART = join(ROOT, 'public', 'art')
const OUT = join(ROOT, 'public', 'clips')
const CACHE = join(ROOT, 'node_modules', '.clipcache')

const FPS = 30
/** Widths the clips are published at: desktop, then the phone variant. */
const SIZES = [
  { suffix: '', w: 1280, h: 720, crf: { vp9: 36, h264: 26 } },
  { suffix: '.sm', w: 768, h: 432, crf: { vp9: 38, h264: 28 } },
]

const only = process.argv.slice(2)
const force = process.env.FORCE === '1'

/** ffmpeg's own diagnostics are the only useful part of a failure here. */
function ff(args) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'pipe' })
  } catch (err) {
    throw new Error(`ffmpeg failed:\n  ${args.join(' ')}\n${String(err.stderr ?? '')}`)
  }
}

const probe = (args) =>
  String(execFileSync('ffprobe', ['-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'ignore'] })).trim()

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

/**
 * Every frame that reaches ffmpeg's image demuxer has to be a real PNG at the
 * working size. The plates are a mix of JPEG and PNG, and the demuxer reads
 * the extension rather than the bytes, so a JPEG staged as .png is dropped
 * without an error and the clip silently comes out short.
 */
function normalised(path) {
  const out = join(CACHE, 'norm', `${digest(path)}.png`)
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true })
    ff(['-i', path, '-vf', 'scale=1280:720', '-pix_fmt', 'rgb24', out])
  }
  return out
}

/**
 * Synthesises `steps` frames of motion from `a` to `b` and returns their paths.
 *
 * minterpolate discards the first and last input interval, so the input is
 * padded to [a, b, b]: that leaves exactly one interval to render and yields
 * steps+1 frames running from a to b. Anything else silently changes how many
 * frames come out.
 */
function morph(a, b, steps) {
  const key = `morph-${digest(a, b, steps)}`
  const dir = join(CACHE, key)
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
    '-vf',
    `minterpolate=fps=${steps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1:me_mode=bidir:search_param=48`,
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

/**
 * Builds a frame list from a timeline of holds and moves. A dense morph is
 * synthesised once and then sampled through an easing curve, so retiming a
 * beat costs nothing and never re-runs the optical flow.
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
    const ease = step.ease ?? easeInOut
    for (let i = 0; i < step.frames; i++) {
      const t = step.frames === 1 ? 1 : i / (step.frames - 1)
      frames.push(dense[Math.round(ease(t) * (dense.length - 1))])
    }
  }
  return frames
}

/** Writes a frame list to a numbered directory ffmpeg's image demuxer can read. */
function stageFrames(frames) {
  const stage = mkdtempSync(join(tmpdir(), 'clip-'))
  frames.forEach((f, i) => cpSync(f, join(stage, `${String(i).padStart(5, '0')}.png`)))
  return stage
}

/**
 * A slow push on a single still. Baked in rather than done with CSS so the
 * intro cuts stay on their marks regardless of how the page is scaled.
 */
function pushIn(image, seconds, { from = 1.0, to = 1.08, drift = 0 } = {}) {
  const n = Math.round(seconds * FPS)
  const stage = mkdtempSync(join(tmpdir(), 'push-'))
  const out = join(stage, 'push.mkv')
  ff([
    '-loop', '1',
    '-framerate', String(FPS),
    '-t', String(seconds),
    '-i', image,
    '-vf',
    // Upscaling first keeps zoompan from stepping in whole source pixels.
    `scale=2560:1440,zoompan=z='${from}+${(to - from).toFixed(4)}*on/${n}':d=1` +
      `:x='iw/2-(iw/zoom/2)+${drift}*on/${n}':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${FPS}`,
    '-frames:v', String(n),
    '-c:v', 'ffv1',
    out,
  ])
  return out
}

/** Encodes a staged frame directory to an intermediate lossless clip. */
function fromFrames(frames) {
  const stage = stageFrames(frames)
  const out = join(stage, 'seq.mkv')
  ff([
    '-framerate', String(FPS),
    '-start_number', '0',
    '-i', join(stage, '%05d.png'),
    '-c:v', 'ffv1',
    out,
  ])
  const got = countFrames(out)
  if (got !== frames.length) {
    throw new Error(`staged ${frames.length} frames but encoded ${got}`)
  }
  return out
}

const countFrames = (file) =>
  Number(
    probe([
      '-count_frames',
      '-select_streams', 'v',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'csv=p=0',
      file,
    ]),
  )

/** Joins intermediates with cross-dissolves. */
function dissolve(parts, fade) {
  let current = parts[0]
  let elapsed = duration(parts[0])
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]
    const at = elapsed - fade
    const out = join(mkdtempSync(join(tmpdir(), 'xf-')), 'x.mkv')
    ff([
      '-i', current,
      '-i', next,
      '-filter_complex',
      `[0:v][1:v]xfade=transition=fade:duration=${fade}:offset=${at.toFixed(3)},format=yuv420p`,
      '-c:v', 'ffv1',
      out,
    ])
    current = out
    elapsed = at + duration(next)
  }
  return current
}

const duration = (file) =>
  Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', file]))

/** Publishes an intermediate as webm + mp4 at every size, plus a poster. */
function publish(name, intermediate, { grade = null, poster = 'first', posterAt = null } = {}) {
  mkdirSync(OUT, { recursive: true })
  for (const size of SIZES) {
    const chain = [`scale=${size.w}:${size.h}`, grade].filter(Boolean).join(',')
    ff([
      '-i', intermediate,
      '-vf', chain,
      '-c:v', 'libvpx-vp9',
      '-crf', String(size.crf.vp9),
      '-b:v', '0',
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '2',
      '-pix_fmt', 'yuv420p',
      '-an',
      join(OUT, `${name}${size.suffix}.webm`),
    ])
    ff([
      '-i', intermediate,
      '-vf', chain,
      '-c:v', 'libx264',
      '-crf', String(size.crf.h264),
      '-preset', 'slow',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      join(OUT, `${name}${size.suffix}.mp4`),
    ])
  }
  // The poster is what shows if the clip never loads, so it has to be a frame
  // the game can sit on: the first for a loop, the last for a one-shot, and
  // for anything that opens on a fade, the first frame with a picture in it.
  const pick =
    posterAt !== null ? ['-ss', String(posterAt)] : poster === 'last' ? ['-sseof', '-0.1'] : []
  ff([
    ...pick,
    '-i', intermediate,
    '-vf', `scale=${SIZES[0].w}:${SIZES[0].h}${grade ? ',' + grade : ''}`,
    '-frames:v', '1',
    '-q:v', '4',
    join(OUT, `${name}.jpg`),
  ])
}

/* ------------------------------------------------------------------ clips */

/** Warms the cylinder, closes the gate and spins it. Played over loading. */
const chamber = () =>
  timeline([
    { hold: 'load_a', frames: 5 },
    { from: 'load_a', to: 'load_b', frames: 16 },
    { from: 'load_b', to: 'load_c', frames: 16 },
    { from: 'load_c', to: 'load_d', frames: 8, ease: easeOut },
    { hold: 'load_d', frames: 10 },
    { from: 'load_d', to: 'load_c', frames: 10, ease: easeOut },
    { hold: 'load_c', frames: 8 },
  ])

/** Hand off the table, gun up, levelled at the camera. */
const raise = (who) =>
  timeline([
    { hold: `${who}_neutral`, frames: 3 },
    { from: `${who}_neutral`, to: `${who}_lift`, frames: 11 },
    { from: `${who}_lift`, to: `${who}_aiming`, frames: 12, ease: easeOut },
    { hold: `${who}_aiming`, frames: 3 },
  ])

/** The discharge, held for four frames and then falling back on line. */
const fires = (who) =>
  timeline([
    { hold: `${who}_aiming`, frames: 2 },
    { from: `${who}_aiming`, to: `${who}_fire`, frames: 2, ease: linear },
    { hold: `${who}_fire`, frames: 3 },
    { from: `${who}_fire`, to: `${who}_aiming`, frames: 8, ease: easeOut },
    { hold: `${who}_aiming`, frames: 6 },
  ])

/** Struck, thrown back, and settling into the slump. */
const takesHit = (who) =>
  timeline([
    { hold: `${who}_neutral`, frames: 2 },
    { from: `${who}_neutral`, to: `${who}_struck`, frames: 3, ease: linear },
    { hold: `${who}_struck`, frames: 4 },
    { from: `${who}_struck`, to: `${who}_hit`, frames: 20, ease: easeOut },
    { hold: `${who}_hit`, frames: 16 },
  ])

/**
 * Five seconds of breathing that loops without a seam, because it starts and
 * ends on the same plate. The blink sits inside the closing hold, where the
 * underlying frame is exactly the plate the eyes-closed twin was drawn from.
 */
function idle(who) {
  const frames = timeline([
    { from: `${who}_neutral`, to: `${who}_inhale`, frames: 45 },
    { hold: `${who}_inhale`, frames: 15 },
    { from: `${who}_inhale`, to: `${who}_neutral`, frames: 60 },
    { hold: `${who}_neutral`, frames: 30 },
  ])
  const blink = normalised(plate(`${who}_neutral_blink`))
  for (let i = 132; i < 136; i++) frames[i] = blink
  return frames
}

const CLIPS = {
  chamber_saloon: () => ({ frames: chamber() }),
  chamber_cantina: () => ({
    frames: chamber(),
    // The cantina is candle and clay rather than oil lamp and dark timber.
    grade: 'colorbalance=rs=.06:gs=.01:bs=-.05:rm=.05:bm=-.04,eq=saturation=1.06',
  }),
  cowboy_idle: () => ({ frames: idle('cowboy'), poster: 'first' }),
  cowboy_raise: () => ({ frames: raise('cowboy'), poster: 'last' }),
  cowboy_fire: () => ({ frames: fires('cowboy'), poster: 'last' }),
  cowboy_hit: () => ({ frames: takesHit('cowboy'), poster: 'last' }),
  viuda_idle: () => ({ frames: idle('viuda'), poster: 'first' }),
  viuda_raise: () => ({ frames: raise('viuda'), poster: 'last' }),
  viuda_fire: () => ({ frames: fires('viuda'), poster: 'last' }),
  viuda_hit: () => ({ frames: takesHit('viuda'), poster: 'last' }),
}

/** The opening cinematic: five beats, dissolved together, out on black. */
function buildIntro() {
  const shots = [
    pushIn(plate('intro_exterior'), 3.6, { from: 1.0, to: 1.09, drift: 90 }),
    pushIn(plate('intro_chair'), 3.2, { from: 1.0, to: 1.11 }),
    fromFrames(
      timeline([
        { hold: 'load_a', frames: 6 },
        { from: 'load_a', to: 'load_c', frames: 34 },
        { from: 'load_c', to: 'load_d', frames: 8, ease: easeOut },
        { hold: 'load_d', frames: 14 },
      ]),
    ),
    fromFrames(
      timeline([
        { hold: 'cowboy_neutral', frames: 10 },
        { from: 'cowboy_neutral', to: 'cowboy_smirk', frames: 34 },
        { hold: 'cowboy_smirk', frames: 18 },
      ]),
    ),
    fromFrames(
      timeline([
        { hold: 'viuda_neutral', frames: 8 },
        { from: 'viuda_neutral', to: 'viuda_smirk', frames: 30 },
        { hold: 'viuda_smirk', frames: 16 },
      ]),
    ),
  ]
  const joined = dissolve(shots, 0.6)

  // Out on black so the title card can dissolve up out of the same darkness.
  const out = join(mkdtempSync(join(tmpdir(), 'intro-')), 'intro.mkv')
  const len = duration(joined)
  ff([
    '-i', joined,
    '-vf', `fade=t=in:st=0:d=0.8,fade=t=out:st=${(len - 1.0).toFixed(2)}:d=1.0`,
    '-c:v', 'ffv1',
    out,
  ])
  return out
}

/* -------------------------------------------------------------------- run */

mkdirSync(CACHE, { recursive: true })
const wanted = (name) => only.length === 0 || only.some((n) => name.includes(n))

for (const [name, build] of Object.entries(CLIPS)) {
  if (!wanted(name)) continue
  process.stdout.write(`${name} ... `)
  const { frames, grade, poster } = build()
  publish(name, fromFrames(frames), { grade, poster })
  process.stdout.write(`${frames.length} frames\n`)
}

if (wanted('intro')) {
  process.stdout.write('intro ... ')
  publish('intro', buildIntro(), { posterAt: 1.6 })
  process.stdout.write('done\n')
}

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    readdirSync(OUT)
      .filter((f) => f.endsWith('.webm'))
      .sort(),
    null,
    2,
  ) + '\n',
)
