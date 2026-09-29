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
 */
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { chromium } from 'playwright'

/*
 * Seed 51, the same night shots.mjs photographs, so a frame in docs/ and a
 * moment on the recording are the same moment. It deals a near miss, a
 * jackpot out of a held breath and a plain loss inside four pulls - see the
 * note in shots.mjs for how it was found.
 */
const SEED = 51
const BASE = process.env.GAME_URL ?? 'http://127.0.0.1:5180/'
const URL = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`
const OUT = process.env.OUT_DIR ?? 'demo-capture'

const width = 1440
const height = 900
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

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

// ---------- the opening ----------
// Eleven seconds, and it runs its middle in Spanish to put both caption
// tracks on tape. Nothing here skips it; it hands over on its own.
await page.waitForSelector('.intro-video', { timeout: 30000 })
await sleep(3800)
await page.locator('button.lang').click()
await sleep(3600)
await page.locator('button.lang').click()
await page.waitForSelector('.machines button', { timeout: 40000 })

// ---------- the picker ----------
// Long enough to read all three blurbs, because the choice they describe -
// which machine to spend the night suspecting - is the whole game.
await sleep(4200)
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })

// A beat on the table at rest: the lamp gutters, the room shifts, nothing
// else happens. It is the shot that makes the reactions mean something.
await sleep(2600)

/*
 * Four pulls on the timetable from App.tsx: lever 0.3s, bands at 1.25 / 2.0 /
 * 2.85, a tease holds the third to 4.15, the room answers 0.26 later and
 * holds 2.1. So a tease is finished at 6.8s and an ordinary pull at 5.5s.
 * 8 seconds covers both and leaves the idle loop visible in between, which is
 * what stops the recording looking like a highlight reel.
 */
for (let round = 1; round <= 4; round++) {
  await page.locator('button.lever').click()
  await sleep(8000)
}

// ---------- and the accusation ----------
// Four pulls is nowhere near enough evidence and the room says so. That is
// the honest ending to demonstrate: calling early is a bet you lose.
await sleep(1200)
await page.keyboard.press('c')
await sleep(6000)

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
