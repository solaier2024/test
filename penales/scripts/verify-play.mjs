/*
 * Plays the game in a real browser and follows a coin from the balance, through a
 * stake, through a payout, and back into the balance.
 *
 * Everything in `npm test` can pass on a table nobody can actually play. This is
 * the check that the wiring exists: that pressing a zone takes a kick, that the
 * multiplier the board promised is the amount that arrives, that the provably fair
 * panel recomputes the round the player just played, and that a seed reveal
 * verifies against the hash published before any of it happened.
 *
 * Wants a dev server:  npm run dev -- --port 5190 --strictPort --host 127.0.0.1
 *
 * --host 127.0.0.1 is load-bearing and cost the sibling tables in this repository
 * several red runs: Vite binds "localhost", node resolves that to ::1 first and
 * binds only there, and a script asking for 127.0.0.1 gets a refused connection
 * against a server whose log says it is ready.
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const URL = process.env.URL ?? 'http://127.0.0.1:5190/'

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${what}`)
  if (!ok) problems.push(what)
}

const money = (text) => Number(text.replace(/[^0-9.]/g, ''))

const browser = await chromium.launch()
/* A phone, because that is what this is for and because the layout has to survive
 * the width where the zone labels are hidden. */
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const failures = []
page.on('pageerror', (e) => failures.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') failures.push(m.text())
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('.pitch', { timeout: 15_000 })

console.log('\nthe table loads')
check((await page.locator('.zone').count()) === 6, 'six zones on the goal')
check(await page.locator('.keeper').isVisible(), 'the keeper is in the goal')
check(await page.locator('.ball').isVisible(), 'the ball is on the spot')

const opening = money(await page.locator('.purse strong').innerText())
check(opening > 0, `there is a balance to play with (${opening})`)

/*
 * The seed's commitment, read BEFORE anything is played. This is the whole
 * provably fair ritual and the order is the point: a hash collected after the fact
 * proves nothing.
 */
await page.locator('.disclose').click()
const commitment = await page.locator('.verifybody .mono').first().innerText()
check(/^[0-9a-f]{10}\.\.\.[0-9a-f]{10}$/.test(commitment), `a commitment is published up front (${commitment})`)
await page.locator('.disclose').click()

console.log('\na coin goes out and comes back')
await page.locator('.stakes .chip').nth(2).click()
const stakeShown = money(await page.locator('.go').innerText())

await page.locator('.go').click()
await page.waitForSelector('.during', { timeout: 10_000 })

const afterStake = money(await page.locator('.purse strong').innerText())
check(
  Math.abs(opening - afterStake - stakeShown) < 0.005,
  `the stake left the balance exactly once (${opening} - ${stakeShown} = ${afterStake})`,
)

/* Zones are dead while nothing is owed - pressing one between rounds must not
 * take a kick, and must not cost anything. */
check(await page.locator('.zone').first().isEnabled(), 'the zones are live once a round is open')

/*
 * Shoot down the middle until something is banked. It is the safest zone, so this
 * terminates quickly, but the game can still take it away - so try a few rounds
 * rather than asserting that one goes in.
 */
let banked = null
for (let attempt = 0; attempt < 12 && banked === null; attempt++) {
  if ((await page.locator('.during').count()) === 0) {
    await page.locator('.go').click()
    await page.waitForSelector('.during', { timeout: 10_000 })
  }

  const promised = money(await page.locator('.zone').nth(4).locator('.mult').innerText())
  await page.locator('.zone').nth(4).click()
  /* The verdict is the only thing worth waiting on: it appears when the server has
   * answered and the flight has finished, which is the contract. */
  await page.waitForSelector('.verdict.goal, .verdict.saved, .verdict.missed', { timeout: 10_000 })

  /* Read the class, not the words. This used to match the verdict's text against
   * /GOL|GOAL/, and retheming the copy from "GOAL" to "IN" turned the whole check
   * into a timeout: every kick took the missed branch and waited for a round that was
   * still open. A browser check that breaks when the wording changes is a browser
   * check nobody will keep. */
  if ((await page.locator('.verdict.goal').count()) === 0) {
    await page.waitForSelector('.outcome', { timeout: 10_000 })
    continue
  }

  await page.waitForSelector('.cash:not([disabled])', { timeout: 10_000 })
  const onBoard = money(await page.locator('.bank strong').innerText())
  check(
    Math.abs(onBoard - promised) < 0.005,
    `the board pays what it promised before the kick (${promised}x promised, ${onBoard}x banked)`,
  )

  const owed = money(await page.locator('.cash').innerText())
  const before = money(await page.locator('.purse strong').innerText())
  await page.locator('.cash').click()
  await page.waitForSelector('.outcome.cashed', { timeout: 10_000 })

  const after = money(await page.locator('.purse strong').innerText())
  check(Math.abs(after - before - owed) < 0.005, `the payout arrived exactly once (${before} + ${owed} = ${after})`)
  banked = { owed, promised }
}

check(banked !== null, 'a goal was scored and banked inside twelve rounds')

/*
 * He cheats, and so can you. Both halves have to be reachable with a pointer, because
 * both of them are the reason this table belongs in the series and neither of them is
 * checkable from a unit test: the call button only exists on a save, and buying him only
 * exists while a round is open.
 */
console.log('\nhe cheats, and so can you')

check((await page.locator('.standing .heat .bar').count()) === 1, 'standing is on screen')
check((await page.locator('.standing .words strong').count()) === 1, 'so is how many words he will take')

let calledOne = false
let boughtOne = false

for (let attempt = 0; attempt < 40 && !(calledOne && boughtOne); attempt++) {
  if ((await page.locator('.during').count()) === 0) {
    if ((await page.locator('.go').count()) === 0 || !(await page.locator('.go').isEnabled())) break
    await page.locator('.go').click()
    await page.waitForSelector('.during', { timeout: 10_000 })
  }

  /* Arm the money on the first kick of a round while there are words left. */
  if (!boughtOne && (await page.locator('.buy').isEnabled())) {
    const before = Number((await page.locator('.standing .words strong').innerText()).trim())
    await page.locator('.buy').click()
    check(await page.locator('.tell.bought').isVisible(), 'arming the money says so on screen')
    await page.locator('.zone').nth(4).click()
    await page.waitForSelector('.verdict.goal, .verdict.saved, .verdict.missed', { timeout: 10_000 })
    const after = Number((await page.locator('.standing .words strong').innerText()).trim())
    check(after === before - 1, `buying him spends a word (${before} -> ${after})`)
    boughtOne = true
    await page.waitForTimeout(900)
    continue
  }

  await page.locator('.zone').nth(3).click()
  await page.waitForSelector('.verdict.goal, .verdict.saved, .verdict.missed', { timeout: 10_000 })
  await page.waitForTimeout(1_400)

  if (!calledOne && (await page.locator('.callhim').count()) === 1) {
    await page.locator('.callhim').click()
    await page.waitForSelector('.outcome.voided, .outcome.busted', { timeout: 10_000 })
    const right = (await page.locator('.outcome.voided').count()) === 1
    check(true, `calling him resolved one way or the other (${right ? 'he was off his line' : 'his feet were down'})`)
    calledOne = true
  }
}

check(boughtOne, 'the money can be put down with a pointer')
check(calledOne, 'a save can be called with a pointer')

console.log('\nthe player can check the house')
await page.locator('.disclose').click()
await page.locator('.seedform button.primary').click()
await page.waitForSelector('.revealed', { timeout: 10_000 })

check(await page.locator('.seal.ok').isVisible(), 'the revealed seed matches the hash published before the round')
check((await page.locator('.seal.bad').count()) === 0, 'nothing reports a mismatch')

const recomputed = await page.locator('.rkicks li').count()
check(recomputed >= 10, `every kick of the round is recomputed on the device (${recomputed} rows)`)
check((await page.locator('.rkicks li.r-untaken').count()) > 0, 'including the kicks that were never taken')

/*
 * The redaction, checked where it matters: in what the page actually received. The
 * in-page House used by the static preview has the seed in memory by construction
 * - that is what src/client/api.ts says about it - so what is asserted here is the
 * thing that survives the move to a real server: a LIVE seed is never rendered.
 */
const liveSeeds = await page.locator('.verifybody > .seedfields .mono').allInnerTexts()
check(
  liveSeeds.every((s) => !/^[0-9a-f]{64}$/.test(s)),
  'no full 64-character seed is shown for the live commitment',
)

console.log('')
check(failures.length === 0, `the console stayed quiet (${failures.length} problems)`)
for (const f of failures.slice(0, 5)) console.log(`        ${f}`)

/* Into .shots/, which is ignored. docs/ is owned by scripts/shots.mjs, and a check
 * that rewrites a committed picture every time it runs turns every unrelated run
 * into a diff. */
await mkdir('.shots', { recursive: true })
await page.screenshot({ path: '.shots/play.png' })
await browser.close()

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s).\n`)
  process.exit(1)
}
console.log('\nplayed it, and the money added up.\n')
