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
  writeFileSync,
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
/*
 * The opening runs at 24 and the table runs at 30, which is not an
 * inconsistency but the only way to avoid one.
 *
 * Table clips are interpolated or resampled to whatever cadence is asked for,
 * so 30 is free there and worth having: a lever coming down is fast motion in
 * a small part of the frame. The opening is four generated shots delivered at
 * 24, and every frame of them is a real rendered frame. Resampling those to 30
 * cannot add information - it duplicates two frames in every twelve, and on a
 * slow steady dolly that pattern is exactly where judder is most visible.
 *
 * At 24 each source frame is used once, the move is smooth, and the encode has
 * a fifth fewer frames to pay for. Film cadence is also the right grammar for
 * the only part of this that is a film.
 */
const INTRO_FPS = 24
const W = 1280
const H = 720
const SMALL_W = 768
const SMALL_H = 432

/**
 * The one plate every other picture of this machine is held against: generated
 * frames are registered to its casting, and every rim in the project - in the
 * footage and in the plates - is a copy of its rim. See plateFrame() below.
 */
const LOCK_TO = 'machine_rest'

/*
 * Two lists, because they answer two different questions, and running them
 * together is how the first attempt at this crashed on machine_pull.
 *
 * MACHINE_PLATES is every hand-made picture of this machine, and it is the set
 * allowed to wear the shared rim.
 *
 * SHOWN is the subset the browser downloads, because Scene.tsx cross-fades
 * between them. machine_pull is not in it: the arm at the bottom of its travel
 * is only ever seen inside the pull clip, never as a plate the table rests on.
 */
const MACHINE_PLATES = ['machine_rest', 'machine_pull', 'machine_lean', 'machine_roar', 'machine_sigh', 'machine_breath']
const SHOWN = ['machine_rest', 'machine_lean', 'machine_roar', 'machine_sigh', 'machine_breath']

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

/*
 * Every picture of the machine carries ONE rim, and it is machine_rest's.
 *
 * generatedFrames() already pins the rim on footage, and for a while that was
 * the whole of it - which left a hole big enough to see through. The plates
 * were not pinned, and the plates are half of what the table shows: Scene.tsx
 * cross-fades between them, and every crowd clip ends with a `hold` of its
 * reaction plate. So the last few frames of a clip, and the whole time a
 * reaction sat on screen, the brass came from a separately generated image
 * that had never been through the lock.
 *
 * scripts/verify-lock.mjs measures it per frame. On `lean` the rim tracked the
 * plate to within 0.9 for forty-two frames and then jumped 4.94 in one frame
 * and stayed there - the boundary between the pinned footage and the unpinned
 * hold, landing on exactly the moment the room finishes leaning in.
 *
 * Pinning the plates too costs nothing. The rim in every approved plate is
 * geometrically the same rectangle already (verify-window.mjs holds it to
 * that); the plates only disagree about how the brass was PAINTED, and that is
 * the one part of this picture nothing is allowed to have an opinion about.
 */
let rimRef = null
const rimSource = () => (rimRef ??= readRGB(join(SRC, `${LOCK_TO}.png`)))

/**
 * A machine plate as a frame: normalised, then wearing the shared rim.
 *
 * Only for plates of the machine. The opening's plates go through normalised()
 * on their own, because pinning a machine window onto a photograph of a street
 * would paste the glass into the street - and because nothing is laid over the
 * opening, so it has no window to keep still.
 */
