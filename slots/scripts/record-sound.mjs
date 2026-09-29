#!/usr/bin/env node
/*
 * The walkthrough again, with the sound on it.
 *
 *   npm run demo:sound
 *   GAME_URL=https://example.com/slots/ node scripts/record-sound.mjs
 *   FFSTATS=1 npm run demo:sound     ffmpeg's own frame counter, live, which
 *                                    is the only way to see the capture fall
 *                                    behind while it is happening
 *
 * WHY THIS EXISTS AND WHY IT IS NOT JUST record-demo.mjs WITH A FLAG.
 *
 * The brief asked for a room that sighs or cheers, so the only honest
 * demonstration of this table has a soundtrack. There is no way to get one
 * out of a page recording. The audio here is not a file being played, it is
 * synthesised in the page at runtime by src/audio - fourteen formant voices,
 * a room tone and an upright piano - and Playwright's recorder captures the
 * compositor and nothing else. Whatever it produces is silent by
 * construction, not by oversight.
 *
 * So this one records a SCREEN instead, which means standing up the machinery
 * a screen implies:
 *
 *   Xvfb          a display for a headed browser to draw on
 *   pulseaudio    a null sink for it to play into, whose monitor can be read
 *                 back like a microphone
 *   ffmpeg        x11grab and the pulse monitor, muxed as one file
 *
 * All three are started here and torn down at the end, so the script is the
 * whole procedure and there is no README step that gets skipped.
 *
 * ON THE SECOND INPUT STARVING THE FIRST, which went wrong here silently for
 * as long as this script has existed, and which the sound checks below cannot
 * see. The capture is real time: frames x11grab fails to deliver are filled
 * in later by repeating the last one, so the file comes out the right length,
 * the right size and the right frame rate whether or not the pictures in it
 * are new. The delivered take was running at 16% fresh frames - five a second,
 * with runs of twenty identical ones. It looked like a slideshow, and the
 * first thing it wrecked was the hand on the lever, which then reads as a
 * cut-out flipping between two poses rather than an arm being hauled down.
 *
 * The cause is not the encoder and not the machine. ffmpeg's two live inputs
 * share a demuxer, and the pulse monitor blocks in its read; with the default
 * eight-packet queue the x11grab side cannot buffer through that block, so it
 * misses its slot and drops the frame. Measured on a BLACK PAGE with nothing
 * happening: 29.6fps with the video input alone, 2.7fps the moment the pulse
 * input is added, at speed=1.01x throughout - the process was never behind,
 * it was waiting. -thread_queue_size on both inputs restores it. Raising it
 * beyond 1024 changes nothing, which is the tell that this is a blocking
 * problem and not a capacity one.
 *
 * checkMotion() at the end fails the run if that ever slips again, because
 * nothing else in the project would notice: sound, duration, size and frame
 * rate are all unaffected by it.
 *
 * ON SYNCHRONISATION, which is the thing that goes wrong. Both streams are
 * stamped off the wall clock by ffmpeg, so they stay together for the length
 * of a minute-long take without any correction. The old warning at the top of
 * record-demo.mjs - that screen capture time-compresses and would land the
 * held breath and the reaction that breaks it on one frame - is about capture
 * that stamps frames as they arrive and then declares a constant rate. It
 * does not apply to a real-time x11grab, which drops or repeats frames to
 * keep wall-clock duration and therefore keeps the 260ms between the last
 * band stopping and the room answering.
 *
 * The grab is of the page and not of the whole screen: --kiosk is ignored
 * under Playwright, so the tab bar and the address bar are there whether they
 * are wanted or not, and the answer is to capture the rectangle underneath
 * them. Its height is measured from inside the page rather than assumed,
 * because the chrome is 87 pixels tall until the day it is not.
 *
 * The pointer IS drawn, because half of what this is demonstrating is a hand
 * taking hold of a lever.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { chromium } from 'playwright'
import { SEED, walkthrough } from './lib/walkthrough.mjs'

const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5180/'
const URL = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`
const OUT = process.env.OUT ?? 'demo-capture/walkthrough_sound.mp4'
/** Where the take lands before it is encoded for delivery. Deleted at the end. */
const SCRATCH = OUT.replace(/\.[^.]+$/, '') + '.capture.mkv'
const DISPLAY = process.env.CAPTURE_DISPLAY ?? ':99'
const SINK = 'slotsrec'
/** The picture. What ends up in the file. */
const WIDTH = 1440
const HEIGHT = 900
/** Room above it for the browser's own furniture, which is cropped away. */
const CHROME = 120
/* A beat at each end: black at the head while the page is still a blank
 * document, and a held last frame at the tail rather than a hard cut. The
 * head comes out around two seconds, because ffmpeg takes most of a second
 * to open the pulse source before it grabs anything. */
