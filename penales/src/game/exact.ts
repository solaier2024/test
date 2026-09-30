/*
 * The RTP, worked out exactly rather than measured.
 *
 * WHY THIS EXISTS
 *
 * `npm run rtp` simulates, and simulation was enough to find a problem but not
 * enough to size it. A ladder game's per-round variance is enormous - the
 * standard error on a strategy that never banks is several percentage points
 * even over hundreds of thousands of rounds - so "97.0% plus or minus noise"
 * cannot distinguish a correct paytable from one whose top end is quietly clipped.
 * The only way to know is to stop measuring and start counting.
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
  STEAL_RATE,
  STEAL_REACH,
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

/* ------------------------------------------------- what he steals, exactly */

/**
 * The three return figures, and the only honest way to quote this table.
 *
 * The clean game is 97.00% and no corner or stopping rule beats another - that is
 * exactly true and it is what `exactReturn` above measures. Then he starts coming off
 * his line, and the board keeps quoting the clean odds, and the difference is his.
 *
 * So the return is no longer one number. It is a range whose position depends on
 * whether the player catches him, which is a deliberate break with the rest of the
 * paytable and is the same break EL BANDIDO MANCO makes: three machines, one pay card,
 * returns of 88.7%, 78.3% and 67.9%, and the player's whole job is working out which
 * one they are sitting at.
 *
 * Quoting the top of that range and staying quiet about the rest would be the dishonest
 * move, so all three numbers get computed here and printed by `npm run rtp`.
 */
export interface Honest {
  /** He keeps his feet on the line. The board's number. */
  clean: number
  /** He steals a step and the player never says anything. */
  robbed: number
}

/**
 * @param bank how many goals the player banks before walking.
 *
 * Two figures and no third, because the remedy for catching him is that he stops rather
 * than that he pays: a player who calls him promptly is playing the clean game, and the
 * clean game is the first figure. There is nothing in between to compute.
 */
export function honestReturn(zone: Zone, bank: number): Honest {
  const m = TABLE[zone]
  const rB = Math.min(1, m.reach + STEAL_REACH)

  /* Per-kick probabilities, split by whether he stole the step. */
  const gClean = m.onTarget * (1 - m.dive * m.reach)
  const gStolen = m.onTarget * (1 - m.dive * rB)
  /* Saved BECAUSE he stole - the only saves a call can touch. */
  const sStolen = m.onTarget * m.dive * rB

  const gActual = (1 - STEAL_RATE) * gClean + STEAL_RATE * gStolen

  /* The board prices every kick against gClean, so the multiplier after k goals is
   * RTP / gClean^k whatever he has been doing. */
  const payAt = (k: number) => Math.min(RTP / gClean ** k, MAX_WIN_MULTIPLIER)

  /* Unused here, but it is the quantity a refund-shaped remedy would have had to be
   * priced against, and leaving it named is cheaper than rederiving it if anybody tries
   * that again. */
  void sStolen

  return {
    clean: exactReturn(zone, bank, MAX_WIN_MULTIPLIER).rtp,
    robbed: gActual ** bank * payAt(bank),
  }
}

/** The worst a fixed-zone ladder does while he is at it, and the clean figure. */
export function honestRange(): { robbed: number; clean: number } {
  let robbed = Infinity
  let clean = 0

  for (const zone of Object.keys(TABLE) as Zone[]) {
    for (let bank = 1; bank <= 10; bank++) {
      const h = honestReturn(zone, bank)
      robbed = Math.min(robbed, h.robbed)
      clean = Math.max(clean, h.clean)
    }
  }

  return { robbed, clean }
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
 * The number to check before changing MAX_WIN_MULTIPLIER, MAX_KICKS, TELL_RATE or
 * any row of TABLE - all four move it.
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
