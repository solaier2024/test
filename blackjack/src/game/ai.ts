import { cardValue, edge, pressure, score, total } from './engine'
import type { GameState, HandResult } from './types'

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
}

/**
 * She has dealt this deck ten thousand times. Patient, unhurried, and almost
 * impossible to read - which is the only house edge she needs.
 */
export const ROSA: Persona = {
  name: 'Rosa Ibarra',
  bluffRate: 0.38,
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
 * Her reaction to how the round went, used to pick a plate and a clip. A
 * natural gets its own beat because she names it out loud; everything else she
 * takes with the same two faces.
 */
export function reactionTo(net: number, perHand: HandResult[]): Mood | 'natural' {
  if (perHand.includes('natural')) return 'natural'
  if (net > 0) return 'warm'
  if (net < 0) return 'sharp'
  return 'cool'
}

/** How hot the arrangement should run, from the shoe and from the room. */
export function scoreParams(state: GameState, read: DealerRead): { edge: number; heat: number; warmth: number } {
  const { total: t } = score(state.dealerHand.cards)
  const lean = state.phase === 'dealer' && t >= 17 ? 0.15 : 0
  return {
    edge: Math.min(1, edge(state) + lean),
    heat: pressure(state),
    warmth: read.shown === 'warm' ? 0.85 : read.shown === 'sharp' ? 0.25 : 0.5,
  }
}