const PREROLL = 1200

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, args, env) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } })

function need(cmd) {
  if (spawnSync('sh', ['-c', `command -v ${cmd}`]).status !== 0) {
    console.error(`${cmd} is not installed. This script needs Xvfb, pulseaudio and ffmpeg:\n` +
      '  sudo apt-get install -y xvfb pulseaudio pulseaudio-utils ffmpeg')
    process.exit(1)
  }
}
for (const cmd of ['Xvfb', 'pulseaudio', 'pactl', 'ffmpeg']) need(cmd)

const XDG = process.env.XDG_RUNTIME_DIR ?? '/tmp/slots-capture-runtime'
await mkdir(XDG, { recursive: true })
const env = { DISPLAY, XDG_RUNTIME_DIR: XDG }

/* ---- the display ------------------------------------------------------- */

let xvfb = null
if (run('sh', ['-c', `xdpyinfo -display ${DISPLAY} >/dev/null 2>&1`]).status !== 0) {
  xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', `${WIDTH}x${HEIGHT + CHROME}x24`, '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: true,
  })
  await sleep(1500)
}

/* ---- the sink ---------------------------------------------------------- */

/*
 * A null sink rather than a real device: there is no sound card here, and
 * more to the point a null sink cannot be busy, cannot resample behind our
 * back and has a monitor source that is exactly what was played into it.
 */
run('pulseaudio', ['--start', '--exit-idle-time=-1'], env)
await sleep(1200)
const loaded = run('pactl', ['load-module', 'module-null-sink', `sink_name=${SINK}`,
  `sink_properties=device.description=${SINK}`], env)
const moduleId = loaded.stdout.trim()
run('pactl', ['set-default-sink', SINK], env)

/* ---- the browser ------------------------------------------------------- */

await mkdir(OUT.replace(/\/[^/]+$/, ''), { recursive: true })
await rm(OUT, { force: true })

