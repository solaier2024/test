import { canRaise, liveOdds, maxRaise } from './engine'
import type { GameState, Target } from './types'

export type Mood = 'neutral' | 'confident' | 'rattled'

export interface DealerRead {
  /** What he actually believes about his position. */
  truth: Mood
  /** What his face shows, which is not always the truth. */
  shown: Mood
  bluffing: boolean
}

export interface DealerPersona {
  name: string
  /** How often he shows the opposite of what he feels. */
  bluffRate: number
  /** Willingness to push chips in. */
  aggression: number
  /** Odds threshold above which he refuses to eat a chamber himself. */
  nerve: number
}

export const CALLOWAY: DealerPersona = {
  name: '"疤脸" 卡洛威',
  bluffRate: 0.28,
  aggression: 0.55,
  nerve: 0.5,
}

/** Reads his own position, then decides what to let his face say about it. */
export function readDealer(state: GameState, persona: DealerPersona): DealerRead {
  const p = liveOdds(state)
  // He is comfortable when the next chamber is probably empty, because that
  // means he can fire at himself and keep the turn.
  let truth: Mood = 'neutral'
  if (p <= 0.34) truth = 'confident'
  else if (p >= 0.6) truth = 'rattled'

  const bluffing = truth !== 'neutral' && Math.random() < persona.bluffRate
  let shown = truth
  if (bluffing) shown = truth === 'confident' ? 'rattled' : 'confident'
  return { truth, shown, bluffing }
}

export function chooseTarget(state: GameState, persona: DealerPersona): Target {
  const p = liveOdds(state)
  if (p >= 1) return 'opponent'
  // Below his nerve threshold he eats the chamber to hold tempo; a small amount
  // of noise keeps him from being perfectly predictable.
  const jitter = (Math.random() - 0.5) * 0.12
  return p + jitter < persona.nerve ? 'self' : 'opponent'
}

export interface DealerBet {
  action: 'raise' | 'check'
  amount: number
}

export function chooseBet(state: GameState, persona: DealerPersona): DealerBet {
  if (!canRaise(state, 'dealer')) return { action: 'check', amount: 0 }
  const p = liveOdds(state)
  const ceiling = maxRaise(state, 'dealer')

  // Value raise: he is about to hand a probably-live chamber to the player.
  const valueSpot = p >= 0.55
  // Bluff raise: the chamber is probably empty but he wants the pot to look scary.
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
  // He folds when the chips demanded outweigh how safe the cylinder feels,
  // and he will not fold a spot where he can simply pass the chamber along.
  const survival = 1 - p * 0.5
  if (p >= 0.85) return 'call'
  if (odds > survival * (0.6 + persona.aggression * 0.5)) return 'fold'
  if (price > state.chips.dealer * 0.75 && p > 0.5) return 'fold'
  return 'call'
}
