#!/usr/bin/env node
/*
 * Drives a real browser through a real session and photographs it.
 *
 *   node scripts/shots.mjs                      # against the dev server
 *   BASE=https://example.com/slots/ node scripts/shots.mjs
 *
 * This exists because of a mistake this series has now made several times:
 * concluding an effect is broken, or is fine, by looking at the running thing
 * and forming an impression. A crowd reacting for two seconds in a picture
 * that is mostly shadow is exactly the sort of thing an impression gets wrong
 * in both directions - the first manual pass over this table reported that the
 * room never reacted to a spin at all, and it always had.
 *
 * So the shots are taken at stated offsets from a stated event, and next to
 * each one the harness prints which plate and which clip were on screen and
 * what the room was saying. That is not a substitute for looking at the
 * pictures; it is what makes looking mean something, because it says which
 * two pictures to compare and what each was supposed to be showing.
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Every frame of every round, for looking at while working. Not committed. */
const SCRATCH = join(HERE, '..', '.shots')
/** The handful a reader needs, under names that say what they show. */
const OUT = join(HERE, '..', 'docs')
const BASE = process.env.BASE ?? 'http://127.0.0.1:5180/'

/*
 * Seed 51 on the crooked machine, chosen by enumerating seeds until one dealt
 * all three things worth photographing inside four pulls:
 *
 *   1  near miss   the first two match, the room comes forward, the third
 *                  band lands one stop off and stays leaning
 *   2  jackpot     the same held breath, and this time three stars - which is
 *                  the only pull in the run that reaches roar_held
 *   3  plain loss  no tease at all, the room sighs from resting
 *   4  near miss   again, because it is the shot the table is built around
 *
 * Without a fixed seed the harness would have to pull until a win turned up,
 * and "pull until it happens" is exactly the procedure that reports a thing
 * never happens.
 */
const SEED = 51
const url = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`

/*
 * Reading the state has to be CHEAP, and finding that out was the second
 * harness bug of the day. Compositing the plate onto a canvas and walking the
 * pixels took about six seconds per sample, so every offset after the first
 * one in a round was not an offset at all - the run simply went as fast as it
 * could and printed the times it had intended to hit. It reported a room
 * reacting 1.4 seconds before the reels could possibly have stopped.
 *
 * So the sample is three attribute reads, and the ELAPSED time is printed
 * rather than the requested one. A row whose elapsed time has drifted past
 * its offset is a row whose picture is of some other moment, and saying so
 * costs one subtraction.
 */
const state = (page) =>
  page.evaluate(() => ({
    plate: document.querySelector('.plate.arriving')?.getAttribute('src').split('/').pop() ?? '-',
    film: document.querySelector('video.clip')?.getAttribute('src').split('/').pop() ?? '-',
    said: document.querySelector('.said')?.textContent ?? '-',
  }))

/*
 * Which scratch frames are worth keeping, and what they are actually of.
 *
 * Naming them by round would be naming them by accident. Naming them by what
 * happened is only possible because SEED is fixed: "round 2 at 5.1s" is always
 * the jackpot breaking out of a held breath, on every machine, forever. If a
 * timing or a band ever changes, these names go wrong loudly rather than
 * quietly becoming pictures of something else.
 */
const KEEP = {
  menu: 'menu',
  table_rest: 'table_rest',
  call_watching: 'call_watching',
  call_verdict: 'call_verdict',
  r1_spin_late: 'spin',
  r1_lean: 'near_miss_held',
  r4_tease_hold: 'near_miss_broken',
  r2_tease_hold: 'win',
  r3_react_open: 'loss',
}

const shot = async (page, name) => {
  const s = await state(page)
  const file = join(SCRATCH, `${name}.jpg`)
  await page.screenshot({ path: file, quality: 88, type: 'jpeg' })
  if (KEEP[name]) copyFileSync(file, join(OUT, `${KEEP[name]}.jpg`))
  return s
}

rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(SCRATCH, { recursive: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
/*
 * reducedMotion is pinned. Headless Chromium answers "reduce" by default, and
 * App.tsx honours that by running a pull at 0.45x - so an unpinned harness
 * measures a table nobody is playing and every offset below is wrong by more
 * than a second. The reduced path is a real path and deserves its own run;
 * it is not the one these timings describe.
 */
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
})
await skipIntro(page, url)

await page.waitForSelector('.machines button', { timeout: 30000 })
await shot(page, 'menu')

// The crooked one: the most reactions per pull, so the fewest spins to see all of them.
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(1200)
console.log('at rest        ', await shot(page, 'table_rest'))

/*
 * One pull, photographed on a timetable rather than whenever it felt right.
 * Every offset below is derived from a constant in App.tsx rather than picked
 * by eye, so when a timing changes the row that goes wrong says which one:
 *
 *   lever 0.3s, then the bands rest at 1.25 / 2.0 / 2.85s, the room answers
 *   BEAT 0.26s later and holds for 2.1s. A tease replaces the third rest with
 *   HANG 4.15s, so it resolves at 4.71s instead of 3.41s - and the reaction
 *   then has to break out of a held breath instead of out of nothing.
 */
const OFFSETS = [
  [400, 'spin_early', 'lever down, first band still running'],
  [1800, 'spin_late', 'first band rested, third still running'],
  // The room comes forward the instant the first two agree, 60ms after the
  // second band rests. On a tease this is the held breath; on an ordinary
  // pull nothing happens here at all, and the pair of pictures is the point.
  [2500, 'lean', 'the first two have agreed, or they have not'],
  [3800, 'react_open', 'an ordinary pull has resolved; a tease is still hanging'],
  // A tease has not resolved at any offset above. Without this row the harness
  // reports "no reaction" on exactly the pulls that produce the biggest one.
  [5100, 'tease_hold', 'a hung third band has resolved'],
  [8000, 'react_gone', 'reaction dropped, plates dissolved, idle loop back'],
]

for (let round = 1; round <= 4; round++) {
  const t0 = Date.now()
  await page.locator('button.lever').click()
  for (const [at, name, why] of OFFSETS) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)))
    /* The line is read in the same sample as the picture. Reading it once at
     * the end of the round instead reports "(nothing)" every time, because by
     * then the room has stopped saying it - a harness bug that looks exactly
     * like the feature being broken. */
    const elapsed = Date.now() - t0
    const s = await shot(page, `r${round}_${name}`)
    console.log(
      `round ${round} ${String(elapsed).padStart(5)}ms (want ${String(at).padStart(4)})  ` +
        `${name.padEnd(11)} ${s.plate.padEnd(19)} ${s.film.padEnd(16)} ${s.said.padEnd(40)} ${why}`,
    )
  }
  await page.waitForTimeout(900)
}

// And the accusation, which is the only thing that ends the session early.
await page.keyboard.press('c')
await page.waitForTimeout(700)
console.log('calling        ', await shot(page, 'call_watching'))
await page.waitForTimeout(1600)
console.log('verdict        ', await shot(page, 'call_verdict'))

await browser.close()
console.log(`\nevery frame -> ${SCRATCH}\nkept        -> ${OUT}`)
