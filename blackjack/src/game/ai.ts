import { cardValue, edge, score, total } from './engine'
import type { CheatKind, GameState, HouseCall } from './types'

/** What her face is doing. The score's colour is bound to this, never to the truth. */
export type Mood = 'cool' | 'warm' | 'sharp'

export interface DealerRead {
  /** What she actually thinks of her position. */
  truth: Mood
  /** What she lets you see, which is not always the same thing. */
  shown: Mood
  bluffing: boolean
}

export interface Persona {
  name: string
  /** How often she shows something other than what she feels. */
  bluffRate: number
  /** How readable her hands are when she works. Lower is nastier. */
  tellRate: number
  /** Willingness to reach for a move at all. */
  nerve: number
  /** How quickly she notices you watching her. */
  attention: number
}

/**
 * She has dealt this deck ten thousand times. Patient, extremely hard to read,
 * and she works the shoe only when the arithmetic has turned against the house.
 */
export const ROSA: Persona = {
  name: 'Rosa Ibarra',
  bluffRate: 0.38,
  tellRate: 0.62,
  nerve: 0.55,
  attention: 0.5,
}

/** Reads her own spot, then decides what to let her face say about it. */
export function readDealer(state: GameState, p: Persona, rnd: () => number = Math.random): DealerRead {
  const up = state.dealerHand.cards[0]
  const upVal = up ? cardValue(up.rank) : 0
  const you = state.hands[state.active]
  const yours = you ? total(you.cards) : 0

  let truth: Mood = 'cool'
  // A ten or an ace up against a stiff is a good night; a five or six is not.
  if (upVal >= 10 && yours > 0 && yours < 17) truth = 'sharp'
  else if (upVal >= 4 && upVal <= 6) truth = 'warm'
  else if (edge(state) > 0.62) truth = 'warm'

  const bluffing = rnd() < p.bluffRate
  const shown = bluffing ? (truth === 'sharp' ? 'warm' : truth === 'warm' ? 'sharp' : 'warm') : truth
  return { truth, shown, bluffing }
}

/**
 * Whether she works this round, and how.
 *
 * She reaches for the shoe when the count has swung to you and the money on the
 * felt is worth the risk, and she backs off when the room is already watching -
 * heat cuts both ways, which is what makes leaning on her worth doing.
 */
export function chooseCheat(state: GameState, p: Persona, rnd: () => number = Math.random): CheatKind | null {
  const e = edge(state)
  const stake = Math.min(1, state.bet / Math.max(1, state.rules.minBet * 8))
  // Appetite is how much this particular spot tempts her; cheatBase is how much
  // she is tempted at all, so it scales the whole thing rather than adding to it.
  const appetite = (0.55 + e * 1.15 + stake * 0.5) * (1 - state.heat * 0.75)
  const urge = state.rules.cheatBase * (p.nerve + 0.5) * Math.max(0, appetite)

  if (rnd() > urge) return null
  // A peek is cheap and quiet; seconds move real money but show more hand.
  return rnd() < 0.45 ? 'peek' : 'second'
}

/** Whether she rings in a stacked packet while shuffling. */
export function chooseCold(state: GameState, p: Persona, rnd: () => number = Math.random): boolean {
  const urge = state.rules.cheatBase * p.nerve * (0.8 + edge(state) * 1.2) * (1 - state.heat * 0.8)
  return rnd() < Math.max(0, urge)
}

/** How visible her hands are on a given move. */
export function tellHold(p: Persona, leaning: boolean, rnd: () => number = Math.random): number {
  const base = leaning ? 210 : 120
  const slop = 0.7 + rnd() * 0.6
  return Math.round(base * slop * (0.6 + p.tellRate * 0.7))
}

/** She notices you leaning over her hands. */
export function heatFromLean(p: Persona, seconds: number): number {
  return seconds * 0.05 * (0.6 + p.attention)
}

/**
 * The rule she buys, when the table lets her. She takes your double away when
 * the count says you want it, and flattens the natural when you are betting big.
 */
export function chooseHouseRule(state: GameState, rnd: () => number = Math.random): { which: HouseCall; fee: number } | null {
  if (!state.rules.houseMayRule) return null
  if (rnd() > 0.22) return null
  const e = edge(state)
  const which: HouseCall = e > 0.6 ? 'no_double' : rnd() < 0.5 ? 'flat_natural' : 'no_split'
  const fee = Math.max(5, Math.round(state.bet * 0.35))
  return { which, fee }
}

/** Her reaction to how the round went, used to pick a plate and a clip. */
export function reactionTo(net: number, caught: boolean, falseCall: boolean): Mood | 'caught' {
  if (caught) return 'caught'
  if (falseCall) return 'sharp'
  if (net > 0) return 'warm'
  if (net < 0) return 'sharp'
  return 'cool'
}

/** How hot the arrangement should run, from the shoe and from the room. */
export function scoreParams(state: GameState, read: DealerRead): { edge: number; heat: number; warmth: number } {
  const { total: t } = score(state.dealerHand.cards)
  const pressure = state.phase === 'dealer' && t >= 17 ? 0.15 : 0
  return {
    edge: Math.min(1, edge(state) + pressure),
    heat: state.heat,
    warmth: read.shown === 'warm' ? 0.85 : read.shown === 'sharp' ? 0.25 : 0.5,
  }
}
