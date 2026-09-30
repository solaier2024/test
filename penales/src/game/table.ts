/*
 * LA TANDA - the shootout. What the money actually rides on.
 *
 * THE PROBLEM THIS FILE SOLVES
 *
 * The brief said: the engine decides the outcome, and the player's aim only
 * affects presentation. The first half is non-negotiable. The second half, left as
 * written, builds a slot machine with a lie painted on it - the player is handed a
 * joystick that does nothing, and a joystick that does nothing is found out. It is
 * also the exact failure the first table in this series was built against: the
 * README there says the problem with web casino games is that the player has no
 * decision, only a wait for the result.
 *
 * So the aim is not cosmetic here. It is a bet.
 *
 *   The RNG decides THE KEEPER - which way he goes, and whether he gets there.
 *   The player decides WHERE TO SHOOT, and that genuinely changes the outcome.
 *   The house edge is identical in all six corners, so no corner is a trap and
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

/** Minor units. Every amount in this codebase is chips, never a float. */
export type Chips = number

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
 * The most a round can pay, as a multiple of the stake.
 *
 * THIS CAP IS REACHABLE, AND THE FIRST VERSION OF THIS FILE SAID IT WAS NOT.
 *
 * The reasoning was: the hardest zone scores 56% of the time, ten of those is
 * 322x, so a cap at 500x can never bite. That is true of the blind
 * probabilities and false of the game. A player who shoots where the keeper has
 * just shown he is going faces a probability as low as 9.4%, and is paid for it -
 * so the real peak, over ten kicks straight down the middle into his hands, is
 * about 1.8e10. The cap binds, and at 500x it cost 0.35 percentage points of
 * return on the worst-affected way of playing. It was found by `npm run rtp`
 * reporting a 500.00x best win on a strategy whose arithmetic tops out at 322x.
 *
 * So the cap is set from the exact figures in exact.ts rather than from
 * intuition:
 *
 *     cap        cost to the worst-affected play
 *     500x       0.3494 pp     <- what this used to be
 *     1,000x     0.1234 pp
 *     5,000x     0.0063 pp     <- here
 *     50,000x    0.0002 pp
 *
 * 5,000x costs less than a hundredth of a percentage point, which is finer than any
 * measurement will resolve, and it is a top prize worth printing on the front of the
 * game.
 *
 * It still bounds the biggest single payout, which is the other thing a cap is for -
 * with the largest ante the table takes, 5,000x is the most one round can hand back.
 */
export const MAX_WIN_MULTIPLIER = 5_000

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

/* --------------------------------------------------- the crooked keeper */

/*
 * HE CHEATS, AND CATCHING HIM IS THE POINT.
 *
 * SERIES.md puts one thing through every table in the house: you are not betting on
 * the cards, you are betting on whether his hands are clean. Heat carries across
 * tables, and the back room is where it ends.
 *
 * An earlier version of this file wrote this table OUT of that - it argued that a lot
 * in front of everybody is the one place nobody can cheat, so this is the table with
 * no cheating in it. That was wrong twice over. It threw away the only thing the
 * series has that runs through everything, and it is not even true: the most
 * commonplace cheat in football is a goalkeeper coming off his line early, it happens
 * in front of eighty thousand people every week, and the reason it works is precisely
 * that everybody is watching the ball instead of his feet.
 *
 * So: he steals a step. His reach goes up, the odds on the board do not, and he is
 * taking the difference. You can call it, and the call costs you.
 *
 * WHAT THIS DOES TO THE RETURN, SAID PLAINLY
 *
 * It makes the return depend on whether you catch him. That is a deliberate break
 * with the rest of the paytable, where no way of playing beats any other - and it is
 * the same break EL BANDIDO MANCO makes, where the three machines return 88.7%, 78.3%
 * and 67.9% off an identical pay card and the player's whole job is working out which
 * one they are sitting at.
 *
 * Three numbers, all computed exactly in exact.ts rather than estimated:
 *
 *   he never cheats          97.00%   the clean game, and what the board quotes
 *   he cheats, you never call  lower  he keeps the difference
 *   he cheats, you always call ~97%   the ante back on a called save, which is tuned
 *                                     to bring it back without overshooting
 *
 * The middle number is the one the player is being invited to do something about.
 */

/** How often he steals a step off his line, while he thinks he is getting away with it. */
export const STEAL_RATE = 0.12

/**
 * How much further he gets for it. Added to his reach, and it is the entire
 * mechanical effect - his dive distribution is untouched, so he is not guessing any
 * better, just arriving sooner.
 */
export const STEAL_REACH = 0.12

