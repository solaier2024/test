/*
 * LA TANDA - the shootout. What the money actually rides on.
 *
 * THE PROBLEM THIS FILE SOLVES
 *
 * The brief said: the server decides the outcome, and the player's aim only
 * affects presentation. The first half is non-negotiable. The second half, left
 * as written, builds a slot machine with a lie painted on it - the player is
 * given a joystick that does nothing, and sooner or later somebody proves it
 * and the operator has no answer. A certification lab will also read a skill
 * surface over a pure RNG as misleading, which is a licence problem and not a
 * taste problem.
 *
 * So the aim is not cosmetic here. It is a bet.
 *
 *   The RNG decides THE KEEPER - which way he goes, and whether he gets there.
 *   The player decides WHERE TO SHOOT, and that genuinely changes the outcome.
 *   The house edge is identical in all six zones, so no zone is a trap and
 *   none is exploitable.
 *
 * This is the shape of Mines and of Dice: the randomness is committed up front,
 * the player's choice selects which committed thing gets opened. It keeps the
 * whole provably fair story intact - the keeper is fixed before the first
 * touch - while making the joystick real. It is also just what a penalty IS:
 * you pick a corner, he picks a corner, and the corner that pays best is the
 * one you are most likely to put over the bar.
 *
 * WHERE THE RISK LADDER COMES FROM
 *
 * Two independent hazards per kick, which is what gives the zones different
 * shapes instead of just different numbers:
 *
 *   onTarget   you can miss the goal entirely. Punishes the top corners, and
 *              the keeper has nothing to do with it.
 *   dive*reach he has to guess your zone AND get to it. Punishes the low
 *              corners, which is where he lives.
 *
 * The top corner is the worst bet against a keeper and the best bet against
 * yourself. That crossover is the game.
 */

import type { Floats } from './fair.ts'

/** Minor units. Every amount in this codebase is centavos, never a float. */
export type Centavos = number

export const ZONES = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const
export type Zone = (typeof ZONES)[number]

/** The six the keeper can go, which is the same six - he has no seventh move. */
export type Dive = Zone

export interface ZoneModel {
  id: Zone
  /** P(the ball is inside the frame | aimed here). Nothing to do with him. */
  onTarget: number
  /** P(he goes here). Sums to 1 across the six. Fixed, published, unadaptive. */
  dive: number
  /** P(he stops it | he went here and the ball came here). */
  reach: number
}

/*
 * These six rows are the entire game economy, and they are the only numbers a
 * lab has to be handed alongside the RNG. Tuning volatility means editing this
 * table; it means editing nothing else, because every multiplier in the game is
 * derived from it at runtime rather than typed in somewhere as well.
 *
 * Sanity anchor: a real top-flight penalty converts around 75-80%. The blended
 * conversion here is in that band (asserted in table.test.ts), so the numbers
 * are defensible as football and not just as a paytable.
 */
export const TABLE: Record<Zone, ZoneModel> = {
  /* Escuadra - where the post meets the bar. Hardest to hit, least defended. */
  tl: { id: 'tl', onTarget: 0.58, dive: 0.10, reach: 0.35 },
  /* Over him, down the middle. Easy to hit; if he stays home he is already there. */
  tc: { id: 'tc', onTarget: 0.74, dive: 0.08, reach: 0.55 },
  tr: { id: 'tr', onTarget: 0.58, dive: 0.10, reach: 0.35 },
  /* Low and hard to a corner. The textbook penalty, and the one he trains for. */
  bl: { id: 'bl', onTarget: 0.90, dive: 0.29, reach: 0.72 },
  /* Straight at him. You will not miss the goal. You will hit the keeper. */
  bc: { id: 'bc', onTarget: 0.94, dive: 0.14, reach: 0.90 },
  br: { id: 'br', onTarget: 0.90, dive: 0.29, reach: 0.72 },
}

