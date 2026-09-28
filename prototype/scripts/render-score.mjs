/**
 * Bounces the score and the one-shots to .wav files so they can be listened
 * to and measured.
 *
 * The audio is synthesised live in a browser, which makes it awkward to judge
 * and impossible to diff. This drives exactly the same modules through an
 * OfflineAudioContext instead of the wall clock, so what comes out is what
 * the game plays, only faster than real time and in a file.
 *
 *   node scripts/render-score.mjs [outDir]
 *
 * Needs `npm run dev` running: the modules are pulled straight from Vite so
 * there is no second copy of the audio to fall out of date.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.GAME_URL ?? 'http://localhost:5173/'
const OUT = process.argv[2] ?? '/tmp/score'
mkdirSync(OUT, { recursive: true })

/**
 * What to bounce.
 *
 * The five `table_*` takes are the point of the whole file: they are the same
 * arrangement at five points along the live-chamber odds, so "does it build"
 * is a column of numbers rather than an opinion.
 */
const TAKES = [
  { name: 'intro', kind: 'intro', seconds: 12 },
  { name: 'title', kind: 'title', level: 0, seconds: 11 },
  // Low enough that the gallop is the only percussion, which is what makes
  // this take worth having: the hoofbeat timing can be measured off it.
  { name: 'menu', kind: 'menu', level: 0.1, seconds: 12 },
  // Named for the odds the player is looking at, and fed the intensity App
  // would actually pass for them, so the numbers can be read straight across.
  { name: 'table_loading', kind: 'table', level: 0.06, seconds: 10 },
  { name: 'table_odds_00', kind: 'table', level: 0.16, seconds: 10 },
  { name: 'table_odds_25', kind: 'table', level: 0.37, seconds: 10 },
  { name: 'table_odds_50', kind: 'table', level: 0.58, seconds: 10 },
  { name: 'table_odds_75', kind: 'table', level: 0.79, seconds: 10 },
  { name: 'table_odds_100', kind: 'table', level: 1, seconds: 10 },
  // Two full passes, because the second one is arranged differently.
  { name: 'table_hot', kind: 'table', level: 1, seconds: 21 },

  { name: 'sfx_gunshot', kind: 'sfx', call: 'playGunshot', seconds: 2.6 },
  { name: 'sfx_click', kind: 'sfx', call: 'playClick', seconds: 2.6 },
  { name: 'sfx_cock', kind: 'sfx', call: 'playCock', seconds: 1.6 },
  { name: 'sfx_heartbeat', kind: 'sfx', call: 'playHeartbeat', seconds: 1.6 },
  { name: 'sfx_sting_win', kind: 'sfx', call: 'playSting', arg: true, seconds: 3.2 },
  { name: 'sfx_sting_loss', kind: 'sfx', call: 'playSting', arg: false, seconds: 3.2 },
  { name: 'sfx_spin', kind: 'sfx', call: 'playSpin', seconds: 2.4 },

  /*
   * The two that actually settle the argument: the loudest the score ever
   * gets, with a shot fired over the top of it. If the ducking works the
   * report still owns the moment; if it does not, this is where it shows.
   */
  { name: 'mix_shot', kind: 'table', level: 1, seconds: 8, fire: { at: 3, call: 'playGunshot' } },
  { name: 'mix_click', kind: 'table', level: 1, seconds: 8, fire: { at: 3, call: 'playClick' } },
]

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

/*
 * A bare document on the dev server's origin, rather than the game itself.
 * The app would boot first and hand the engine a real AudioContext, and the
 * engine keeps the first one it is given - the offline render would then go
 * to a context nobody is listening to and come back silent.
 */
await page.route(BASE, (route) =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>score</title>' }),
)
await page.goto(BASE)

for (const take of TAKES) {
  const b64 = await page.evaluate(async ({ kind, level, seconds, call, arg, fire }) => {
    const rate = 44100
    const offline = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate)

    /*
     * The engine reaches for `new AudioContext()` exactly once and caches it.
     * Handing it the offline context is what makes the same code renderable;
     * a second copy of the audio built for testing would be worthless.
     */
    window.AudioContext = function () {
      return offline
    }

    const music = await import('/src/audio/music.ts')
    const sfx = await import('/src/audio/sfx.ts')

    if (kind === 'intro') music.startIntroScore(0)
    else if (kind === 'sfx') sfx[call](arg)
    else music.renderLoop(kind, level, seconds)

    /*
     * Firing part-way in needs the render paused at that point, because the
     * one-shots all schedule themselves from `currentTime` and there is no
     * way to ask them for a future one. The suspend is armed rather than
     * awaited: it only comes due once rendering is running, so waiting on it
     * first is a deadlock.
     */
    if (fire) {
      void offline.suspend(fire.at).then(() => {
        sfx[fire.call]()
        void offline.resume()
      })
    }

    const rendered = await offline.startRendering()

    const frames = rendered.length
    const view = new DataView(new ArrayBuffer(44 + frames * 4))
    const ascii = (at, s) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)))
    ascii(0, 'RIFF')
    view.setUint32(4, 36 + frames * 4, true)
    ascii(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 2, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 4, true)
    view.setUint16(32, 4, true)
    view.setUint16(34, 16, true)
    ascii(36, 'data')
    view.setUint32(40, frames * 4, true)

    const left = rendered.getChannelData(0)
    const right = rendered.getChannelData(1)
    for (let i = 0; i < frames; i++) {
      for (const [ch, at] of [
        [left, 44 + i * 4],
        [right, 46 + i * 4],
      ]) {
        view.setInt16(at, Math.max(-1, Math.min(1, ch[i])) * 32767, true)
      }
    }

    const bytes = new Uint8Array(view.buffer)
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(s)
  }, take)

  writeFileSync(`${OUT}/${take.name}.wav`, Buffer.from(b64, 'base64'))
  console.log(`${OUT}/${take.name}.wav`)

  // The engine caches its context for the life of the page, so each take
  // needs a page of its own.
  await page.reload({ waitUntil: 'networkidle' })
}

await browser.close()
if (errors.length) {
  console.error('\n' + errors.join('\n'))
  process.exit(1)
}
