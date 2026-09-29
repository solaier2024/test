#!/usr/bin/env node
/*
 * Turns the still plates in clipsrc/ into the short clips the table plays, and
 * writes the plates themselves out to public/art/.
 *
 * Every plate is the same locked-off camera on the same machine, so two plates
 * that differ by one movement are exactly what dense optical flow wants:
 *
 *   keyframe pair -> ffmpeg minterpolate -> resample through an easing curve
 *                 -> VP9 / H.264 at two sizes + a poster frame
 *
 *   node scripts/build-clips.mjs            # everything
 *   node scripts/build-clips.mjs pull       # just these
 *   FORCE=1 node scripts/build-clips.mjs    # ignore the cache
 *
 * There are only three table clips, and that is the point of this table rather
 * than a saving on it. Video here carries the hand and the lever - the
 * qualitative half. The reels are quantitative, they are DOM, and no amount of
 * footage could have covered them: three bands of twenty stops is 8000 rests.
 *
 * Four things this has to get right, all of them learned the hard way on the
 * sibling projects and kept here deliberately:
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
 * 4. The reel window is a hole in the casting that DOM shows through, so it has
 *    to be in the same place on every plate. verify-window.mjs runs first and
 *    refuses to build from plates that have drifted.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { RIM, bestShiftRGB, pinRim, readRGB, shiftRGB, toLuma, writeSequence } from './lib/lock.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ART = join(ROOT, 'public', 'art')
const SRC = join(ROOT, 'clipsrc', 'aligned')
const OUT = join(ROOT, 'public', 'clips')
const CACHE = join(ROOT, 'node_modules', '.clipcache')

const FPS = 30
const W = 1280
const H = 720
const SMALL_W = 768
const SMALL_H = 432

/** The plate every generated frame is registered against. */
const LOCK_TO = 'machine_rest'

const force = process.env.FORCE === '1'
const only = process.argv.slice(2)

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

function plate(name) {
  for (const dir of [SRC, ART]) {
    for (const ext of ['.png', '.jpg']) {
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

/*
 * Grain comes off here rather than in align-plates.mjs, for two reasons.
 *
 * The first is that it is a cosmetic change and align-plates.mjs is the stage
 * whose output geometry gets measured; a filter there moved verify-window's
 * reading of the glass by 46px without moving the picture at all.
 *
 * The second is the point of doing it: fx/Atmosphere.tsx draws film grain over
 * EVERYTHING every frame - the picture, the reels and the interface - which is
 * why the UI does not look suspiciously cleaner than the footage. Grain baked
 * into the plates on top of that is grain twice, and the baked half is the
 * worse half, because it cannot respond to anything and VP9 still has to pay
 * to carry it.
 *
 * hqdn3d is the obvious filter and it is the wrong one: its last two parameters
 * are TEMPORAL and a plate is a single frame, so hqdn3d=3:2:4:4 is really
 * hqdn3d=3:2. smartblur's third parameter is a THRESHOLD - it only touches
 * pixels whose neighbourhood contrast falls below it, which states the
 * difference between grain and cast-iron scrollwork directly.
 *
 * Mean Laplacian energy on machine_rest, with each pixel classified on the
 * source as edge (local range > 60) or flat:
 *
 *                        flat    edge
 *   raw                  4.284   32.869
 *   hqdn3d=3:2:4:4       4.179   32.803   <- what this was: nothing
 *   hqdn3d=14:10         3.798   31.798   <- wound right up: still nothing
 *   smartblur=3:0.5:12   1.971   24.041   <- grain -54%, edges -27%
 *   smartblur=5:1:24     0.878   22.243   <- grain -80%, edges -32%
 *
 * 3:0.5:12 is the setting, because the edge column is what it costs: the
 * scrollwork and the milled rim of the payout card are the only texture this
 * picture has, and the last row buys 16 more points of grain with detail that
 * does not come back.
 */
const DENOISE = 'smartblur=3:0.5:12'

/** Every frame reaching the image demuxer has to be a real PNG at working size. */
function normalised(path) {
  const out = join(CACHE, 'norm', `${digest(path, DENOISE)}.png`)
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true })
    ff(['-i', path, '-vf', `scale=${W}:${H},${DENOISE}`, '-pix_fmt', 'rgb24', out])
  }
  return out
}

