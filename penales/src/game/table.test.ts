import { describe, expect, it } from 'vitest'
import { floatsOf } from './fair.ts'
import {
  cursorFor,
  diveFor,
  displayMultiplier,
  FLOATS_PER_KICK,
  HOUSE_EDGE,
  MAX_KICKS,
  MAX_ON_TARGET,
  MAX_WIN_MULTIPLIER,
  multiplierAfter,
  payoutFor,
  pGoalBlind,
  pGoalKnowing,
  resolveKick,
  RTP,
  rollsFor,
  TABLE,
  type Dive,
  type Zone,
  ZONES,
} from './table.ts'

/** P(goal | shooting at z) worked out by enumerating his six options by hand. */
function byEnumeration(z: Zone): number {
  let p = 0
  for (const d of ZONES) {
    const onTarget = TABLE[z].onTarget
    const beaten = d === z ? 1 - TABLE[z].reach : 1
    p += TABLE[d].dive * onTarget * beaten
  }
  return p
}

describe('the paytable is well formed', () => {
  it('sends him somewhere, exactly once', () => {
    const total = ZONES.reduce((a, z) => a + TABLE[z].dive, 0)
    /* If this column stops summing to 1 the keeper acquires a seventh move -
     * "nowhere" - and every multiplier in the game is quietly wrong. */
    expect(total).toBeCloseTo(1, 12)
  })

  it('keeps every probability a probability', () => {
    for (const z of ZONES) {
      const m = TABLE[z]
      expect(m.onTarget).toBeGreaterThan(0)
      expect(m.onTarget).toBeLessThanOrEqual(1)
      expect(m.dive).toBeGreaterThan(0)
      expect(m.reach).toBeGreaterThan(0)
      expect(m.reach).toBeLessThanOrEqual(1)
      /* A zone that cannot be scored in would have an infinite multiplier. */
      expect(pGoalBlind(z)).toBeGreaterThan(0)
      expect(pGoalBlind(z)).toBeLessThan(1)
    }
  })

  it('reads as football: the textbook penalty converts like a real one', () => {
    /* Real top-flight conversion is 0.75-0.80, and the shot that statistic is
     * mostly made of is low and hard to a corner. That is the row to hold to the
     * real number - if it drifts, the table has stopped being a penalty and
     * become an arbitrary ladder, which is exactly what the art direction cannot
     * sell.
     *
     * The unweighted mean across all six is lower (about 0.69) and that is not a
     * discrepancy: it averages in two top corners that no real taker picks five
     * times in a row. Checked separately, and loosely, because it is a shape
     * check and not a football claim. */
    for (const z of ['bl', 'br'] as const) {
      expect(pGoalBlind(z)).toBeGreaterThan(0.7)
      expect(pGoalBlind(z)).toBeLessThan(0.82)
    }

    const blended = ZONES.reduce((a, z) => a + pGoalBlind(z), 0) / ZONES.length
    expect(blended).toBeGreaterThan(0.65)
    expect(blended).toBeLessThan(0.85)
  })

  it('agrees with the long-hand enumeration of his six options', () => {
    for (const z of ZONES) expect(pGoalBlind(z)).toBeCloseTo(byEnumeration(z), 12)
  })

  it('puts the escuadra at the top of the risk ladder and the keeper at the bottom', () => {
    /* The design claim in one assertion: the corner is the worst bet against
     * him and the middle is the safest, so the ladder has a real shape rather
     * than six numbers that happen to differ. */
    expect(pGoalBlind('tl')).toBeLessThan(pGoalBlind('bl'))
    expect(pGoalBlind('bl')).toBeLessThan(pGoalBlind('bc'))
    expect(pGoalBlind('tl')).toBeCloseTo(pGoalBlind('tr'), 12)
    expect(pGoalBlind('bl')).toBeCloseTo(pGoalBlind('br'), 12)
  })
})

