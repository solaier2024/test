#!/usr/bin/env node
/*
 * Records a real-time walkthrough of a session.
 *
 *   npm run demo
 *   GAME_URL=https://example.com/slots/ OUT_DIR=demo node scripts/record-demo.mjs
 *
 * Recording the page rather than the screen, for a reason that matters more
 * on this table than on the others: desktop screen capture time-compresses,
 * and the beats here are sub-second. The room comes forward 60ms after the
 * second band rests and answers 260ms after the third. Compressed, the held
 * breath and the reaction that breaks it land on the same frame, and the best
 * moment in the game disappears into an edit that never happened.
 *
 * Unlike shots.mjs this does NOT skip the opening, because the opening is
 * eleven seconds of the thing being demonstrated.
 *
 * This one is silent, and cannot be otherwise: the audio is synthesised in
 * the page and a page recording carries no audio track. record-sound.mjs is
 * the same walkthrough on a screen recorder with the sound on. Both call
 * lib/walkthrough.mjs so there is only ever one choreography.
 */
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { chromium } from 'playwright'
import { SEED, walkthrough } from './lib/walkthrough.mjs'

/*
 * Seed 51, the same night shots.mjs photographs, so a frame in docs/ and a
 * moment on the recording are the same moment. It deals a near miss, a
 * jackpot out of a held breath and a plain loss inside four pulls - see the
 * note in shots.mjs for how it was found.
 */
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5180/'
const URL = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`
const OUT = process.env.OUT_DIR ?? 'demo-capture'

const width = 1440
const height = 900

/* Only the webm, not the directory: record-sound.mjs writes its take in here
 * too, and an rm -rf of the whole folder quietly eats it. */
await mkdir(OUT, { recursive: true })
for (const f of await readdir(OUT)) {
  if (f.endsWith('.webm')) await rm(`${OUT}/${f}`, { force: true })
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({
  viewport: { width, height },
  recordVideo: { dir: OUT, size: { width, height } },
  // Headless Chromium asks for reduced motion, and this table honours that by
  // skipping the opening and running a pull at 0.45x. A recording of that is
  // a recording of a different game.
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded' })

const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
if (await notice.count()) {
  await notice.first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
}

await walkthrough(page)

await context.close()
await browser.close()

const files = await readdir(OUT)
const webm = files.find((f) => f.endsWith('.webm'))
if (!webm) {
  console.error('no video produced')
  process.exit(1)
}
await rename(`${OUT}/${webm}`, `${OUT}/demo.webm`)
console.log(`recorded ${OUT}/demo.webm`)
