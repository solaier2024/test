import { describe, expect, it } from 'vitest'
import { exactReturn, uncappedIsExact, worstCase } from './exact.ts'
import { MAX_KICKS, MAX_WIN_MULTIPLIER, RTP, TELL_RATE, ZONES } from './table.ts'

/*
 * The strict half of the RTP argument.
 *
 * rtp.test.ts measures, and for strategies that bank early its bands are tight
 * enough to mean something. For a strategy that never banks they are not, and no
 * sample size fixes that: when the entire return arrives in a quarter of a percent
 * of rounds, the per-round variance is enormous and the standard error stays in
 * whole percentage points.
 *
 * Those are exactly the cases that matter - the long ladders are where the cap
 * bites and where a pricing mistake would hide - so they are settled by
 * enumeration to twelve decimal places instead. This file is the one to believe.
 */

describe('the return, worked out exactly', () => {
  it('is the configured RTP for every fixed-zone ladder, uncapped', () => {
    /* Sixty ladders - six zones, one to ten kicks - each summed over 3^k
     * information branches. All of them exactly 0.97. */
    expect(uncappedIsExact()).toBe(true)

    for (const zone of ZONES) {
      for (let bank = 1; bank <= MAX_KICKS; bank++) {
        expect(exactReturn(zone, bank, Infinity).uncapped).toBeCloseTo(RTP, 12)
      }
    }
  })

  it('is unchanged by how long the ladder is, which is the whole design claim', () => {
    /* Not approximately. The player who banks the first goal and the player who
     * goes for all ten have the same expected return to twelve decimal places, so
     * there is no optimal stopping point and nobody is being quietly punished for
     * playing the way the game invites them to. */
    for (const zone of ZONES) {
      const one = exactReturn(zone, 1, Infinity).uncapped
      const ten = exactReturn(zone, MAX_KICKS, Infinity).uncapped
      expect(ten).toBeCloseTo(one, 12)
    }
  })

  it('is unchanged by the tell', () => {
    /*
     * The tell hands the player real information and the repricing is supposed to
     * sell it at exactly its worth. If that were even slightly off, the error would
     * compound down a ten-kick ladder and show up here - so this is the assertion
     * that the skill surface is honest rather than a leak or a trap.
     *
     * Checked by construction: TELL_RATE appears in the branch weights, and the
     * total comes out at RTP regardless of what it is set to.
     */
    expect(TELL_RATE).toBeGreaterThan(0)
    for (const zone of ZONES) {
      expect(exactReturn(zone, MAX_KICKS, Infinity).uncapped).toBeCloseTo(RTP, 12)
    }
  })
})

describe('the cap, priced', () => {
  it('costs under a hundredth of a percentage point', () => {
    const worst = worstCase()
    expect(worst.exact.costOfCap).toBeLessThan(0.0001)
    expect(worst.exact.rtp).toBeGreaterThan(RTP - 0.0001)
    /* And it is a real cap, not a decoration - the peak it clips is far above it. */
    expect(worst.exact.peak).toBeGreaterThan(MAX_WIN_MULTIPLIER)
    expect(worst.exact.clipped).toBeGreaterThan(0)
  })

  it('costs more the lower it is set, which is why 500x was wrong', () => {
    /*
     * The numbers quoted in table.ts and in PENALES.md, pinned. 500x was the
     * original setting and it cost a third of a percentage point - small enough to
     * hide in a simulation, large enough to be a misstatement of the RTP.
     */
    expect(worstCase(500).exact.costOfCap).toBeGreaterThan(0.003)
    expect(worstCase(1_000).exact.costOfCap).toBeGreaterThan(0.001)
    expect(worstCase(5_000).exact.costOfCap).toBeLessThan(0.0001)
    expect(worstCase(50_000).exact.costOfCap).toBeLessThan(0.00001)
  })

  it('bites hardest where the multipliers are biggest', () => {
    /* Down the middle, because shooting into the keeper's hands is the longest
     * shot in the game and therefore the one that stacks into the biggest number.
     * Not the top corner, which is where intuition puts it. */
    expect(worstCase().zone).toBe('bc')
    expect(worstCase().bank).toBe(MAX_KICKS)
  })
})