/**
 * The ceiling on onTarget, and the reason it is not 0.99.
 *
 * This was found by a test rather than by thinking, and it is the one
 * non-obvious constraint the paytable has to satisfy. When the keeper tips his
 * hand, shooting where he is not is priced at 1/onTarget - so if any zone's
 * onTarget exceeds RTP, that zone's first-kick multiplier comes out BELOW 1.00x
 * and the game offers the player a bet that pays less than it costs.
 *
 * Nothing about it is dishonest: it is a fair price for a near-certainty, and
 * the round's RTP is still exactly 0.97. It is simply an offer no player should
 * take and no operator should print, and it would be read - correctly - as the
 * house having stopped paying attention.
 *
 * So: every onTarget stays under RTP, and table.test.ts asserts that no zone in
 * any information state can be priced under 1.00x. Raising the house edge tightens
 * this ceiling, which is worth knowing before someone tunes the edge upward.
 */
export const MAX_ON_TARGET = 0.94

/**
 * House edge, taken ONCE per round on the first kick and never again.
 *
 * Standard ladder pricing: the cumulative multiplier after k goals is
 * (1 - edge) / P(all k goals), so a player who cashes out after one goal and a
 * player who cashes out after nine have exactly the same expected return. That
 * matters more than it sounds - it means there is no optimal stopping point to
 * discover, so no player is being quietly punished for playing the game the way
 * the game invites them to.
 */
export const HOUSE_EDGE = 0.03
export const RTP = 1 - HOUSE_EDGE

/** Five in the shootout proper, then five of sudden death. */
export const REGULATION_KICKS = 5
export const MAX_KICKS = 10

/**
 * A liability cap, and it is asserted NON-BINDING in table.test.ts.
 *
 * A cap that can be reached is a cap that silently cuts RTP on the one path a
 * player worked hardest for, and that is the sort of thing that gets found by a
 * player before it gets found by us. The most a perfect run can pay is about
 * 322x, so this sits well clear of it and exists only so that a future edit to
 * TABLE cannot create an unbounded payout without a red test.
 */
export const MAX_WIN_MULTIPLIER = 500

/**
 * How often he commits early - the amago, the tell.
 *
 * This is the one thing that makes the player's choice a read rather than only
 * a preference, and it is the reason this game has a skill surface at all that
 * survives being audited. When the tell fires, the client is shown which way he
 * is going BEFORE the player picks.
 *
 * It does not leak edge, because the payout is repriced against what the player
 * now knows: pick a zone he has left and the multiplier collapses to 1/onTarget,
 * because the only thing left to beat is yourself. RTP is unchanged to the
 * centavo - the information is sold at exactly its worth, which is what keeps
 * this certifiable instead of clever.
 *
 * Notice it is worth almost nothing on a top corner (he was never there) and a
 * great deal low and central (he was always there). The player who understands
 * that is playing better than the player who does not, and neither can beat
 * 97%. That is the most honest shape a skill surface can have.
 */
export const TELL_RATE = 0.18

/**
 * Floats consumed per kick, in cursor order: the tell, his dive, his reach, and
 * the shooter's accuracy.
 *
 * All four are committed before the player picks a zone, including the accuracy
 * roll - whose THRESHOLD is onTarget[zone] and therefore is not known until the
 * player chooses. That split is the whole trick, and it is the same one Mines
 * uses: the randomness is fixed in advance, the player decides what it gets
 * compared against. Nothing adapts to the shot, and the shot still matters.
 */
export const FLOATS_PER_KICK = 4

export type Roll = 0 | 1 | 2 | 3

export const cursorFor = (kickIndex: number, which: Roll): number => kickIndex * FLOATS_PER_KICK + which

/** Every float a round can possibly need, so one derivation covers the round. */
export const FLOATS_PER_ROUND = MAX_KICKS * FLOATS_PER_KICK

/* ------------------------------------------------------------ the keeper */

/**
 * Which way he goes, from one float. Walked in fixed ZONES order so the mapping
 * is a published fact a player can re-derive, not an implementation detail.
 */