describe('the house edge is the same everywhere', () => {
  it('returns exactly RTP on a single kick, in every zone', () => {
    for (const z of ZONES) {
      const p = pGoalBlind(z)
      expect(p * multiplierAfter([p])).toBeCloseTo(RTP, 12)
    }
  })

  it('returns exactly RTP however long the ladder is', () => {
    /* The property that means there is no optimal stopping point to discover,
     * and therefore no player who is being quietly punished for enjoying the
     * game the way it is presented. */
    for (const z of ZONES) {
      const p = pGoalBlind(z)
      for (let k = 1; k <= MAX_KICKS; k++) {
        const survived = Array.from({ length: k }, () => p)
        expect(p ** k * multiplierAfter(survived)).toBeCloseTo(RTP, 12)
      }
    }
  })

  it('returns exactly RTP on a mixed ladder', () => {
    const plan: Zone[] = ['bc', 'tl', 'br', 'tc', 'bl']
    const ps = plan.map(pGoalBlind)
    const reached = ps.reduce((a, p) => a * p, 1)
    expect(reached * multiplierAfter(ps)).toBeCloseTo(RTP, 12)
  })

  it('sells the tell at exactly what it is worth', () => {
    /* When he shows his hand the payout is repriced against what the player now
     * knows. If this ever drifts, the tell is either a giveaway or a trap. */
    for (const z of ZONES) {
      for (const d of ZONES) {
        const p = pGoalKnowing(z, d)
        expect(p * multiplierAfter([p])).toBeCloseTo(RTP, 12)
      }
    }
  })

  it('never offers a bet that pays less than it costs', () => {
    /*
     * The constraint that MAX_ON_TARGET exists for, and the one this test found
     * rather than confirmed. The house edge lands entirely on the first kick, so
     * the first kick is where a zone can be priced under 1.00x - and the worst
     * case is a tell that sends him somewhere else, which leaves the shooter
     * betting against nothing but their own accuracy.
     *
     * Checked over every zone in every information state there is: blind, and
     * with each of his six dives shown.
     */
    for (const z of ZONES) {
      expect(TABLE[z].onTarget).toBeLessThanOrEqual(MAX_ON_TARGET)
      expect(MAX_ON_TARGET).toBeLessThan(RTP)

      for (const shown of [null, ...ZONES] as (Dive | null)[]) {
        const first = multiplierAfter([shown === null ? pGoalBlind(z) : pGoalKnowing(z, shown)])
        expect(first).toBeGreaterThan(1)
      }
    }
  })

  it('makes the read worth most where he actually lives', () => {
    /* Knowing he has gone elsewhere is worth almost nothing on a top corner -
     * he was never there - and a great deal down the middle. A player who works
     * that out is playing better than one who does not, and still cannot beat
     * 97%. That is the most honest shape a skill surface can have. */
    const worth = (z: Zone) => pGoalKnowing(z, 'tl') / pGoalBlind(z)
    expect(worth('bc')).toBeGreaterThan(worth('tr'))
  })
})

describe('the liability cap', () => {
  it('cannot be reached, which is the only kind of cap worth having', () => {
    /* A reachable cap silently cuts RTP on the one path a player worked hardest
     * for. The best possible run is the hardest zone every time, so that is the
     * number to check - and this test is here so that a future edit to TABLE
     * cannot create an unbounded payout without turning something red. */
    const hardest = Math.min(...ZONES.map(pGoalBlind))
    const best = multiplierAfter(Array.from({ length: MAX_KICKS }, () => hardest))
    expect(best).toBeLessThan(MAX_WIN_MULTIPLIER)
  })

  it('still clamps, in case it ever becomes reachable', () => {
    expect(payoutFor(10_000, MAX_WIN_MULTIPLIER * 4)).toBe(10_000 * MAX_WIN_MULTIPLIER)
    expect(displayMultiplier(MAX_WIN_MULTIPLIER * 4)).toBe(MAX_WIN_MULTIPLIER)
  })
})

describe('money arithmetic', () => {
  it('never promises more than it pays', () => {
    /* The board shows two decimals and the payout truncates to the centavo, so
     * the displayed figure has to be the floor and not the round - otherwise a
     * player reads 2.35x, is paid 2.34x, and is right to complain. */
    for (const m of [1.0, 1.005, 1.129, 2.9999, 17.681]) {
      expect(displayMultiplier(m)).toBeLessThanOrEqual(m)
      expect(payoutFor(100_000, m)).toBeGreaterThanOrEqual(payoutFor(100_000, displayMultiplier(m)))
    }
  })

  it('pays whole centavos', () => {
    for (const z of ZONES) {
      const out = payoutFor(1337, multiplierAfter([pGoalBlind(z)]))
      expect(Number.isInteger(out)).toBe(true)
    }
  })
})

describe('the keeper', () => {
  it('maps floats onto zones in published order, with the right weights', () => {
    /* Walked in ZONES order so a player can re-derive the mapping from the
     * paytable alone. Boundaries checked exactly, because an off-by-one here is
     * invisible in play and obvious to anybody auditing a reveal. */
    expect(diveFor(0)).toBe('tl')
    expect(diveFor(TABLE.tl.dive - 1e-12)).toBe('tl')
    expect(diveFor(TABLE.tl.dive)).toBe('tc')
    expect(diveFor(0.999999)).toBe('br')
  })

  it('lands on each zone as often as the table says', () => {
    const counts = new Map<Dive, number>(ZONES.map((z) => [z, 0]))
    const n = 600_000
    for (let i = 0; i < n; i++) {
      const d = diveFor((i + 0.5) / n)
      counts.set(d, counts.get(d)! + 1)
    }
    for (const z of ZONES) expect(counts.get(z)! / n).toBeCloseTo(TABLE[z].dive, 4)
  })

  it('decides everything before the player chooses, and nothing after', () => {
    /* rollsFor takes the floats and the kick index. It does not take a zone,
     * and it cannot, which is the type system carrying the central rule of the
     * whole design: nothing adapts to the shot. */
    const floats = Array.from({ length: MAX_KICKS * FLOATS_PER_KICK }, (_, i) => ((i * 7919) % 1000) / 1000)
    const rolls = rollsFor(floatsOf(floats), 3)
    expect(rolls.dive).toBe(diveFor(floats[cursorFor(3, 1)]))
    expect(rolls.accuracy).toBe(floats[cursorFor(3, 3)])
  })
})