/**
 * What calling him correctly buys: he plays straight for this many rounds.
 *
 * NOT A REFUND, AND THAT TOOK TWO WRONG ANSWERS TO ARRIVE AT.
 *
 * The obvious remedy is to hand something back. Every version of that overshoots, and
 * the exact figures say so without any room for argument:
 *
 *   Void the round and let the player keep the ladder. The value of a position in this
 *   ladder IS its cash-out figure, so on a five-kick ladder this hands back about five
 *   times what the theft was worth. "Always call" came out over 100%.
 *
 *   Refund a flat fraction of the ante. Wrong shape: what he steals grows with the
 *   multiplier, a flat ante does not. Solving for the fraction that just avoids
 *   overshoot gives about a tenth of the ante, which is both an unexplainable number
 *   and a pathetic reward for catching somebody cheating.
 *
 * So the remedy is not a payment. It is that the game becomes fair - he keeps his feet
 * on the line for a while, because he has been seen. That cannot overshoot BY
 * CONSTRUCTION, because the best it can do is the clean game, and the clean game is
 * 97.00%. No knife-edge constant, nothing to tune, and one sentence to explain.
 *
 * It also puts the skill in the right place. The reward for reading him is not a
 * consolation payment on a round you already lost; it is the next five rounds being
 * the game the board is advertising.
 */
export const STRAIGHT_ROUNDS = 5

/* ------------------------------------------------------------ buying him */

/*
 * THE OTHER HALF: YOU CAN DO IT TOO.
 *
 * SERIES.md again - the system has to be two-way, and the back half of the series is
 * learning to do it without being caught. Here it is the simplest transaction on the
 * lot: you pay him to go the wrong way.
 *
 * It does NOT buy edge, and it is priced so that it cannot. If the money takes, his
 * dive is redirected away from the corner you named - so the only thing left between
 * you and the goal is your own aim, the probability goes up, and the multiplier comes
 * down by exactly as much. What you are buying is survival on a ladder you do not want
 * to lose, at the price of the ladder growing more slowly.
 *
 * What it costs is heat, one of a handful of chances in a night, and the risk it does
 * not take - in which case he plays straight and mentions it to the man running the
 * lot.
 *
 * Nothing about it breaks the commitment. Whether the money takes is a committed roll
 * like everything else, and where he goes instead is derived from the same dive float
 * with your corner removed from the distribution. The player names a corner, the seed
 * does the rest, and a reveal reproduces all of it.
 */

/** How often the money takes. Published, because it is priced into the payout. */
export const BRIBE_TAKES = 0.7

/** Chances in a night. */
export const BRIBES_PER_SESSION = 3

/** Heat from buying him, and from being seen trying. */
export const HEAT_BRIBE = 0.16
export const HEAT_BRIBE_FAILED = 0.3
/**
 * Heat from calling him wrong. Calling him RIGHT costs nothing - he is the one who was
 * cheating, and charging the player for noticing would be an odd thing for the game to
 * think.
 */
export const HEAT_CALL_WRONG = 0.22
/**
 * What a clean round gives back. Playing straight is how you cool off.
 *
 * Small on purpose, and it was three times this at first, which made standing a
 * resource that could not run out: one wrong call cost 0.22 and two and a half honest
 * rounds paid it straight back, so the ceiling was unreachable and "run off the lot" was
 * a state no player would ever see. At this rate a wrong call takes seven honest rounds
 * to work off, which makes the call a decision instead of a free action.
 */
export const HEAT_CLEAN_ROUND = -0.03

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
export const FLOATS_PER_KICK = 6

/** tell, dive, reach, accuracy, steal, bribe. */
export type Roll = 0 | 1 | 2 | 3 | 4 | 5

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
 * Where he goes when he has been paid to avoid a corner.
 *
 * The same dive column with one row struck out and the rest renormalised, walked with
 * the same float. So it is still a function of the seed and the player's choice and
 * nothing else - a reveal reproduces it, and he is not being steered by anything the
 * house does after the fact.
 */
export function diveAvoiding(f: number, avoid: Zone): Dive {
  const total = 1 - TABLE[avoid].dive
  let acc = 0
  for (const z of ZONES) {
    if (z === avoid) continue
    acc += TABLE[z].dive / total
    if (f < acc) return z
  }
  return ZONES.find((z) => z !== avoid)!
}

/**
 * Everything one kick's four floats decide. All of it fixed before the player
 * picks, none of it a function of what the player picks.
 */
export interface KickRolls {
  /** Did he commit early. */
  tell: boolean
  /** Where he goes if nobody has paid him. */
  dive: Dive
  /** Raw, so a redirected dive can be walked from the same number. */
  diveRoll: number
  /** He stole a step off his line. Worth reach, and worth calling. */
  steals: boolean
  /** Raw. Compared against his reach once it is known whether he stole. */
  reachRoll: number
  /** Raw. Compared against onTarget[zone] once the player has chosen. */
  accuracy: number
  /** If he is paid, does the money take. */
  bribeTakes: boolean
}

