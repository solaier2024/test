/*
 * Measures the return to every way of playing, and prints the table PENALES.md
 * quotes.
 *
 * It imports the engine rather than keeping a second copy of the paytable, which
 * is the whole reason it can be trusted as the source of the published numbers:
 * there is no version of this script that agrees with a paytable the game is not
 * running. Node 22.14 has to be told to strip the types; 22.18 and up does it
 * unasked. See the `rtp` script in package.json.
 *
 * It also fails, rather than only reporting. A drifting RTP is not something to
 * notice in a log.
 */

import { honestRange, honestReturn, uncappedIsExact, worstCase } from '../src/game/exact.ts'
import { measure, STRATEGIES } from '../src/game/strategies.ts'
import {
  HOUSE_EDGE,
  MAX_KICKS,
  MAX_WIN_MULTIPLIER,
  pGoalBlind,
  RTP,
  STEAL_RATE,
  STRAIGHT_ROUNDS,
  TABLE,
  TELL_RATE,
  ZONES,
} from '../src/game/table.ts'

/*
 * 120,000 is a compromise, and worth naming as one: it resolves the strategies
 * that bank early to about two tenths of a point, runs in a couple of minutes, and
 * therefore can sit in the pre-push chain. ROUNDS=400000 tightens the resolvable
 * ones to a tenth and does nothing for the rest, because those are limited by
 * variance rather than by sample size - exact.ts is what covers them.
 */
const ROUNDS = Number(process.env.ROUNDS ?? 120_000)
const STAKE = 1_000
const SEED = Number(process.env.SEED ?? 0x1884)

const pct = (x) => `${(x * 100).toFixed(2)}%`
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

const NAMES = {
  tl: 'escuadra izq',
  tc: 'alta centro',
  tr: 'escuadra der',
  bl: 'baja izq',
  bc: 'baja centro',
  br: 'baja der',
}

console.log(`\nLA TANDA - ${ROUNDS.toLocaleString('en-US')} rounds per strategy, stake ${STAKE} chips, seed ${SEED}`)
console.log(`configured: RTP ${pct(RTP)} (edge ${pct(HOUSE_EDGE)}), ${MAX_KICKS} kicks, tell ${pct(TELL_RATE)}\n`)

console.log(`${pad('zone', 15)}${padL('on target', 11)}${padL('he dives', 10)}${padL('he reaches', 12)}${padL('P(goal)', 10)}${padL('1 kick', 9)}`)
console.log('-'.repeat(67))
for (const z of ZONES) {
  const m = TABLE[z]
  const p = pGoalBlind(z)
  console.log(
    pad(NAMES[z], 15) +
      padL(pct(m.onTarget), 11) +
      padL(pct(m.dive), 10) +
      padL(pct(m.reach), 12) +
      padL(pct(p), 10) +
      padL(`${(RTP / p).toFixed(3)}x`, 9),
  )
}

/*
 * The exact figures first, because they are the ones worth quoting. The
 * simulation below is a check that the code does what the arithmetic says, not
 * the source of the published RTP - a ladder game's variance is far too large for
 * a measurement to settle the third decimal place.
 */
console.log(`\nexact, by enumerating every information branch (${MAX_KICKS} kicks, 3^${MAX_KICKS} paths):`)
console.log(`  uncapped return, every fixed-zone ladder     ${uncappedIsExact() ? `exactly ${pct(RTP)}` : 'NOT EXACT'}`)
{
  const w = worstCase()
  console.log(`  worst affected by the ${MAX_WIN_MULTIPLIER.toLocaleString('en-US')}x cap        ${NAMES[w.zone]} x${w.bank}`)
  console.log(`  what the cap costs it                        ${(w.exact.costOfCap * 100).toFixed(4)} pp  ->  ${pct(w.exact.rtp)}`)
  console.log(`  how often the cap is reached                 ${w.exact.clipped.toExponential(2)}`)
  console.log(`  most a round can pay                         ${MAX_WIN_MULTIPLIER.toLocaleString('en-US')}x`)
}

console.log('\n  what other caps would cost:')
for (const cap of [500, 1_000, 5_000, 50_000]) {
  const w = worstCase(cap)
  const here = cap === MAX_WIN_MULTIPLIER ? '  <- configured' : ''
  console.log(`    ${padL(cap.toLocaleString('en-US') + 'x', 9)}   ${(w.exact.costOfCap * 100).toFixed(4).padStart(7)} pp${here}`)
}