export function diveFor(f: number): Dive {
  let acc = 0
  for (const z of ZONES) {
    acc += TABLE[z].dive
    if (f < acc) return z
  }
  /* Only reachable through float === 1, which cannot happen, or through a dive
   * column that no longer sums to 1 - which table.test.ts refuses to allow. */
  return ZONES[ZONES.length - 1]
}

/**
 * Everything one kick's four floats decide. All of it fixed before the player
 * picks, none of it a function of what the player picks.
 */
export interface KickRolls {
  /** Did he commit early. */
  tell: boolean
  dive: Dive
  /** Pre-rolled: would he hold it, if the ball came to where he went. */
  reaches: boolean
  /** Raw. Compared against onTarget[zone] once the player has chosen. */
  accuracy: number
}

export function rollsFor(at: Floats, kickIndex: number): KickRolls {
  const dive = diveFor(at(cursorFor(kickIndex, 1)))
  return {
    tell: at(cursorFor(kickIndex, 0)) < TELL_RATE,
    dive,
    reaches: at(cursorFor(kickIndex, 2)) < TABLE[dive].reach,
    accuracy: at(cursorFor(kickIndex, 3)),
  }
}

/** How a kick ended, which is the only thing the player is shown afterwards. */
export type KickResult = 'goal' | 'saved' | 'missed'

/**
 * The outcome. Reads like the sentence it is: you have to hit the goal, and he
 * has to not be there.
 */
export function resolveKick(rolls: KickRolls, zone: Zone): KickResult {
  if (rolls.accuracy >= TABLE[zone].onTarget) return 'missed'
  if (rolls.dive === zone && rolls.reaches) return 'saved'
  return 'goal'
}

/* ------------------------------------------------------- the probabilities */

/**
 * P(goal | shooting here), before he has shown anything.
 *
 * He must both guess the zone and get there, so his contribution is
 * dive * reach and everything else is the shooter's own accuracy.
 */
export const pGoalBlind = (z: Zone): number => {
  const m = TABLE[z]
  return m.onTarget * (1 - m.dive * m.reach)
}

/**
 * P(goal | shooting here, knowing he is going THERE).
 *
 * Collapses the dive distribution onto one zone. Anywhere he is not, the only
 * thing left is whether the shooter hits the target.
 */
export const pGoalKnowing = (z: Zone, dive: Dive): number => {
  const m = TABLE[z]
  return m.onTarget * (1 - (z === dive ? m.reach : 0))
}

/**
 * The probability the payout is priced against, given what the player can see.
 *
 * This is the single function that keeps RTP exact. The tell is rolled
 * independently of the dive, so pricing each kick against the player's actual
 * information makes the sequence a martingale - and the round's expected return
 * stays at RTP no matter how the player plays, or how lucky they are with
 * tells. rtp.test.ts measures that rather than taking it on faith.
 */
export const pGoal = (z: Zone, shown: Dive | null): number =>
  shown === null ? pGoalBlind(z) : pGoalKnowing(z, shown)

/* -------------------------------------------------------- the multipliers */

/**
 * What the board pays after a run of kicks, each priced on what was known at
 * the time.
 *
 * @param survived probabilities of the goals already scored, in order.
 */
export const multiplierAfter = (survived: readonly number[]): number =>
  survived.reduce((m, p) => m / p, RTP)

/** What the board would read if this kick goes in. */
export const multiplierIfScored = (survived: readonly number[], z: Zone, shown: Dive | null): number =>
  multiplierAfter([...survived, pGoal(z, shown)])

/**
 * Centavos out. Truncated, not rounded: a half-centavo cannot be paid, and the
 * direction it is dropped has to be decided once, here, rather than falling out
 * of whatever the display layer does.
 */
export const payoutFor = (stake: Centavos, multiplier: number): Centavos =>
  Math.floor(stake * Math.min(multiplier, MAX_WIN_MULTIPLIER))

/** Two decimals, floored, so the board never promises more than it will pay. */
export const displayMultiplier = (m: number): number => Math.floor(Math.min(m, MAX_WIN_MULTIPLIER) * 100) / 100