function plateFrame(name) {
  if (!MACHINE_PLATES.includes(name)) throw new Error(`${name} is not a machine plate`)
  const src = normalised(plate(name))
  if (name === LOCK_TO) return src
  const out = join(CACHE, 'pinned', `${digest(src, RIM.x0, RIM.y1, LOCK_TO)}.png`)
  if (!force && existsSync(out)) return out
  mkdirSync(dirname(out), { recursive: true })
  const stage = mkdtempSync(join(tmpdir(), 'pin-'))
  const raw = join(stage, 'f.raw')
  writeFileSync(raw, pinRim(readRGB(src), rimSource()))
  writeSequence(raw, stage)
  cpSync(join(stage, '00001.png'), out)
  rmSync(stage, { recursive: true, force: true })
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

/** Where a clip's generated take lives, whether or not it has been fetched. */
const takePath = (use) => join(ROOT, 'clipsrc', 'generated', `${use}.mp4`)

/** Synthesises `steps` frames of motion from a to b and returns their paths. */
function morph({ use, from, to }, steps) {
  const a = plate(from)
  const b = plate(to)
  /*
   * The take goes in the key by CONTENT, not by name, and that distinction
   * cost a whole rebuild. digest() hashes a path's bytes when the path exists
   * and otherwise hashes the string, so passing `use` alone keyed nine clips
   * on the word "pull" and friends. Re-ordering every take against a corrected
   * reference, re-fetching all nine and running the build then produced the
   * OLD footage from cache, with no output to say so - the plates had not
   * moved, the step count had not moved, and the only thing that had changed
   * was invisible to the key. The checks downstream failed exactly as they had
   * before, which made it look like the re-shoot had not worked.
   */
  const dir = join(CACHE, `morph-${digest(a, b, use ? takePath(use) : '', use ?? '', steps)}`)
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
      const at = plateFrame(step.hold)
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

/*
 * VP9 settings shared by both ways of asking for an encode. The only thing
 * that ever differs between them is what is being held constant.
 */
const VP9 = ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-cpu-used', '2',
  '-auto-alt-ref', '1', '-lag-in-frames', '25', '-g', '240', '-an']

/**
 * As good as it can be inside a stated number of kilobytes, rather than a
 * stated quality at whatever size that costs.
 *
 * This is for one clip - the opening - and the measurements are why. Table
 * clips are short and mostly still, so CRF lands them far under budget and
 * quality-targeting is simply the better question to ask. The opening is
 * eleven seconds of moving camera over real parallax, where every frame is
 * new information, and CRF 35 put it at 1410 KB against a 400 KB ceiling.
 *
 * Winding the CRF up until it fits is the obvious fix and it is the worse one,
 * because a constant quality target spends its bits evenly across shots that
 * do not deserve them evenly. Two passes at the budget spends them where the
 * picture is actually moving. SSIM against the source, phone tier:
 *
 *   CRF 45           576 KB   0.8479
 *   CRF 50           372 KB   0.8443
 *   2-pass 260k      356 KB   0.8482   <- this
 *
 * The same quality as CRF 45 in 62% of the bytes, and it is the row that fits.
 *
 * Both codecs go through this. The VP9 numbers above are what it was written
 * for; x264 was added when a busier opening pushed the mp4 fallback over the
 * same ceiling the webm had already been brought under. See encode().
 */
const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an']

/** 8 bits a byte, and a little back for container overhead the encoder is not
 *  accounting for. */
const bitrate = (kb, seconds) => `${Math.floor(((kb * 8) / seconds) * 0.92)}k`

function toBudget(codec, input, vf, out, kb, seconds) {
  const log = join(CACHE, `pass-${digest(out)}`)
  const common = [...input, '-vf', vf, ...codec, '-b:v', bitrate(kb, seconds), '-passlogfile', log]
  ff([...common, '-pass', '1', '-f', 'null', '-'])
  ff([...common, '-pass', '2', out])
}

function encode(name, frames, { fps = FPS, budget = null } = {}) {
  const stage = stageFrames(frames)
  const input = ['-framerate', String(fps), '-i', join(stage, '%05d.png')]
  const seconds = frames.length / fps

  /*
   * CRF 30 rather than the sibling's 34. This picture is nearly all shadow with
   * one warm lamp in it, and VP9 bands a dark gradient badly: at 34 the falloff
   * across the bar behind the machine came out in visible steps, which reads as
   * the lamp flickering when it is not.
   */
  for (const [suffix, w, h, crf, kb] of [
    ['', W, H, 30, budget?.[0]],
    ['.sm', SMALL_W, SMALL_H, 35, budget?.[1]],
  ]) {
    const vf = `scale=${w}:${h}`
    const webm = join(OUT, `${name}${suffix}.webm`)
    const mp4 = join(OUT, `${name}${suffix}.mp4`)
    /*
     * The mp4 is the fallback for a browser that will not decode VP9. It used
     * to be left quality-targeted with a note saying x264 at these CRFs came
     * in under every budget on its own, and that if it ever stopped being true
     * verify-budget.mjs would say so before anything shipped.
     *
     * It stopped being true and verify-budget.mjs said so. Replacing the
     * opening's exterior street with a crowded bar put twenty moving people
     * where there had been an empty street and an empty hall, and x264 at CRF
     * 29 went from 367 KB to 484 KB against the 400 KB ceiling - while the
     * webm beside it, which was already budget-targeted, landed at 335 KB and
     * noticed nothing. A quality target is a promise about how the picture
     * looks and no promise at all about what it costs, and a picture with a
     * crowd in it costs more than a picture of a street.
     *
     * So both encodes of a budgeted clip are now budgeted, and the stated
     * ceilings are properties of this repository rather than of how busy the
     * shot happens to be.
     */
    if (kb) {
      toBudget(VP9, input, vf, webm, kb, seconds)
      toBudget(H264, input, vf, mp4, kb, seconds)
    } else {
      ff([...input, '-vf', vf, ...VP9, '-crf', String(crf), '-b:v', '0', webm])
      ff([...input, '-vf', vf, ...H264, '-crf', String(crf - 6), mp4])
    }
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

  /*
   * The same two reactions again, but breaking out of a held breath instead of
   * out of a resting room - the crowd has already come forward because the
   * first two bands matched and the third is still running.
   *
   * These are not a luxury. It is the only moment in the game where the room
   * knows something is coming before the player does, and a reaction that
   * started from machine_rest would have to cut the leaning crowd away in one
   * frame to play. They are also the two clips that most deserve the footage:
   * a held breath letting go is a whole-body thing and there is no way to
   * interpolate it out of two stills.
   */
  roar_held: [
    { use: 'roar_held', from: 'machine_lean', to: 'machine_roar', frames: 40, ease: 'easeOut' },
    { hold: 'machine_roar', frames: 8 },
  ],
  sigh_held: [
    { use: 'sigh_held', from: 'machine_lean', to: 'machine_sigh', frames: 50, ease: 'easeInOut' },
    { hold: 'machine_sigh', frames: 8 },
  ],
}

/* ----------------------------------------------------------- the opening */

function pushIn(name, seconds, { from = 1.0, to = 1.09, panX = 0, panY = 0 } = {}, fps = INTRO_FPS) {
  const n = Math.round(seconds * fps)
  const dir = join(CACHE, `push-${digest(plate(name), seconds, from, to, panX, panY, fps)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length === n) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const z = `${from}+${(to - from).toFixed(5)}*on/${n}`
  const x = `iw/2-(iw/zoom/2)+(${panX.toFixed(4)})*iw*on/${n}`
  const y = `ih/2-(ih/zoom/2)+(${panY.toFixed(4)})*ih*on/${n}`
  ff([
    '-loop', '1', '-framerate', String(fps), '-t', String(seconds), '-i', normalised(plate(name)),
    '-vf', `scale=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${fps}`,
    '-frames:v', String(n),
    join(dir, '%04d.png'),
  ])
  const frames = readdirSync(dir).sort().map((f) => join(dir, f))
  if (frames.length !== n) throw new Error(`push ${name} produced ${frames.length} frames, wanted ${n}`)
  return frames
}

function intermediate(frames, tag, fps) {
  const stage = stageFrames(frames)
  const out = join(CACHE, `seg-${tag}.mkv`)
  ff(['-framerate', String(fps), '-i', join(stage, '%05d.png'), '-c:v', 'ffv1', '-level', '3', out])
  rmSync(stage, { recursive: true, force: true })
  return { path: out, seconds: frames.length / fps }
}

/*
 * Dissolve length per join, and only the first one is a dissolve.
 *
 * Joins two and three bracket the macro of the reel band, which is a completely
 * different scale from the two wides around it. Cross-fading a wide into a
 * macro makes the room appear to dissolve into a strip of paper, and coming
 * back out of it the strip of paper appears to become cast iron. Cutting to a
 * detail and cutting back out of it is better grammar and it is also the only
 * way the band reads as a separate place rather than as a transition effect.
 */
const DISSOLVE = [0.5, 0, 0]

/**
 * Frames for one opening shot: the generated take if there is one, and a
 * zoompan move over the still if there is not.
 *
 * The generated take is passed through WHOLE - every decoded frame, in order,
 * exactly once. This is the one place in the build with no retiming, and the
 * reason is the reason INTRO_FPS exists: the delivered cadence was chosen to
 * match the source, so there is nothing left to retime. `seconds` therefore
 * only describes the fallback, and a generated shot is as long as it is.
 *
 * Nothing in here is registered or rim-pinned, unlike the table clips. The
 * opening plays full frame with no DOM over it, so there is no hole to keep
 * lined up - and these shots are supposed to have a moving camera, so holding
 * them still would remove the only thing they are for.
 *
 * What these shots are NOT is cheaper. The zoompan opening was 726 KB on the
 * phone tier against a 400 KB budget, and the reasonable-sounding guess was
 * that real camera movement would compress better than a synthetic crop,
 * because a fake move resamples a still every frame and produces a shimmer
 * that is not in the picture and cannot be predicted from it.
 *
 * Measured, it went the other way: 1410 KB. The guess had the mechanism right
 * and the magnitude backwards. A dolly through a room generates parallax, and
 * parallax is genuinely new information every frame - occluded things coming
 * into view - which is the expensive kind. A crop of a still is, whatever else
 * is wrong with it, a crop of something the encoder has already seen.
 *
 * So the opening earns its place on how it looks and not on what it costs, and
 * what it costs is handled by encoding it to the budget. See vp9ToBudget.
 */
function shotFrames(tag, source, seconds, fallback) {
  const mp4 = join(ROOT, 'clipsrc', 'generated', `intro_${tag}.mp4`)
  if (!existsSync(mp4)) return pushIn(source, seconds, fallback)

  const dir = join(CACHE, `shot-${digest(mp4)}`)
  if (!force && existsSync(dir) && readdirSync(dir).length) {
    return readdirSync(dir).sort().map((f) => join(dir, f))
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  ff(['-i', mp4, '-vf', `scale=${W}:${H}`, join(dir, '%05d.png')])
  return readdirSync(dir).sort().map((f) => join(dir, f))
}

/*
 * Four shots, about eleven seconds, and all four are inside the saloon.
 *
 * There used to be a fifth place: the opening began outside on a dark frontier
 * street with warm light coming out of a doorway, and pushed in toward it. It
 * was the prettiest shot in the project and it was the wrong one, for a reason
 * worth keeping written down. Everything this table is about happens in one
 * room among a crowd of people - the noise, the reactions, the fact that the
 * room knows something before you do - and an establishing shot spends the
 * player's first three seconds on a building. A door you have not gone through
 * yet cannot be noisy. So the opening now starts already inside, in the loud
 * part of the evening, and the first thing the player is given is the crowd.
 *
 * The order is the argument the opening is making: here is a room full of
 * people, here is the one thing in it they have all stopped to watch, here is
 * the part of that thing you are not allowed to see, and here it is in front
 * of you with your hand on the arm. It ends on the machine because the screen
 * after it asks which machine you want, and because the last shot of an
 * opening is the one the player is still looking at when they get control.
 *
 * Shot three is the one the opening exists for: a reel band lying on a bench
 * with a bell cut out of it. With its caption it teaches the player that the
 * odds live on the bands and not on the payout card, which is the entire
 * game, without a tutorial saying so.
 */
function buildOpening() {
  const shots = [
    // Inside, already. Down the bar, through the crowd, in the loud hour.
    { tag: 'bar', frames: shotFrames('bar', 'intro_bar', 3.0, { from: 1.0, to: 1.11, panX: 0.02 }) },
    // Down the room, past the card tables, to the one knot of people not talking.
    { tag: 'room', frames: shotFrames('room', 'intro_room', 3.0, { from: 1.14, to: 1.02, panY: -0.01 }) },
    // And the thing you are not allowed to see, on a bench in the back room.
    { tag: 'band', frames: shotFrames('band', 'intro_band', 3.0, { from: 1.0, to: 1.12, panX: -0.03 }) },
    // The machine, and your hand already on the arm.
    { tag: 'machine', frames: shotFrames('machine', 'machine_rest', 2.4, { from: 1.1, to: 1.0 }) },
  ]

  const segs = shots.map((s) => intermediate(s.frames, s.tag, INTRO_FPS))
  const inputs = segs.flatMap((s) => ['-i', s.path])

  let acc = segs[0].seconds
  let label = '0:v'
  const chain = []
  for (let i = 1; i < segs.length; i++) {
    const out = `x${i}`
    const want = DISSOLVE[i - 1] ?? 0.5
    // xfade needs a duration, so a "cut" is the shortest one it will take.
    const d = want === 0 ? 2 / INTRO_FPS : want
    chain.push(`[${label}][${i}:v]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}[${out}]`)
    acc = acc + segs[i].seconds - d
    label = out
  }
  chain.push(`[${label}]fade=t=in:st=0:d=0.7,fade=t=out:st=${(acc - 0.6).toFixed(3)}:d=0.6[v]`)

  const total = Math.round(acc * INTRO_FPS)
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
function buildPlates() {
  mkdirSync(ART, { recursive: true })
  for (const name of SHOWN) {
    // plateFrame, not a raw convert: the plate the browser cross-fades to has
    // to wear the same rim as the footage it is revealed from underneath.
    ff(['-i', plateFrame(name), '-q:v', '4', join(ART, `${name}.jpg`)])
  }
  console.log(`${SHOWN.length} plates -> ${ART}`)
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
  /*
   * 1500 KB and 380 KB. The phone figure is the VIDEO.md per-clip ceiling with
   * a little headroom; the desktop one is a judgement, and the judgement is
   * that a cinematic nobody watches twice had been taking 5.1 MB, more than a
   * quarter of the entire table, which no amount of it being pretty justifies.
   */
  const n = encode('intro', frames, { fps: INTRO_FPS, budget: [1500, 380] })
  console.log(`${'intro'.padEnd(10)} ${String(n).padStart(3)} frames  ${(n / INTRO_FPS).toFixed(2)}s @${INTRO_FPS}`)
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
