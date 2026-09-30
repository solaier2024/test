import { describe, expect, it } from 'vitest'
import { House } from '../server/service.ts'
import { measure, mulberry32, STRATEGIES, type Situation } from './strategies.ts'
import { MAX_KICKS, RTP, type Zone } from './table.ts'

/*
 * The measured half of the RTP argument. exact.test.ts is the strict half, and it
 * is the one to believe.
 *
 * What a simulation is good for here is catching a disagreement between the
 * arithmetic and the code that runs - a threshold compared the wrong way round, a
 * cursor off by one, a probability recorded that is not the one that was priced.
 * What it is NOT good for is settling the third decimal place of RTP: a strategy
 * that banks a quarter of a percent of the time has a per-round variance that no
 * practical sample size averages away, so its error bars stay several points
 * wide. Those cases are enumerated exactly in exact.ts instead, which is why the
 * bands below are allowed to be loose without anything resting on them.
 *
 * Two scales:
 *
 *   - Every strategy over 25,000 rounds against the real derivation and paytable.
 *     `npm run rtp` runs the same code bigger and prints the table PENALES.md
 *     quotes, alongside the exact figures.
 *   - One strategy through the actual House - store, ledger, idempotency keys and
 *     redaction all in the way - to show the plumbing does not bend the number.
 *     Small, because a copy-on-write store is not what is being measured.
 */

const STAKE = 1_000
const ROUNDS = 25_000

/*
 * Measured once and shared, because each strategy is tens of thousands of rounds
 * of real HMAC and three tests want to ask different questions of the same run.
 * Fixed seeds, so a number quoted anywhere can be reproduced exactly.
 */
const MEASURED = STRATEGIES.map((s) => measure(s, ROUNDS, STAKE, 0x51d0 + s.id.length))
const of = (id: string) => MEASURED.find((m) => m.strategy.id === id)!

describe('no way of playing beats the house edge, and none is punished by it', () => {
  for (const m of MEASURED) {
    it(`returns ${(RTP * 100).toFixed(0)}% to "${m.strategy.id}"`, () => {
      /*
       * Tolerance from the measurement, not from taste: 4 standard errors of the
       * per-round return, floored at half a point so a very low-variance strategy
       * does not get an absurdly tight bound.
       *
       * For the strategies that bank early this is a real check - a few tenths of a
       * point. For `escuadra-all` it is several points wide and catches only a gross
       * error, which is honest about what 25,000 rounds of a ladder game can tell
       * you and is why exact.test.ts exists.
       */
      const tolerance = Math.max(4 * m.stderr, 0.005)
      expect(m.rtp).toBeLessThanOrEqual(RTP + tolerance)
      expect(m.rtp).toBeGreaterThan(RTP - tolerance)
    })
  }

  it('leaves no strategy meaningfully ahead of any other', () => {
    /* The property stated directly: the spread across strategies has to be noise.
     * If a stopping rule ever pulls clear, the game has a right answer and every
     * player not playing it is losing more than the paytable admits. */
    const spread = Math.max(...MEASURED.map((m) => m.rtp)) - Math.min(...MEASURED.map((m) => m.rtp))
    const noise = 8 * Math.max(...MEASURED.map((m) => m.stderr))
    expect(spread).toBeLessThanOrEqual(Math.max(noise, 0.02))
  })

  it('gives the strategies genuinely different shapes, or the choice is cosmetic', () => {
    /* The other half, and the reason equal RTP is interesting rather than
     * suspicious: the experiences have to differ. If they did not, the six zones
     * would be a skin over one bet, which is the thing this whole design exists to
     * avoid. Same expected return, wildly different rides. */
    const safe = of('safe-1')
    const brave = of('escuadra-all')

    expect(brave.bestMultiplier).toBeGreaterThan(safe.bestMultiplier * 20)
    expect(brave.cashed / brave.rounds).toBeLessThan(safe.cashed / safe.rounds / 10)
    expect(safe.stderr).toBeLessThan(brave.stderr)
    expect(brave.meanGoals).toBeLessThan(safe.meanGoals * 2)
  })
})

describe('the House pays what the paytable says', () => {
  it('returns the same fraction through the real transactions', () => {
    /*
     * The same measurement with the store, the ledger, the idempotency keys and
     * the redaction all in the way. Smaller, because that machinery is O(state)
     * per transaction by design and this test is not what measures it.
     *
     * Every chip here moves through takeStake and payOut, so the assertion is really
     * about the ledger: what the paytable promises and what the books say are the
     * same number.
     */
    const rounds = 1_500
    const house = new House((n) => new Uint8Array(n).fill(0x5a))
    house.fund('ana', rounds * STAKE * 2 + 1_000_000, 'fund')

    const rnd = mulberry32(0xbeef)
    const reader = STRATEGIES.find((s) => s.id === 'reader')!

    let staked = 0
    let returned = 0

    for (let n = 0; n < rounds; n++) {
      const opened = house.open('ana', STAKE, `open:${n}`)
      const id = opened.round!.id
      staked += STAKE

      for (let k = 0; k < MAX_KICKS; k++) {
        const round = house.view('ana').round!
        if (round.status !== 'open') break

        const situation: Situation = {
          scored: round.kicks.filter((x) => x.result === 'goal').length,
          shown: round.shown,
          board: round.board,
          multiplier: round.multiplier,
        }
        const decision = reader.decide(situation, rnd)
        if (decision.action === 'cash') {
          house.cashOut('ana', id, `cash:${n}`)
          break
        }
        house.kick('ana', id, decision.zone as Zone, `kick:${n}:${k}`)
      }

      const done = house.view('ana').round!
      if (done.status === 'open') house.cashOut('ana', id, `cash:${n}`)
      returned += house.view('ana').round!.payout
    }

    const rtp = returned / staked
    /* Wider band than the big run above, because four thousand rounds of a ladder
     * game is not many. Tight enough to catch a plumbing bug, which is all it is
     * here for. */
    expect(rtp).toBeGreaterThan(RTP - 0.08)
    expect(rtp).toBeLessThan(RTP + 0.08)

    /* And the books agree with the arithmetic, to the centavo. */
    const total = [...house.store.read().accounts.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(0)
  })
})