/* ------------------------------------------------------------ the seam
 *
 * morph(a, b, steps) is where this pipeline meets whatever is generating the
 * motion. Its contract has not changed since the optical-flow version: give it
 * two plate names and a step count, get back exactly steps+1 frame paths,
 * cached by content digest. Everything downstream - timeline()'s easing
 * resample, the dual encode, the poster, the frame-count assertion - is
 * indifferent to how the frames in the middle were arrived at.
 *
 * There are two backends:
 *
 *   GENERATED. A clip listed in clipsrc/generated.json, produced by an
 *     image-to-video model conditioned on plate a as its first frame and plate
 *     b as its last. This is the real thing: a hand that actually grips and
 *     hauls, a crowd that actually surges. It is preferred whenever the
 *     footage is present.
 *
 *   OPTICAL FLOW. ffmpeg minterpolate between the two plates. Dense flow
 *     between two stills cannot invent a crowd throwing its hats up; what it
 *     can do is get the lever down the arc convincingly, and it costs nothing
 *     and needs no network. It stays as the fallback, and it is the reason a
 *     checkout with no generated footage still builds a playable table.
 *
 * Both go through the same resample, so a clip's timing is a property of this
 * repository and not of whatever the model happened to return.
 */

/** Resample a dense sequence of any length down to exactly steps+1 frames. */
function resampleInto(dense, dir, steps) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i <= steps; i++) {
    const at = Math.round((i / steps) * (dense.length - 1))
    cpSync(dense[at], join(dir, `${String(i).padStart(4, '0')}.png`))
  }
  return readdirSync(dir).sort().map((f) => join(dir, f))
}