/*
 * The part that must not be buried. The clean game is 97.00% and no corner or stopping
 * rule beats another - but he does not always keep his feet on the line, and while he is
 * at it the board is still quoting the clean number. Quoting only the top of that range
 * would be the dishonest move, so both ends get printed.
 */
{
  const h = honestRange()
  console.log(`\nwhat he is worth, and what he takes (steals a step ${pct(STEAL_RATE)} of the time):`)
  console.log(`  he keeps his feet on the line                ${pct(h.clean)}   <- what the board quotes`)
  console.log(`  he steals a step and nobody calls it         ${pct(h.robbed)}   <- worst ladder`)
  console.log(`  called out, so he behaves for ${STRAIGHT_ROUNDS} rounds        ${pct(h.clean)}   <- back to clean, and it cannot exceed it`)
  console.log('\n  what he takes, by how long the ladder is:')
  console.log(`    ${padL('corner', 14)}${padL('bank 1', 10)}${padL('bank 5', 10)}${padL('bank 10', 10)}`)
  for (const z of ZONES) {
    const v = [1, 5, 10].map((b) => pct(honestReturn(z, b).robbed))
    console.log(`    ${padL(NAMES[z], 14)}${padL(v[0], 10)}${padL(v[1], 10)}${padL(v[2], 10)}`)
  }
  console.log('\n  he takes a share of a multiplier, so the longer the ladder the bigger his cut.')
}

console.log(`\nsimulated, with him keeping his feet on the line - the game the board quotes:`)
console.log(`${pad('strategy', 15)}${padL('RTP', 9)}${padL('+/-', 8)}${padL('paid', 8)}${padL('goals', 8)}${padL('best', 10)}  what it does`)
console.log('-'.repeat(118))

let worst = 0
const results = []

for (const strategy of STRATEGIES) {
  const m = measure(strategy, ROUNDS, STAKE, SEED)
  results.push(m)
  worst = Math.max(worst, Math.abs(m.rtp - RTP))
  console.log(
    pad(m.strategy.id, 15) +
      padL(pct(m.rtp), 9) +
      padL(pct(m.stderr), 8) +
      padL(pct(m.cashed / m.rounds), 8) +
      padL(m.meanGoals.toFixed(2), 8) +
      padL(`${m.bestMultiplier.toFixed(2)}x`, 10) +
      `  ${m.strategy.describe}`,
  )
}

const spread = Math.max(...results.map((m) => m.rtp)) - Math.min(...results.map((m) => m.rtp))
const noise = 4 * Math.max(...results.map((m) => m.stderr))

console.log(`\nspread across strategies  ${pct(spread)}   (4 standard errors: ${pct(noise)})`)
console.log(`furthest from configured  ${pct(worst)}`)

/*
 * Said out loud, because a report that prints "97.00%" next to an 8-point
 * standard error and calls it agreement is the kind of thing that gets quoted for
 * years. The simulation can resolve the strategies that bank early. It cannot
 * resolve the ones that do not, at any sample size worth waiting for - a strategy
 * whose entire return arrives in 0.26% of rounds has a per-round variance no
 * amount of rounds will average away quickly.
 *
 * Those are exactly the strategies exact.ts enumerates, so nothing is left
 * resting on the loose numbers.
 */
const resolvable = results.filter((m) => 4 * m.stderr < 0.02)
console.log(
  `\nof ${results.length} strategies, ${resolvable.length} are resolvable at this sample size ` +
    `(4 standard errors under 2 points).`,
)
console.log('the rest bank too rarely to measure, and are covered exactly by src/game/exact.ts instead.\n')

/*
 * The assertions. Tolerances come from the measurement rather than from taste:
 * a ladder game's per-round variance is large, so an honest band is wider than
 * people expect. Truncation to the centavo is the only systematic bias and it
 * only ever favours the house, which is why nothing is allowed to come out above
 * the configured figure by more than noise.
 */
let failed = false
const fail = (msg) => {
  console.error(`FAIL  ${msg}`)
  failed = true
}

for (const m of results) {
  const tolerance = Math.max(4 * m.stderr, 0.004)
  if (Math.abs(m.rtp - RTP) > tolerance) {
    fail(`"${m.strategy.id}" returned ${pct(m.rtp)}, outside ${pct(RTP)} +/- ${pct(tolerance)}`)
  }
}

if (spread > Math.max(noise, 0.01)) {
  fail(`the strategies are ${pct(spread)} apart, which is more than noise - some way of playing is better than the others`)
}

/* The exact check is the one that is allowed to be strict. */
if (!uncappedIsExact()) fail('the uncapped return is not exactly the configured RTP')
if (worstCase().exact.costOfCap > 0.0001) {
  fail(`the ${MAX_WIN_MULTIPLIER}x cap costs ${(worstCase().exact.costOfCap * 100).toFixed(4)} pp, which is too much`)
}

{
  const h = honestRange()
  /* The clean game has to stay exactly what it says, and the theft has to stay a gap
   * worth learning about without becoming a different game. */
  if (Math.abs(h.clean - RTP) > 1e-10) fail(`the clean return is ${pct(h.clean)}, not ${pct(RTP)}`)
  if (h.robbed > RTP - 0.02) fail(`he only takes ${pct(RTP - h.robbed)}, which is not worth noticing`)
  if (h.robbed < RTP - 0.08) fail(`he takes ${pct(RTP - h.robbed)}, which is a different game rather than a tell`)
}

if (failed) process.exit(1)
console.log('clean game exactly 97.00%. He takes up to five points of it, and you can stop him.\n')