describe('resolving a kick', () => {
  const floats = (tell: number, dive: number, reach: number, accuracy: number) => {
    const out = new Array(MAX_KICKS * FLOATS_PER_KICK).fill(0)
    out[cursorFor(0, 0)] = tell
    out[cursorFor(0, 1)] = dive
    out[cursorFor(0, 2)] = reach
    out[cursorFor(0, 3)] = accuracy
    return out
  }

  it('misses the goal when the shooter misses the goal, keeper or no keeper', () => {
    /* Accuracy is checked first and the keeper is not consulted, which is the
     * right order: a ball over the bar is not a save, and a player who watched
     * it go over the bar must not be told it was saved. */
    const rolls = rollsFor(floatsOf(floats(0.9, 0.0, 0.0, 0.99)), 0)
    expect(resolveKick(rolls, 'tl')).toBe('missed')
  })

  it('is saved only where he went', () => {
    const rolls = rollsFor(floatsOf(floats(0.9, 0.0, 0.0, 0.0)), 0)
    expect(rolls.dive).toBe('tl')
    expect(resolveKick(rolls, 'tl')).toBe('saved')
    expect(resolveKick(rolls, 'tr')).toBe('goal')
  })

  it('is a goal where he went, if he could not get there', () => {
    const rolls = rollsFor(floatsOf(floats(0.9, 0.0, 0.999, 0.0)), 0)
    expect(rolls.dive).toBe('tl')
    expect(rolls.reaches).toBe(false)
    expect(resolveKick(rolls, 'tl')).toBe('goal')
  })

  it('scores as often as the paytable promises', () => {
    /*
     * The bridge between the arithmetic above and the code that actually runs:
     * sweep the roll space uniformly, resolve it with the real resolveKick, and
     * the answer has to come back as pGoalBlind. If these two ever disagree, the
     * published odds are a work of fiction.
     *
     * Swept in two exact pieces rather than as one product grid, and the reason
     * is worth writing down because the first version of this test failed for
     * this and not for a bug. Every threshold in TABLE is a multiple of 0.01, so
     * a 500-step midpoint sweep of any ONE dimension reproduces its probability
     * exactly - but the full three-dimensional grid would need 500^3 samples,
     * and a coarse grid does not land on the thresholds, so it reports the
     * keeper diving to a top corner 12.5% of the time when the table says 10%.
     *
     * The dimensions are independent, so: sweep dive x reach with the shot
     * forced on target to get P(he does not stop it), sweep accuracy with him
     * forced elsewhere to get P(on target), multiply. Exact, and it still runs
     * every branch of resolveKick.
     */
    const steps = 500
    const roll = new Array<number>(MAX_KICKS * FLOATS_PER_KICK).fill(0)
    const set = (tell: number, dive: number, reach: number, accuracy: number) => {
      roll[cursorFor(0, 0)] = tell
      roll[cursorFor(0, 1)] = dive
      roll[cursorFor(0, 2)] = reach
      roll[cursorFor(0, 3)] = accuracy
    }

    for (const z of ZONES) {
      let beaten = 0
      for (let d = 0; d < steps; d++) {
        for (let r = 0; r < steps; r++) {
          set(0.5, (d + 0.5) / steps, (r + 0.5) / steps, 0)
          if (resolveKick(rollsFor(floatsOf(roll), 0), z) === 'goal') beaten++
        }
      }

      /* Any dive float that does not land on z, so accuracy is the only thing
       * left that can stop the ball. */
      const elsewhere = diveFor(0) === z ? 0.5 : 0
      expect(diveFor(elsewhere)).not.toBe(z)

      let onTarget = 0
      for (let a = 0; a < steps; a++) {
        set(0.5, elsewhere, 0, (a + 0.5) / steps)
        if (resolveKick(rollsFor(floatsOf(roll), 0), z) === 'goal') onTarget++
      }

      const measured = (beaten / (steps * steps)) * (onTarget / steps)
      expect(measured).toBeCloseTo(pGoalBlind(z), 10)
    }
  })
})

describe('the configured numbers', () => {
  it('are the ones the documentation quotes', () => {
    /* PENALES.md prints these, a lab would be handed these, and a player would
     * be shown these. Pinning them means a tuning change has to walk past a
     * red test and update the paperwork. */
    expect(HOUSE_EDGE).toBe(0.03)
    expect(RTP).toBeCloseTo(0.97, 12)
    expect(MAX_KICKS).toBe(10)
  })
})
