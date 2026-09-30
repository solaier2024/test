/*
 * The RTP, worked out exactly rather than measured.
 *
 * WHY THIS EXISTS
 *
 * `npm run rtp` simulates, and simulation was enough to find a problem but not
 * enough to size it. A ladder game's per-round variance is enormous - the
 * standard error on a strategy that never banks is several percentage points
 * even over hundreds of thousands of rounds - so "97.0% plus or minus noise"
 * cannot distinguish a correct paytable from one whose top end is quietly
 * clipped. A certification lab asks for an analytic RTP for exactly this reason.
 *
 * WHAT THE SIMULATION FOUND
 *
 * MAX_WIN_MULTIPLIER is reachable, and the first version of this project claimed
 * it was not. The claim was checked against the blind probabilities, where the
 * hardest zone is 0.56 and ten of them come to 322x - comfortably under the cap.
 * But the tell changes the arithmetic: a player who shoots where the keeper has
 * just shown he is going faces a probability as low as 0.094, and is paid for
 * it. String a few of those together and the multiplier leaves 322x far behind.
 *
 * A cap that binds is a cap that silently cuts RTP on the one path a player
 * worked hardest for, so the question is not whether to have one - liability has
 * to be bounded - but how much return it costs. That is what this file answers,
 * to the last decimal place, by enumeration.
 *
 * HOW
 *
 * For a fixed-zone strategy there are only three information branches per kick,
 * because pGoalKnowing(z, d) is the same for every d that is not z:
 *
 *   he tells, and he is going where you are shooting   TELL_RATE * dive[z]
 *   he tells, and he is going somewhere else           TELL_RATE * (1 - dive[z])
 *   he says nothing                                    1 - TELL_RATE
 *
 * Ten kicks is 3^10 = 59,049 paths, which is nothing. Walk them all, weight each
 * by its probability, and the answer is exact.
 */

import {
  MAX_WIN_MULTIPLIER,
  multiplierAfter,
  onTargetOf,
  pGoalBlind,
  pGoalKnowing,
  RTP,
  TABLE,
  TELL_RATE,
  type Zone,
} from './table.ts'

/** One information branch of one kick. */
interface Branch {
  /** How often this branch happens, before the kick is resolved. */
  weight: number
  /** P(goal) once it has. */
  p: number
}

const branchesFor = (z: Zone): Branch[] => [
  { weight: TELL_RATE * TABLE[z].dive, p: pGoalKnowing(z, z) },
  { weight: TELL_RATE * (1 - TABLE[z].dive), p: onTargetOf(z) },
  { weight: 1 - TELL_RATE, p: pGoalBlind(z) },
]

export interface Exact {
  /** Expected return per unit staked. */
  rtp: number
  /** What it would be with no cap. Equal to RTP, to floating-point precision. */
  uncapped: number
  /** Percentage points of return the cap costs. */
  costOfCap: number
  /** The largest multiplier any path reaches, before clamping. */
  peak: number
  /** Total probability of a path that the cap clips. */
  clipped: number
}

/**
 * Expected return for "shoot this zone every time and bank after `bank` goals".
 *
 * @param cap the multiplier ceiling to evaluate. Defaults to the configured one;
 *        pass Infinity to get the uncapped figure.
 */
export function exactReturn(zone: Zone, bank: number, cap = MAX_WIN_MULTIPLIER): Exact {
  const branches = branchesFor(zone)

  let capped = 0
  let uncapped = 0
  let peak = 0
  let clipped = 0

  /* Depth-first over the branch tree. `ps` is the probabilities the ladder has
   * been priced against so far, which is all the multiplier depends on. */
  const walk = (kick: number, weight: number, ps: number[]): void => {
    if (kick === bank) {
      const m = multiplierAfter(ps)
      peak = Math.max(peak, m)
      uncapped += weight * m
      capped += weight * Math.min(m, cap)
      if (m > cap) clipped += weight
      return
    }

    for (const branch of branches) {
      /* Reaching the next kick means this branch happened AND the kick went in.
       * Missing it pays nothing, so it needs no term. */
      walk(kick + 1, weight * branch.weight * branch.p, [...ps, branch.p])
    }
  }

  walk(0, 1, [])

  return { rtp: capped, uncapped, costOfCap: uncapped - capped, peak, clipped }
}

/** Every fixed-zone ladder there is, which is where the cap bites hardest. */
export function worstCase(cap = MAX_WIN_MULTIPLIER): { zone: Zone; bank: number; exact: Exact } {
  let worst: { zone: Zone; bank: number; exact: Exact } | null = null

  for (const zone of Object.keys(TABLE) as Zone[]) {
    for (let bank = 1; bank <= 10; bank++) {
      const exact = exactReturn(zone, bank, cap)
      if (worst === null || exact.costOfCap > worst.exact.costOfCap) worst = { zone, bank, exact }
    }
  }

  return worst!
}

/**
 * How much return the cap costs the worst-affected way of playing.
 *
 * This is the number to put in front of a lab, and the number to check before
 * changing MAX_WIN_MULTIPLIER, MAX_KICKS, TELL_RATE or any row of TABLE - all
 * four move it.
 */
export const costOfCap = (cap = MAX_WIN_MULTIPLIER): number => worstCase(cap).exact.costOfCap

/** Sanity: with no cap, every ladder returns exactly the configured RTP. */
export const uncappedIsExact = (): boolean => {
  for (const zone of Object.keys(TABLE) as Zone[]) {
    for (let bank = 1; bank <= 10; bank++) {
      if (Math.abs(exactReturn(zone, bank, Infinity).uncapped - RTP) > 1e-12) return false
    }
  }
  return true
}