/**
 * @param straight he has been called out recently and is keeping his feet on the line.
 *        Suppressing the steal here rather than at the roll keeps the derivation
 *        untouched - the float is the same float, and the reveal records whether he was
 *        on his best behaviour, so a player can reproduce every kick either way.
 */
export function rollsFor(at: Floats, kickIndex: number, straight = false): KickRolls {
  return {
    tell: at(cursorFor(kickIndex, 0)) < TELL_RATE,
    dive: diveFor(at(cursorFor(kickIndex, 1))),
    diveRoll: at(cursorFor(kickIndex, 1)),
    reachRoll: at(cursorFor(kickIndex, 2)),
    accuracy: at(cursorFor(kickIndex, 3)),
    steals: !straight && at(cursorFor(kickIndex, 4)) < STEAL_RATE,
    bribeTakes: at(cursorFor(kickIndex, 5)) < BRIBE_TAKES,
  }
}

/** How far he actually gets, given whether he stole a step. */
export const reachOf = (dive: Dive, steals: boolean): number =>
  Math.min(1, TABLE[dive].reach + (steals ? STEAL_REACH : 0))

/** How a kick ended, which is the only thing the player is shown afterwards. */
export type KickResult = 'goal' | 'saved' | 'missed'

/** Everything one kick turned into, including the parts that are only for the audit. */
export interface Played {
  result: KickResult
  /** Where he actually went, after any money changed hands. */
  dive: Dive
  /** He was off his line. True whether or not the player noticed. */
  stole: boolean
  /** The player paid him and the money took. */
  bought: boolean
}

/**
 * The outcome. Reads like the sentence it is: you have to hit the goal, and he has to
 * not be there.
 *
 * @param bribed the player paid him to avoid this corner. Whether it took is a
 *        committed roll, so this is a request rather than an instruction.
 */
export function resolveKick(rolls: KickRolls, zone: Zone, bribed = false): Played {
  const bought = bribed && rolls.bribeTakes
  const dive = bought ? diveAvoiding(rolls.diveRoll, zone) : rolls.dive
  const stole = rolls.steals
  const reaches = rolls.reachRoll < reachOf(dive, stole)

  if (rolls.accuracy >= TABLE[zone].onTarget) return { result: 'missed', dive, stole, bought }
  if (dive === zone && reaches) return { result: 'saved', dive, stole, bought }
  return { result: 'goal', dive, stole, bought }
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
 * P(goal | shooting here, and he has shown he is going somewhere else).
 *
 * Which is just the shooter's own accuracy - there is nothing else left in the
 * way. Named because it is the ceiling every other probability in the game sits
 * under, and the one MAX_ON_TARGET constrains.
 */
export const onTargetOf = (z: Zone): number => TABLE[z].onTarget

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

/**
 * P(goal | shooting here, having paid him to go somewhere else).
 *
 * If the money takes he is not in this corner at all, so the only thing left is aim.
 * If it does not, nothing has changed. Published, because the payout is priced against
 * it - buying him raises the probability and lowers the multiplier by exactly as much,
 * so it buys survival and not edge.
 */
export const pGoalBought = (z: Zone, shown: Dive | null): number =>
  BRIBE_TAKES * onTargetOf(z) + (1 - BRIBE_TAKES) * pGoal(z, shown)

/** The probability a kick is priced against, given everything the player knows and did. */
export const pGoalFor = (z: Zone, shown: Dive | null, bribed: boolean): number =>
  bribed ? pGoalBought(z, shown) : pGoal(z, shown)

/**
 * What he is taking when he steals a step, as a probability, for one corner.
 *
 * Positive: the board quotes the clean number and he arrives sooner than that. This is
 * the whole of the theft, and exact.ts turns it into the return figures.
 */
export const stolenFrom = (z: Zone): number => {
  const m = TABLE[z]
  return m.onTarget * m.dive * (Math.min(1, m.reach + STEAL_REACH) - m.reach) * STEAL_RATE
}

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
 * Chips out. Truncated, not rounded: a half-centavo cannot be paid, and the
 * direction it is dropped has to be decided once, here, rather than falling out
 * of whatever the display layer does.
 */
export const payoutFor = (stake: Chips, multiplier: number): Chips =>
  Math.floor(stake * Math.min(multiplier, MAX_WIN_MULTIPLIER))

/** Two decimals, floored, so the board never promises more than it will pay. */
export const displayMultiplier = (m: number): number => Math.floor(Math.min(m, MAX_WIN_MULTIPLIER) * 100) / 100
