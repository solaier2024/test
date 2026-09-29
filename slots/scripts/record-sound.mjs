#!/usr/bin/env node
/*
 * The walkthrough again, with the sound on it.
 *
 *   npm run demo:sound
 *   GAME_URL=https://example.com/slots/ node scripts/record-sound.mjs
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
const DISPLAY = process.env.CAPTURE_DISPLAY ?? ':99'
const SINK = 'slotsrec'
/** The picture. What ends up in the file. */
const WIDTH = 1440
const HEIGHT = 900
/** Room above it for the browser's own furniture, which is cropped away. */
const CHROME = 120
/* A dark head and tail, so the take does not begin on a white browser and end
 * on a hard cut. */
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

const ffmpeg = spawn('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'x11grab', '-draw_mouse', '1', '-video_size', `${grab.w}x${grab.h}`,
  '-framerate', '30', '-i', `${DISPLAY}.0+0,${grab.top}`,
  '-f', 'pulse', '-i', `${SINK}.monitor`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-g', '60',
  '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-movflags', '+faststart',
  OUT,
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

// 'q' rather than a signal: ffmpeg then writes its trailer and the moov atom,
// and a killed mp4 is an unplayable one.
ffmpeg.stdin.write('q')
await new Promise((done) => ffmpeg.on('close', done))

await browser.close()
if (moduleId) run('pactl', ['unload-module', moduleId], env)
if (xvfb) process.kill(-xvfb.pid, 'SIGTERM')

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

const probe = run('ffmpeg', ['-hide_banner', '-i', OUT, '-f', 'null', '-'])
const duration = /Duration:\s*([\d:.]+)/.exec(probe.stderr)

console.log(`recorded ${OUT}  ${grab.w}x${grab.h}  ${duration?.[1] ?? '?'}`)
console.log(`  the room sits at ${room.toFixed(1)} dBFS`)
for (const e of events) console.log(`  ${e.at.toFixed(1).padStart(5)}s  ${e.db.toFixed(1)} dBFS`)
if (hush.length) console.log(`  ${hush[0].at.toFixed(1).padStart(5)}s  ${hush[0].db.toFixed(1)} dBFS  <- the room stops dead`)

const wrong = []
if (events.length < 4) wrong.push(`only ${events.length} loud moments; the walkthrough plays four pulls`)
if (!hush.length) wrong.push('nothing goes quiet; calling the house is supposed to stop the room')
if (wrong.length) {
  console.error(`\nFAILED\n  ${wrong.join('\n  ')}`)
  process.exit(1)
}
console.log(`\nOK: ${events.length} reactions and a hush, on the file`)