function flowFrames(a, b, steps) {
  const dir = join(CACHE, `flow-${digest(a, b, steps)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length === steps + 1) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const stage = mkdtempSync(join(tmpdir(), 'morph-'))
  /*
   * minterpolate discards the first and last input interval, so the input is
   * padded to [a, b, b]: that leaves exactly one interval to render and yields
   * steps+1 frames. Anything else silently changes the frame count.
   */
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
    throw new Error(`flow ${a} -> ${b} produced ${frames.length} frames, wanted ${steps + 1}`)
  }
  return frames
}

/**
 * Decode a generated clip, register every frame to the reference casting and
 * pin the window rim. See scripts/lib/lock.mjs for why both passes exist.
 */
function generatedFrames(use) {
  const mp4 = join(ROOT, 'clipsrc', 'generated', `${use}.mp4`)
  if (!existsSync(mp4)) return null

  const dir = join(CACHE, `gen-${digest(mp4, RIM.x0, RIM.y1)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  /*
   * Decoded to one concatenated raw file and processed frame by frame out of
   * it, rather than to a directory of PNGs. Two ffmpeg calls for a whole clip
   * instead of two hundred; see writeSequence in lib/lock.mjs.
   */
  const stage = mkdtempSync(join(tmpdir(), 'gen-'))
  const inRaw = join(stage, 'in.raw')
  const outRaw = join(stage, 'out.raw')
  ff(['-i', mp4, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', inRaw])

  const bytes = W * H * 3
  const count = statSync(inRaw).size / bytes
  if (!Number.isInteger(count)) throw new Error(`${use}: decoded ${statSync(inRaw).size} bytes, not a whole number of frames`)

  const reference = readRGB(join(SRC, `${LOCK_TO}.png`))
  const refLuma = toLuma(reference)
  const src = openSync(inRaw, 'r')
  const dst = openSync(outRaw, 'w')
  const frame = Buffer.allocUnsafe(bytes)
  let worst = 0
  for (let i = 0; i < count; i++) {
    readSync(src, frame, 0, bytes, i * bytes)
    const { dx, dy } = bestShiftRGB(refLuma, toLuma(frame), 16)
    worst = Math.max(worst, Math.abs(dx), Math.abs(dy))
    writeSync(dst, pinRim(shiftRGB(frame, -dx, -dy), reference))
  }
  closeSync(src)
  closeSync(dst)
  writeSequence(outRaw, dir)
  rmSync(stage, { recursive: true, force: true })
  console.log(`  ${use}: ${count} generated frames, worst drift taken out ${worst}px`)

  return readdirSync(dir).sort().map((f) => join(dir, f))
}

/** Synthesises `steps` frames of motion from a to b and returns their paths. */
function morph({ use, from, to }, steps) {
  const a = plate(from)
  const b = plate(to)
  const dir = join(CACHE, `morph-${digest(a, b, use ?? '', steps)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length === steps + 1) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  const dense = (use && generatedFrames(use)) || flowFrames(a, b, steps)
  const frames = resampleInto(dense, dir, steps)
  if (frames.length !== steps + 1) {
    throw new Error(`morph ${from} -> ${to} produced ${frames.length} frames, wanted ${steps + 1}`)
  }
  return frames
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const easeOut = (t) => 1 - (1 - t) ** 3
const easeIn = (t) => t * t * t
const linear = (t) => t
const EASES = { easeInOut, easeOut, easeIn, linear }

function timeline(steps) {
  const frames = []
  for (const step of steps) {
    if (step.hold) {
      const at = normalised(plate(step.hold))
      for (let i = 0; i < step.frames; i++) frames.push(at)
      continue
    }
    const dense = morph(step, 48)
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

  /*
   * CRF 30 rather than the sibling's 34. This picture is nearly all shadow with
   * one warm lamp in it, and VP9 bands a dark gradient badly: at 34 the falloff
   * across the bar behind the machine came out in visible steps, which reads as
   * the lamp flickering when it is not.
   */
  for (const [suffix, w, h, crf] of [
    ['', W, H, 30],
    ['.sm', SMALL_W, SMALL_H, 35],
  ]) {
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0',
      '-row-mt', '1', '-cpu-used', '2', '-auto-alt-ref', '1', '-lag-in-frames', '25', '-g', '240',
      '-an', join(OUT, `${name}${suffix}.webm`)])
    ff([...input, '-vf', `scale=${w}:${h}`, '-c:v', 'libx264', '-crf', String(crf - 6),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(OUT, `${name}${suffix}.mp4`)])
  }
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
 * The table's whole vocabulary: an arm going down, an arm coming back, and the
 * machine standing there between pulls.
 *
 * The crowd is NOT in here. Every crowd state is a plate, cross-faded by
 * Scene.tsx, because a reaction has to be able to happen at any instant the
 * engine decides - and there is no clip for "the room groans 1.4 seconds after
 * a pull that started 3.1 seconds ago". The plates are all the same locked-off
 * camera with the same machine and the same hand, so swapping one for another
 * moves the room and nothing else.
 */
const CLIPS = {
  /* Down fast under the weight of the arm, and hold at the bottom. */
  pull: [
    { use: 'pull', from: 'machine_rest', to: 'machine_pull', frames: 9, ease: 'easeIn' },
    { hold: 'machine_pull', frames: 3 },
  ],
  /* Back up under its spring: slower than it went down, and it settles. */
  release: [
    { use: 'release', from: 'machine_pull', to: 'machine_rest', frames: 13, ease: 'easeOut' },
    { hold: 'machine_rest', frames: 3 },
  ],
  /*
   * The hardest clip to do without: the one the table sits on between pulls.
   *
   * The sibling project learned this the expensive way - an idle that holds a
   * single plate and only blinks reads as a photograph on a recording. Nothing
   * on this table blinks, so the whole loop is a slow breath: the lamp gutters
   * down and comes back and the figures behind the bar shift, so something is
   * moving in every single frame.
   *
   * The generated version is conditioned on machine_rest at BOTH ends, so it
   * returns to the plate it left and the loop point is not a cut. Without it
   * the fallback goes out to machine_breath and back, which is the same idea
   * done with two dense morphs.
   */
  idle: [{ use: 'idle', from: 'machine_rest', to: 'machine_breath', frames: 124, ease: 'linear' }],

  /*
   * The crowd. This is the half of the table the player is actually playing
   * against, so it gets the same treatment as the lever and not a cross-fade.
   *
   * Each one runs from machine_rest to the reaction plate, which means it ends
   * on a picture Scene.tsx already has: the clip plays, and the plate it
   * settles onto is underneath it before the last frame arrives. Coming back
   * out of a reaction is still a cross-fade to machine_rest, and that is not a
   * saving - a room going quiet again really does happen slowly and without
   * anybody doing anything in particular, which is exactly what a dissolve is.
   */
  lean: [
    { use: 'lean', from: 'machine_rest', to: 'machine_lean', frames: 42, ease: 'easeOut' },
    { hold: 'machine_lean', frames: 4 },
  ],
  /* Hats up. Fast on the way in - a room erupts, it does not ramp. */
  roar: [
    { use: 'roar', from: 'machine_rest', to: 'machine_roar', frames: 46, ease: 'easeOut' },
    { hold: 'machine_roar', frames: 6 },
  ],
  /* And the other half of the user's brief: the room that does not cheer. */
  sigh: [
    { use: 'sigh', from: 'machine_rest', to: 'machine_sigh', frames: 52, ease: 'easeInOut' },
    { hold: 'machine_sigh', frames: 6 },
  ],
}

/* ----------------------------------------------------------- the opening */

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

function intermediate(frames, tag) {
  const stage = stageFrames(frames)
  const out = join(CACHE, `seg-${tag}.mkv`)
  ff(['-framerate', String(FPS), '-i', join(stage, '%05d.png'), '-c:v', 'ffv1', '-level', '3', out])
  rmSync(stage, { recursive: true, force: true })
  return { path: out, seconds: frames.length / FPS }
}

/*
 * Dissolve length per join. The third join is a CUT, not a dissolve: shot four
 * is a macro of a reel band on a workbench at a completely different scale, and
 * cross-fading that into a wide of the machine makes the cast iron appear to
 * dissolve into a strip of paper. Cutting to a detail is better grammar anyway.
 */
const DISSOLVE = [0.5, 0.5, 0]

/*
 * Four shots, about eleven seconds. Shot four is the one the opening exists
 * for: a reel band lying on a bench with a bell cut out of it. With the last
 * caption it teaches the player that the odds live on the bands and not on the
 * payout card, which is the entire game, without a tutorial saying so.
 */
function buildOpening() {
  const shots = [
    // Warm light out of a doorway, and a slow push toward it.
    { tag: 'street', frames: pushIn('intro_street', 2.8, { from: 1.0, to: 1.13, panX: 0.02 }) },
    // Down the room, past the empty faro layout, to the one lit thing in it.
    { tag: 'room', frames: pushIn('intro_room', 3.0, { from: 1.14, to: 1.02, panY: -0.01 }) },
    // The machine, and your hand already on the arm.
    { tag: 'machine', frames: pushIn('machine_rest', 2.4, { from: 1.1, to: 1.0 }) },
    // And the thing you are not allowed to see, on a bench in the back room.
    { tag: 'band', frames: pushIn('intro_band', 3.0, { from: 1.0, to: 1.12, panX: -0.03 }) },
  ]

  const segs = shots.map((s) => intermediate(s.frames, s.tag))
  const inputs = segs.flatMap((s) => ['-i', s.path])

  let acc = segs[0].seconds
  let label = '0:v'
  const chain = []
  for (let i = 1; i < segs.length; i++) {
    const out = `x${i}`
    const want = DISSOLVE[i - 1] ?? 0.5
    // xfade needs a duration, so a "cut" is the shortest one it will take.
    const d = want === 0 ? 2 / FPS : want
    chain.push(`[${label}][${i}:v]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}[${out}]`)
    acc = acc + segs[i].seconds - d
    label = out
  }
  chain.push(`[${label}]fade=t=in:st=0:d=0.7,fade=t=out:st=${(acc - 0.6).toFixed(3)}:d=0.6[v]`)

  const total = Math.round(acc * FPS)
  const combined = join(CACHE, 'opening.mkv')
  ff([...inputs, '-filter_complex', chain.join(';'), '-map', '[v]', '-c:v', 'ffv1', '-level', '3', combined])

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

/* --------------------------------------------------------------- the plates */

/**
 * The plates the table shows between clips. They are written out here rather
 * than checked in twice, so public/art/ is a build product and clipsrc/ is the
 * only place a plate exists by hand.
 */
const PLATES = ['machine_rest', 'machine_lean', 'machine_roar', 'machine_sigh', 'machine_breath']

function buildPlates() {
  mkdirSync(ART, { recursive: true })
  for (const name of PLATES) {
    ff(['-i', join(SRC, `${name}.png`), '-vf', `scale=${W}:${H},${DENOISE}`, '-q:v', '4', join(ART, `${name}.jpg`)])
  }
  console.log(`${PLATES.length} plates -> ${ART}`)
}

/*
 * Register the plates first, then refuse to encode from them if they still do
 * not agree. The reel window is a
 * hole the DOM bands show through, so a casting a few pixels out is bands that
 * leak past the brass - and it is far cheaper to catch that here than to notice
 * it in a recording after six minutes of encoding.
 */
if (process.env.SKIP_WINDOW_CHECK !== '1') {
  try {
    execFileSync('node', [join(HERE, 'align-plates.mjs')], { stdio: 'inherit' })
    execFileSync('node', [join(HERE, 'verify-window.mjs')], { stdio: 'inherit' })
  } catch {
    console.error('\nthe plates are not window-locked; refusing to build clips from them')
    process.exit(1)
  }
}

mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })

if (!only.length || only.includes('plates')) buildPlates()

if (!only.length || only.includes('intro')) {
  const frames = buildOpening()
  const n = encode('intro', frames)
  console.log(`${'intro'.padEnd(10)} ${String(n).padStart(3)} frames  ${(n / FPS).toFixed(2)}s`)
  if (only.length === 1) process.exit(0)
}

const wanted = only.length ? only.filter((c) => c !== 'intro' && c !== 'plates') : Object.keys(CLIPS)
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
