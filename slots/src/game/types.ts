/*
 * A three reel mechanical slot, 1899.
 *
 * The thing worth knowing about this machine, and the reason it is a game at
 * all: the payout table bolted to the front is honest on every machine in the
 * house. The odds do not live there. They live in how many of each symbol are
 * pasted onto each reel band - which the player cannot see, and which is where
 * the real ones hid it too.
 */

export const FACES = ['bell', 'shoe', 'star', 'spade', 'diamond', 'heart'] as const
export type Face = (typeof FACES)[number]

/** Stops per band. Fey's machines ran ten; twenty gives the strip room to lie. */
export const STOPS = 20

/** The window shows three, and only the middle one is paid. */
export type Window = [Face, Face, Face]

/**
 * The card on the front of the machine. Identical on all three machines in the
 * house - that is the whole point of it.
 */
export const PAYS: { readonly of: Face | 'suit' | 'bells'; count: number; coins: number }[] = [
  { of: 'bell', count: 3, coins: 100 },
  { of: 'shoe', count: 3, coins: 30 },
  { of: 'star', count: 3, coins: 20 },
  { of: 'suit', count: 3, coins: 10 },
  { of: 'bells', count: 2, coins: 5 },
  { of: 'bells', count: 1, coins: 1 },
]

export interface Machine {
  id: string
  /** Three bands, each STOPS long, read top to bottom. */
  bands: [Face[], Face[], Face[]]
  /**
   * How often the third band is walked to a stop that shows the symbol the
   * first two are holding, one row off the line.
   *
   * It only ever moves between stops carrying the *same* centre symbol, so the
   * payline - and therefore the payout, and therefore the take - is bit for bit
   * what it would have been. Nothing but the neighbours change. That is what
   * makes it the perfect gaff and what makes it invisible in the money.
   */
  nearMissBias: number
}

export type Outcome = {
  /** Where each band came to rest: the index on the payline. */
  stops: [number, number, number]
  /** Three rows per band: above the line, on it, below it. */
  windows: [Window, Window, Window]
  line: [Face, Face, Face]
  coins: number
  /** The first two agree. The room notices this before the third one lands. */
  tease: boolean
  /** The third band shows what would have paid, one row off. */
  nearMiss: boolean
  /** A bell was anywhere in the third window. The only measurement that matters. */
  bellOnThird: boolean
}

export type Reaction = 'roar' | 'cheer' | 'murmur' | 'gasp' | 'sigh' | 'jeer'

export type Phase = 'ready' | 'spinning' | 'settling' | 'called' | 'over'

export interface Session {
  machine: Machine
  bank: number
  /** Coins on the next pull. The only number the player sets. */
  stake: number
  /** Coins put in over the night, so the house knows what it owes. */
  staked: number
  pulls: number
  /** Pulls on which a bell was visible anywhere in the third window. */
  bells: number
  /** Log likelihood ratio for "the third band is short of bells". */
  evidence: number
  /** 0 to 1. The room watching you back. */
  heat: number
  best: number
  phase: Phase
  ended: 'broke' | 'thrown-out' | 'proved' | 'wrong' | null
}
