#!/usr/bin/env node
/*
 * Plays the game, in a browser, with a pointer.
 *
 *   node scripts/verify-play.mjs [baseUrl]
 *
 * The other verify scripts each take one slice: the bands are checked by unit
 * tests, the footage by verify-lock, the mix by verify-audio, the layout by
 * shots-mobile. Every one of them can pass on a table nobody can actually
 * play, because none of them puts a hand on the machine and none of them
 * follows a coin from the purse to the payout and back out as a settlement.
 * That is the gap this file is for: the brief asked for a thing you can play,
 * not an art demo with a working engine behind it, and "you can play it" is a
 * claim about the whole chain at once.
 *
 * Four sections.
 *
 *   1. The lever is a control on the machine. Not that a button exists - that
 *      the knob is inside the picture, is big enough to hit, is the thing at
 *      the top of the stack where it is drawn, and answers a DRAG. Three of
 *      those four have been broken at some point in this project and none of
 *      them is visible in the source: the knob was fine and the heads-up
 *      display was lying over it, so the picture had a lever in it and the
 *      lever could not be pressed.
 *
 *   2. The money. A pull costs what the stake says and pays what the card
 *      says times what went in, checked against the purse rather than against
 *      the engine, because the engine is already pinned by unit tests and the
 *      thing that can still be wrong is the wiring between them.
 *
 *   3. The settlement, played out to the end on the crooked machine: the count
 *      builds, the call lights up, and the house pays at the level the night
 *      was played at. The second night is the interesting one - it raises the
 *      stake to three immediately before calling, and the payment must not
 *      move, because a settlement that tracked the stake showing at the call
 *      would just be a lever to yank on the last pull.
 *
 *   4. The ways out. Calling on a straight machine costs, and the night ends.
 *
 * Run against a dev server (npm run dev) or against the deployed URL. It is
 * not in the offline verify chain for that reason.
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180/'
/** Roughly the median night on the crooked machine is 20 pulls; allow three times that. */
const PATIENCE = 60
const SETTLEMENT = 45
const START_BANK = 60

