import { canPass, canRaise, liveOdds, maxRaise } from './engine'
import type { GameState, Target, VenueId } from './types'

export type Mood = 'neutral' | 'confident' | 'rattled'

export type OpponentId = 'calloway' | 'viuda'

export interface DealerRead {
  /** What they actually believe about their position. */
  truth: Mood
  /** What their face shows, which is not always the truth. */
  shown: Mood
  bluffing: boolean
}

export interface DealerPersona {
  id: OpponentId
  venue: VenueId
  /** How often they show the opposite of what they feel. */
  bluffRate: number
  /** Willingness to push chips in. */
  aggression: number
  /** Odds above which they refuse to eat a chamber themselves. */
  nerve: number
}

/** Loud, greedy, and tells on himself more often than he thinks. */
export const CALLOWAY: DealerPersona = {
  id: 'calloway',
  venue: 'saloon',
  bluffRate: 0.28,
  aggression: 0.55,
  nerve: 0.5,
}

/** Patient and very hard to read; she bluffs more and folds less. */
export const VIUDA: DealerPersona = {
  id: 'viuda',
  venue: 'cantina',
  bluffRate: 0.42,
  aggression: 0.68,
  nerve: 0.58,
}

export const OPPONENTS: Record<OpponentId, DealerPersona> = {
  calloway: CALLOWAY,
  viuda: VIUDA,
}

export const OPPONENT_ORDER: OpponentId[] = ['calloway', 'viuda']

/** Reads their own position, then decides what to let their face say about it. */
export function readDealer(state: GameState, persona: DealerPersona): DealerRead {
  const p = liveOdds(state)
  // They are comfortable when the next chamber is probably empty, because
  // that means they can fire at themselves and keep the turn.
  let truth: Mood = 'neutral'
  if (p <= 0.34) truth = 'confident'
  else if (p >= 0.6) truth = 'rattled'

  const bluffing = truth !== 'neutral' && Math.random() < persona.bluffRate
  const shown = bluffing ? (truth === 'confident' ? 'rattled' : 'confident') : truth
  return { truth, shown, bluffing }
}

export function chooseTarget(state: GameState, persona: DealerPersona): Target {
  const p = liveOdds(state)
  if (p >= 1) return 'opponent'
  // Below their nerve they eat the chamber to hold tempo; a little noise
  // keeps them from being perfectly predictable.
  const jitter = (Math.random() - 0.5) * 0.12
  return p + jitter < persona.nerve ? 'self' : 'opponent'
}

/** Whether to slide the iron across instead of taking a bad chamber. */
export function choosePass(state: GameState, persona: DealerPersona): boolean {
  if (!canPass(state, 'dealer')) return false
  const p = liveOdds(state)
  if (p < 0.55) return false
  // Worth paying the toll only while the pot is still small enough to matter.
  const price = state.mode.passToll / Math.max(1, state.pot)
  return price < 0.5 && Math.random() < 0.55 + (p - 0.55) * (1 - persona.nerve)
}

export interface DealerBet {
  action: 'raise' | 'check'
  amount: number
}

export function chooseBet(state: GameState, persona: DealerPersona): DealerBet {
  if (!canRaise(state, 'dealer')) return { action: 'check', amount: 0 }
  const p = liveOdds(state)
  const ceiling = maxRaise(state, 'dealer')

  // Value raise: they are about to hand a probably-live chamber across.
  const valueSpot = p >= 0.55
  // Bluff raise: the chamber is probably empty but the pot should look scary.
  const bluffSpot = p <= 0.3 && Math.random() < persona.bluffRate

  if (!valueSpot && !bluffSpot) return { action: 'check', amount: 0 }
  if (Math.random() > persona.aggression) return { action: 'check', amount: 0 }

  const base = Math.max(state.ante, Math.round(state.pot * 0.4))
  const amount = Math.max(1, Math.min(ceiling, Math.round(base * (0.7 + Math.random() * 0.8))))
  return { action: 'raise', amount }
}

export type DealerResponse = 'call' | 'fold'

export function respondToRaise(state: GameState, persona: DealerPersona): DealerResponse {
  const p = liveOdds(state)
  const price = state.toCall
  const odds = price / (state.pot + price)
  // They fold when the chips demanded outweigh how safe the cylinder feels,
  // and never fold a spot where they can simply pass the chamber along.
  const survival = 1 - p * 0.5
  if (p >= 0.85) return 'call'
  if (odds > survival * (0.6 + persona.aggression * 0.5)) return 'fold'
  if (price > state.chips.dealer * 0.75 && p > 0.5) return 'fold'
  return 'call'
}
