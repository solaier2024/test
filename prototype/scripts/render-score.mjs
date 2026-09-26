/**
 * Bounces the score to .wav files so it can be listened to and measured.
 *
 * The music is synthesised live in a browser, which makes it awkward to judge
 * and impossible to diff. This drives exactly the same modules through an
 * OfflineAudioContext instead of the wall clock, so what comes out is what
 * the game plays, only faster than real time and in a file.
 *
 *   node scripts/render-score.mjs [outDir]
 *
 * Needs `npm run dev` running: the modules are pulled straight from Vite so
 * there is no second copy of the score to fall out of date.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5173/'
const OUT = process.argv[2] ?? '/tmp/score'
mkdirSync(OUT, { recursive: true })

/** What to bounce: the opening, and the table at both ends of its range. */
const TAKES = [
  { name: 'intro', kind: 'intro', level: 0, seconds: 12 },
  { name: 'title', kind: 'title', level: 0, seconds: 11 },
  // Low enough that the gallop is the only percussion, which is what makes
  // this take worth having: the hoofbeat timing can be measured off it.
  { name: 'menu', kind: 'menu', level: 0.1, seconds: 12 },
  { name: 'table_cold', kind: 'table', level: 0.1, seconds: 11 },
  // Two full passes, because the second one is arranged differently.
  { name: 'table_hot', kind: 'table', level: 1, seconds: 21 },
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
  const b64 = await page.evaluate(async ({ kind, level, seconds }) => {
    const rate = 44100
    const offline = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate)

    /*
     * The engine reaches for `new AudioContext()` exactly once and caches it.
     * Handing it the offline context is what makes the same code renderable;
     * a second copy of the score built for testing would be worthless.
     */
    window.AudioContext = function () {
      return offline
    }

    const music = await import('/src/audio/music.ts')
    if (kind === 'intro') music.startIntroScore(0)
    else music.renderLoop(kind, level, seconds)

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