const problems = []
let checks = 0
function expect(what, ok, detail) {
  checks++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what.padEnd(54)} ${detail}`)
  if (!ok) problems.push(`${what}: ${detail}`)
}

/*
 * Reduced motion, which the game honours by running a pull at 0.45x. A night
 * is twenty-odd pulls and this script plays two of them, so at full speed it
 * would spend most of five minutes watching reels it is not measuring. The
 * outcomes are identical either way - see App.tsx, where `reduced` scales the
 * timetable and touches nothing else.
 */
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'reduce',
})
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

/** The heads-up display, read the way a player reads it. */
const hud = () =>
  page.evaluate(() => {
    const n = (i) => Number((document.querySelectorAll('.hud span')[i]?.textContent ?? '').replace(/\D+/g, ''))
    return {
      bank: n(0),
      pulls: n(1),
      best: n(2),
      stake: Number(document.querySelector('.stake-coin.on')?.textContent ?? 0),
      ready: !!document.querySelector('.callout.ready'),
      over: !!document.querySelector('.table.over'),
    }
  })

const idle = () => page.waitForSelector('button.lever:not([disabled])', { timeout: 40000 })

/** Sits down at one of the three machines, from a clean sitting. */
async function sit(which, seed) {
  await skipIntro(page, `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${seed}`)
  await page.waitForSelector('.machines button', { timeout: 30000 })
  await page.locator('.machines button').nth(which).click()
  await idle()
}

/**
 * Takes hold of the knob and pulls it down, in steps, the way a hand does.
 *
 * Deliberately NOT page.click(). The lever fires from a pointermove crossing
 * the clutch, so a click exercises the tap fallback and leaves the drag - the
 * thing the brief actually asked for - untested.
 */
async function haul(fraction = 1) {
  const knob = await page.locator('button.lever-knob').boundingBox()
  const frame = await page.locator('.frame').boundingBox()
  const x = knob.x + knob.width / 2
  const y0 = knob.y + knob.height / 2
  /* The full throw is about 45% of the frame's height; the clutch is at 0.38
   * of the arc, so anything under about a fifth of the frame must not fire. */
  const travel = frame.height * 0.45 * fraction

  await page.mouse.move(x, y0)
  await page.mouse.down()
  let midway = null
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y0 + (travel * i) / 12)
    await page.waitForTimeout(16)
    if (i === 6) midway = await page.locator('button.lever-knob').boundingBox()
  }
  await page.mouse.up()
  return { start: knob, midway, frame }
}

/* ---- 1. the lever is a control on the machine ------------------------- */

await sit(2, 51)
const before = await hud()

const geometry = await page.evaluate(() => {
  const knob = document.querySelector('button.lever-knob')
  const frame = document.querySelector('.frame')
  if (!knob || !frame) return null
  const k = knob.getBoundingClientRect()
  const f = frame.getBoundingClientRect()
  const cx = k.x + k.width / 2
  const cy = k.y + k.height / 2
  return {
    w: Math.round(k.width),
    h: Math.round(k.height),
    /* Where in the picture it sits, as a fraction of the plate. At rest the
     * arm stands UP, so the ball is high and to the right of the casting -
     * about 65% across and 15% down, which is the hand's grip in the plate. */
    fx: (cx - f.x) / f.width,
    fy: (cy - f.y) / f.height,
    /* What a finger put on the knob would actually hit. */
    hit: document.elementFromPoint(cx, cy)?.closest('button')?.className ?? 'nothing',
  }
})

expect('the lever is drawn on the arm in the picture', geometry && geometry.fx > 0.55 && geometry.fx < 0.75 && geometry.fy > 0.05 && geometry.fy < 0.3,
  geometry ? `${(geometry.fx * 100).toFixed(0)}% across, ${(geometry.fy * 100).toFixed(0)}% down the plate` : 'no knob')
expect('and is big enough to take hold of', geometry.w >= 44 && geometry.h >= 44, `${geometry.w}x${geometry.h} CSS px`)
/*
 * The regression that prompted this check: the knob was present, correctly
 * placed and correctly sized, and the heads-up display was stretched across
 * the whole table on top of it, so every press landed on a div.
 */
expect('and nothing is lying on top of it', geometry.hit.includes('lever-knob'), `a finger there hits .${geometry.hit.split(' ')[0]}`)

/*
 * Half the throw. The clutch is at 0.38 and a real one does not spin from a
 * nudge, so this has to do nothing at all - which is also the check that the
 * pull below came from the drag and not merely from touching the knob.
 */
const nudge = await haul(0.4)
await page.waitForTimeout(900)
const nudged = await hud()
expect('a nudge short of the clutch does not spin it', nudged.pulls === before.pulls, `${nudged.pulls} pulls, purse still ${nudged.bank}`)
/*
 * But it does follow the hand, and along the arm's arc rather than straight
 * down: the knob swings out to the right as it falls, because it is pinned to
 * a pivot at the side of the casting. A ring that slid down the screen would
 * come off the painted arm within a few degrees.
 */
const swing = {
  down: nudge.midway.y - nudge.start.y,
  out: nudge.midway.x - nudge.start.x,
}
expect('and the grip follows the hand down the arm', swing.down > 8 && swing.out > 4,
  `${swing.down.toFixed(0)}px down and ${swing.out.toFixed(0)}px out, on an arc`)

await haul()
await idle()
const hauled = await hud()
expect('hauling it past the clutch plays a pull', hauled.pulls === before.pulls + 1, `${before.pulls} to ${hauled.pulls} pulls`)
expect('and the grip springs back to the top', Math.abs((await page.locator('button.lever-knob').boundingBox()).y - nudge.start.y) < 3, 'the arm is where it started')

/* ---- 2. the money -------------------------------------------------------- */

/*
 * Every reading here is off the purse rather than out of the engine. A stake
 * that the engine charges and the interface never shows, or shows and never
 * charges, is exactly the sort of thing the unit tests cannot see.
 *
 * The measurement is the SAME four pulls played twice, once at one coin and
 * once at three, which the fixed seed makes possible: the reels do not know
 * what was bet, so the two runs land on the same four lines and the only
 * difference between them is the money. That turns "it pays per coin" - the
 * claim now printed on the pay card - into one comparison, and it catches the
 * two ways it could be wrong in opposite directions: charging triple without
 * paying triple, or paying triple without charging.
 */
const SAMPLE = 4

async function fourPulls(stake) {
  await sit(2, 51)
  if (stake !== 1) await page.locator('.stake-coin', { hasText: String(stake) }).click()
  const showing = (await hud()).stake
  const open = (await hud()).bank
  for (let i = 0; i < SAMPLE; i++) {
    await page.locator('button.lever').click()
    await idle()
  }
  const close = await hud()
  return { showing, paid: close.bank - open + stake * SAMPLE, pulls: close.pulls }
}

const atOne = await fourPulls(1)
const atThree = await fourPulls(3)

expect('the stake can be raised between pulls', atThree.showing === 3, `${atThree.showing} coins a pull`)
expect('the same night at three coins pays three times as much', atOne.paid > 0 && atThree.paid === atOne.paid * 3,
  `${atOne.paid} coins out on ${SAMPLE} in, ${atThree.paid} on ${SAMPLE * 3}`)
expect('and costs three times as much to play', atThree.pulls === atOne.pulls, `${SAMPLE} pulls either way, ${SAMPLE} coins against ${SAMPLE * 3}`)
/*
 * The one number that must NOT move with the stake, and the reason the bet is
 * a decision rather than a variance dial: a pull is one look at the third
 * window whatever it cost.
 */
expect('but buys exactly the same amount of evidence', atThree.pulls === SAMPLE, `${SAMPLE} looks at the third band, at either price`)

await page.locator('.stake-coin', { hasText: '1' }).click()
expect('and the stake comes back down again', (await hud()).stake === 1, 'back to 1 coin a pull')

/* The bottom button is the way in for a keyboard, a screen reader and a phone
 * held upright, so it has to do the same thing the knob does. */
const beforeKey = await hud()
await page.keyboard.press('Space')
await idle()
expect('space bar pulls it too', (await hud()).pulls === beforeKey.pulls + 1, 'the lever is never the only way')

/* ---- 3. the settlement --------------------------------------------------- */

/**
 * Plays a whole night at one stake until the count is strong enough to call,
 * then optionally yanks the stake up and calls.
 */
async function night(stake, yankTo) {
  await sit(2, 51)
  if (stake !== 1) await page.locator('.stake-coin', { hasText: String(stake) }).click()
  let staked = 0
  let last = await hud()
  for (let i = 0; i < PATIENCE && !last.ready && !last.over; i++) {
    const s = last.stake
    await page.locator('button.lever').click()
    await idle()
    staked += s
    last = await hud()
  }
  if (yankTo) {
    await page.locator('.stake-coin', { hasText: String(yankTo) }).click()
    last = await hud()
  }
  const purse = last.bank
  await page.locator('button.callout').click()
  await page.waitForTimeout(2500)
  const after = await hud()
  return { ...last, staked, purse, paid: after.bank - purse, ended: after.over }
}

const flat = await night(1)
expect('a crooked machine can be counted out', flat.ready, `the call lit after ${flat.pulls} pulls`)
expect('and calling it pays the settlement', flat.paid === SETTLEMENT, `${flat.paid} coins on an average stake of ${(flat.staked / flat.pulls).toFixed(2)}`)
expect('and the night is over', flat.ended, 'the table closes')

const yanked = await night(2, 3)
const average = yanked.staked / yanked.pulls
expect('a night played at two coins settles at two coins', yanked.paid === Math.round(SETTLEMENT * average), `${yanked.paid} coins, ${SETTLEMENT} x ${average.toFixed(2)}`)
/*
 * The design claim, and the reason the settlement is averaged over the night
 * rather than read off the stake at the call. The stake was raised to three
 * on the pull that never happened; if the house paid what was showing it
 * would owe 135 instead of 90, and the whole bet would collapse into one
 * button press at the end.
 */
expect('and raising the stake at the last second buys nothing', yanked.stake === 3 && yanked.paid < SETTLEMENT * 3,
  `showing 3 coins, paid ${yanked.paid} and not ${SETTLEMENT * 3}`)

/* ---- 4. the way out ------------------------------------------------------ */

/*
 * Calling a machine that is straight. There is no count to build here, so
 * this is the other end of the same control: it must be pressable, it must
 * cost, and it must not pay.
 */
await sit(0, 51)
const honest = await hud()
expect('the honest machine opens the same purse', honest.bank === START_BANK, `${honest.bank} coins`)
await page.locator('button.callout').click()
await page.waitForTimeout(2500)
const wrong = await hud()
expect('calling a straight machine costs and pays nothing', wrong.bank < honest.bank, `purse ${honest.bank} to ${wrong.bank}`)

await browser.close()

if (problems.length) {
  console.error(`\nFAILED\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`\nOK: ${checks} checks, played with a pointer - the lever, the bet and the settlement all work`)