const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, ...env },
  args: [
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${WIDTH},${HEIGHT + CHROME}`,
    '--window-position=0,0',
  ],
})
const page = await browser.newPage({
  viewport: null,
  // A headed browser does not ask for reduced motion, but say so anyway: the
  // table honours it by skipping the opening and running a pull at 0.45x, and
  // a recording of that is a recording of a different game.
  reducedMotion: 'no-preference',
})

// Somewhere dark to sit while ffmpeg opens its files, so the take does not
// start on a white page.
await page.goto('data:text/html,<body style="margin:0;background:%23000"></body>')
await sleep(600)

/*
 * Make the VIEWPORT exactly 1440x900, rather than the window.
 *
 * There is no window manager, so the window sits at the origin and the only
 * thing between it and the page is the browser's own furniture - which is 88
 * pixels tall and 2 wide on this build and is not worth hard-coding. Measure
 * it, grow the window by exactly that much, and check the result, so the file
 * is the size it says it is instead of 1438x932.
 */
const measure = () => page.evaluate(() => ({
  top: window.outerHeight - window.innerHeight,
  side: window.outerWidth - window.innerWidth,
  w: window.innerWidth,
  h: window.innerHeight,
}))

const furniture = await measure()
const cdp = await page.context().newCDPSession(page)
const { windowId } = await cdp.send('Browser.getWindowForTarget')
await cdp.send('Browser.setWindowBounds', {
  windowId,
  bounds: { left: 0, top: 0, width: WIDTH + furniture.side, height: HEIGHT + furniture.top },
})
await sleep(500)

const view = await measure()
if (view.w !== WIDTH || view.h !== HEIGHT) {
  console.error(`wanted a ${WIDTH}x${HEIGHT} viewport and got ${view.w}x${view.h}; ` +
    `raise CHROME above ${CHROME} if the browser ran out of screen`)
  process.exit(1)
}
const grab = { w: view.w, h: view.h, top: view.top }

/* ---- rolling ----------------------------------------------------------- */

/* Lossless and thrown away at the end - about 800MB a minute, on disk only
 * for the length of this script. Matroska because a scratch file is the one
 * most likely to be interrupted, and a truncated mkv still plays. */
const ffmpeg = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', process.env.FFSTATS ? 'info' : 'error',
  '-thread_queue_size', '1024',
  '-f', 'x11grab', '-draw_mouse', '1', '-video_size', `${grab.w}x${grab.h}`,
  '-framerate', '30', '-i', `${DISPLAY}.0+0,${grab.top}`,
  '-thread_queue_size', '1024',
  '-f', 'pulse', '-i', `${SINK}.monitor`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0',
  '-c:a', 'pcm_s16le', '-ac', '2',
  SCRATCH,
], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, ...env } })

await sleep(PREROLL)

await page.goto(URL, { waitUntil: 'domcontentloaded' })
const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
if (await notice.count()) {
  await notice.first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
}

await walkthrough(page, { withSound: true })

await sleep(PREROLL)

/* ---- cut --------------------------------------------------------------- */

// 'q' rather than a signal: ffmpeg then writes its trailer, and a killed
// container is an unplayable one.
ffmpeg.stdin.write('q')
await new Promise((done) => ffmpeg.on('close', done))

await browser.close()
if (moduleId) run('pactl', ['unload-module', moduleId], env)
if (xvfb) process.kill(-xvfb.pid, 'SIGTERM')

/* ---- and now encode it, with nothing waiting --------------------------- */

/*
 * Slowly, and at crf 18, because this table is mostly SUBTLE motion: a lamp
 * guttering, smoke drifting, a reel easing to a stop. At the settings that
 * fit on the real-time path those changes fall below the quantiser and the
 * encoder emits the previous frame - measured on ten seconds of the idle
 * table, from a capture that is 100% fresh:
 *
 *   veryfast crf21   3% fresh    0.6MB/10s   0.25x realtime
 *   veryfast crf18  70%          1.2MB
 *   slow     crf21  83%          1.0MB
 *   slow     crf18 100%          2.3MB       0.83x realtime
 *
 * So the freeze the reviewer saw had two halves and they needed different
 * repairs. The capture starving (above) was three frames a second of real
 * loss. This is the other half: a delivery encode that throws away the room.
 * 0.83x realtime is not a margin worth trusting next to a browser, hence the
 * scratch file.
 */
const encode = run('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', SCRATCH,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '60',
  '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-movflags', '+faststart',
  OUT,
])
if (encode.status !== 0) {
  console.error(encode.stderr)
  process.exit(1)
}
await rm(SCRATCH, { force: true })

/* ---- and read the soundtrack back off the file ------------------------- */

/*
 * Not "is there audio", which a rig can pass while recording a room tone and
 * nothing else. The take is supposed to contain four pulls that the crowd
 * answers and one accusation that shuts the room up, so the check is that the
 * file has four loud moments in it and one silent one.
 *
 * This is deliberately measured on the DELIVERABLE rather than in the browser.
 * verify-audio.mjs already proves the game makes the right noise at the right
 * moment; what nobody had proved is that any of it survived into the artifact
 * that gets attached to a pull request as evidence, and the first cut of this
 * script produced a beautiful, completely silent film.
 */
const RAW = `${OUT}.raw`
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT, '-ac', '1', '-ar', '8000', '-f', 's16le', RAW])
const { readFileSync, unlinkSync } = await import('node:fs')
const pcm = readFileSync(RAW)
unlinkSync(RAW)

const RATE = 8000
const WINDOW = RATE / 4
const level = []
for (let i = 0; i + WINDOW <= pcm.length / 2; i += WINDOW) {
  let sum = 0
  for (let j = 0; j < WINDOW; j++) {
    const v = pcm.readInt16LE((i + j) * 2) / 32768
    sum += v * v
  }
  level.push({ at: i / RATE, db: 20 * Math.log10(Math.sqrt(sum / WINDOW) + 1e-9) })
}

/* The room, taken as the median so four reactions and a hush cannot move it. */
const room = [...level].sort((a, b) => a.db - b.db)[Math.floor(level.length / 2)].db

/* One event, not one window: a reaction is about two seconds long and would
 * otherwise be counted eight times. */
const events = []
for (const l of level) {
  if (l.db < room + 7) continue
  const last = events[events.length - 1]
  if (last && l.at - last.at < 2.5) {
    if (l.db > last.db) { last.db = l.db; last.at = l.at }
    continue
  }
  events.push({ ...l })
}
/*
 * And the silence, which has to be looked for AFTER the room has been heard.
 * The take opens on a black screen while ffmpeg gets its files open, and that
 * silence would otherwise satisfy this check for the wrong reason - it passed
 * on the pre-roll the first time it was run.
 */
const hush = events.length ? level.filter((l) => l.at > events[0].at && l.db < room - 15) : []

/* ---- and that it is a film and not a slideshow ------------------------- */

/*
 * How many times a second the picture actually changes.
 *
 * Not a percentage of the frame rate, which is a number about the container:
 * a file can be 30fps and show twenty pictures, or 30fps and show three, and
 * the second one is a slideshow. Neither the sound checks above nor the
 * duration nor the file size can tell them apart, because a capture that
 * cannot keep up does not fail, it repeats the last frame.
 *
 * Measured small and in grey, because the question is whether the frame
 * CHANGED, not by how much. The idle table alone settles this: the lamps
 * gutter and the smoke drifts every rAF, so a still frame is never correct.
 *
 * A healthy take averages 26 a second: a flat 30 from the moment the table
 * appears, and 15 to 18 over the opening, because the opening is an OpenArt
 * clip being played back at its own frame rate and thirty distinct pictures
 * a second is not available from it. Fifteen is the floor - roughly where
 * motion stops reading as motion - and the take that prompted this check was
 * running at three.
 */
const SHRUNK = `${OUT}.gray`
const [gw, gh] = [180, 112]
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT,
  '-vf', `scale=${gw}:${gh},format=gray`, '-vsync', '0', '-f', 'rawvideo', SHRUNK])
const gray = readFileSync(SHRUNK)
unlinkSync(SHRUNK)
const frames = Math.floor(gray.length / (gw * gh))
let stale = 0
for (let i = 1; i < frames; i++) {
  const a = gray.subarray(i * gw * gh, (i + 1) * gw * gh)
  const b = gray.subarray((i - 1) * gw * gh, i * gw * gh)
  let d = 0
  for (let p = 0; p < a.length; p++) d += Math.abs(a[p] - b[p])
  if (d / a.length < 0.02) stale++
}

const probe = run('ffmpeg', ['-hide_banner', '-i', OUT, '-f', 'null', '-'])
const duration = /Duration:\s*([\d:.]+)/.exec(probe.stderr)
const seconds = level.length / 4
const moving = (frames - 1 - stale) / seconds

console.log(`recorded ${OUT}  ${grab.w}x${grab.h}  ${duration?.[1] ?? '?'}`)
console.log(`  the room sits at ${room.toFixed(1)} dBFS`)
for (const e of events) console.log(`  ${e.at.toFixed(1).padStart(5)}s  ${e.db.toFixed(1)} dBFS`)
if (hush.length) console.log(`  ${hush[0].at.toFixed(1).padStart(5)}s  ${hush[0].db.toFixed(1)} dBFS  <- the room stops dead`)
console.log(`  the picture changes ${moving.toFixed(1)} times a second, over ${frames} frames`)

const wrong = []
if (events.length < 4) wrong.push(`only ${events.length} loud moments; the walkthrough plays four pulls`)
if (!hush.length) wrong.push('nothing goes quiet; calling the house is supposed to stop the room')
if (moving < 15) wrong.push(`the picture only changes ${moving.toFixed(1)} times a second; this is a slideshow`)
if (wrong.length) {
  console.error(`\nFAILED\n  ${wrong.join('\n  ')}`)
  process.exit(1)
}
console.log(`\nOK: ${events.length} reactions and a hush, on a file that moves`)
