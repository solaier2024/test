/*
 * Ways of playing, and a simulator to run them through.
 *
 * This exists for one assertion, and it is the assertion a certification lab
 * cares about more than any other:
 *
 *   No way of playing returns more than the configured RTP, and none returns
 *   less.
 *
 * Not "the maths says so" - measured, over enough rounds to see it, through the
 * same derivation and the same paytable the game runs on. A ladder game with a
 * cash-out button has a large strategy space, and "the house edge is 3%" is only
 * true if it is 3% for the player who always walks after one goal AND for the
 * player who never walks at all. If some stopping rule beat the others, the game
 * would have a right answer, and every player not playing it would be losing
 * more than the paytable says - which is exactly the kind of thing that gets
 * found by a regulator rather than by us.
 *
 * Shared by rtp.test.ts and scripts/rtp.mjs so the published table and the test
 * that guards it cannot drift.
 */

import { floatsFor } from './fair.ts'
import {
  displayMultiplier,
  MAX_KICKS,
  multiplierAfter,
  multiplierIfScored,
  payoutFor,
  pGoal,
  resolveKick,
  rollsFor,
  type Centavos,
  type Dive,
  type Zone,
  ZONES,
} from './table.ts'

export interface BoardRow {
  zone: Zone
  p: number
  multiplier: number
}

/** Everything a player can see when deciding. Nothing they cannot. */
export interface Situation {
  /** Kicks already scored. Equal to the length of the ladder so far. */
  scored: number
  /** His dive, when he has tipped his hand. */
  shown: Dive | null
  board: readonly BoardRow[]
  /** What walking away is worth now. Zero before the first goal. */
  multiplier: number
}

export type Decision = { action: 'kick'; zone: Zone } | { action: 'cash' }

export interface Strategy {
  id: string
  /** Printed in the report, so it has to say what it actually does. */
  describe: string
  decide(s: Situation, rnd: () => number): Decision
}

const best = (s: Situation, exclude: Dive | null): Zone => {
  const rows = s.board.filter((r) => r.zone !== exclude)
  return rows.reduce((a, b) => (b.multiplier > a.multiplier ? b : a)).zone
}

const flat = (zone: Zone, bank: number, id: string, describe: string): Strategy => ({
  id,
  describe,
  decide: (s) => (s.scored >= bank ? { action: 'cash' } : { action: 'kick', zone }),
})

export const STRATEGIES: Strategy[] = [
  flat('bc', 1, 'safe-1', 'straight down the middle, bank the first goal'),
  flat('bc', 3, 'safe-3', 'straight down the middle, bank after three'),
  flat('bl', 5, 'corner-5', 'low left every time, bank after the regulation five'),
  flat('tl', 1, 'escuadra-1', 'top corner, bank the first goal'),
  flat('tl', MAX_KICKS, 'escuadra-all', 'top corner every time, never bank - all ten or nothing'),
  {
    id: 'greedy',
    describe: 'whatever pays most on the board, bank after two',
    decide: (s) => (s.scored >= 2 ? { action: 'cash' } : { action: 'kick', zone: best(s, null) }),
  },
  {
    id: 'reader',
    describe: 'read the tell: when he commits, shoot where he is not; otherwise down the middle',
    decide: (s) =>
      s.scored >= 4
        ? { action: 'cash' }
        : { action: 'kick', zone: s.shown === null ? 'bc' : best(s, s.shown) },
  },
  {
    id: 'coin-flip',
    describe: 'a random zone, banked after a random number of goals',
    decide: (s, rnd) =>
      rnd() < 0.25 && s.scored > 0
        ? { action: 'cash' }
        : { action: 'kick', zone: ZONES[Math.floor(rnd() * ZONES.length)] },
  },
  {
    id: 'chaser',
    describe: 'safe until two goals are banked, then the top corner until it ends',
    decide: (s) => ({ action: 'kick', zone: s.scored < 2 ? 'bc' : 'tl' }),
  },
]

/* ------------------------------------------------------------- the simulator */

export interface Played {
  stake: Centavos
  payout: Centavos
  scored: number
  ended: 'cashed' | 'busted'
}

/**
 * One round, resolved off the same derivation the House uses.
 *
 * Deliberately NOT going through the House: a hundred thousand rounds of
 * transaction bookkeeping measures the store, and what wants measuring here is
 * the paytable. The House is checked against this separately and at a smaller
 * scale in rtp.test.ts - if the two disagree, the plumbing has introduced a bias
 * and that is worth knowing as its own fact.
 */
export function simulate(
  strategy: Strategy,
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  stake: Centavos,
  rnd: () => number,
): Played {
  const at = floatsFor(serverSeed, clientSeed, nonce)
  const survived: number[] = []

  for (let i = 0; i < MAX_KICKS; i++) {
    const rolls = rollsFor(at, i)
    const shown = rolls.tell ? rolls.dive : null

    const board: BoardRow[] = ZONES.map((zone) => ({
      zone,
      p: pGoal(zone, shown),
      multiplier: displayMultiplier(multiplierIfScored(survived, zone, shown)),
    }))

    const situation: Situation = {
      scored: survived.length,
      shown,
      board,
      multiplier: survived.length === 0 ? 0 : displayMultiplier(multiplierAfter(survived)),
    }

    const decision = strategy.decide(situation, rnd)
    if (decision.action === 'cash') {
      /* Cashing with nothing banked is not a move - the House refuses it too. */
      if (survived.length === 0) return { stake, payout: 0, scored: 0, ended: 'busted' }
      break
    }

    if (resolveKick(rolls, decision.zone) !== 'goal') {
      return { stake, payout: 0, scored: survived.length, ended: 'busted' }
    }
    survived.push(pGoal(decision.zone, shown))
  }

  return {
    stake,
    payout: payoutFor(stake, multiplierAfter(survived)),
    scored: survived.length,
    ended: 'cashed',
  }
}

/** Deterministic, so a reported RTP can be reproduced exactly from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Measured {
  strategy: Strategy
  rounds: number
  staked: Centavos
  returned: Centavos
  rtp: number
  /** 1 standard error on rtp, so the report can say whether a gap is real. */
  stderr: number
  cashed: number
  meanGoals: number
  bestMultiplier: number
}

export function measure(strategy: Strategy, rounds: number, stake: Centavos, seed: number): Measured {
  const rnd = mulberry32(seed)
  /* One server seed across the run with the nonce walking, which is exactly how
   * a real session consumes a seed. */
  const serverSeed = Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(seed + i) & 15]).join('')

  let staked = 0
  let returned = 0
  let cashed = 0
  let goals = 0
  let bestMultiplier = 0
  let sumSquares = 0

  for (let n = 0; n < rounds; n++) {
    const played = simulate(strategy, serverSeed, `cliente-${seed}`, n, stake, rnd)
    staked += played.stake
    returned += played.payout
    goals += played.scored
    if (played.ended === 'cashed' && played.payout > 0) cashed++
    bestMultiplier = Math.max(bestMultiplier, played.payout / played.stake)
    sumSquares += (played.payout / played.stake) ** 2
  }

  const rtp = returned / staked
  /* The variance of the per-round return, which on a ladder game is large - so
   * quoting an RTP without it invites reading noise as drift. */
  const variance = Math.max(0, sumSquares / rounds - rtp ** 2)

  return {
    strategy,
    rounds,
    staked,
    returned,
    rtp,
    stderr: Math.sqrt(variance / rounds),
    cashed,
    meanGoals: goals / rounds,
    bestMultiplier,
  }
}
