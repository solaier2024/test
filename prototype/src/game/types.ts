export type Side = 'player' | 'dealer'

export type Target = 'self' | 'opponent'

/** A chamber is either loaded with a live round or an empty casing. */
export type Chamber = 'live' | 'blank'

export type ModeId = 'classic' | 'quickdraw' | 'widowmaker' | 'diablo'

export type VenueId = 'saloon' | 'cantina'

/**
 * Everything that differs between the tables. The engine reads this rather
 * than branching on the mode id, so a new variant is a data change.
 */
export interface ModeConfig {
  id: ModeId
  venue: VenueId
  chambers: number
  /** Live-round counts that may be loaded. */
  loads: number[]
  /** Who decides how many live rounds go in. */
  loadedBy: Side
  /** Raise, call and fold are available between chambers. */
  betting: boolean
  anteBase: number
  /**
   * Chips each side is forced to add to the pot after surviving a chamber.
   * Escalates the stakes as the cylinder gets deadlier.
   */
  blankAnte: number
  /** Times each side may skip a chamber instead of firing, per hand. */
  passes: number
  /** Chips the passer pays into the pot to skip a chamber. */
  passToll: number
  /** Multiplier on cinematic beat lengths; below 1 plays faster. */
  pacing: number
}

export type Phase =
  /** Between hands: the cylinder is open and being loaded. */
  | 'loading'
  /** Cylinder is spun and sealed; the active side may bet then fire. */
  | 'betting'
  /** A raise is on the table and the other side must call or fold. */
  | 'facing_raise'
  /** A shot is being played out cinematically; input is locked. */
  | 'resolving'
  /** The hand is over, waiting for acknowledgement. */
  | 'round_over'
  /** One side is out of chips. */
  | 'match_over'

export type OutcomeReason = 'shot' | 'fold'

export interface RoundOutcome {
  winner: Side
  reason: OutcomeReason
  pot: number
  /** The chambers as they actually sat, revealed once the hand is settled. */
  revealed: Chamber[]
}

export interface GameState {
  mode: ModeConfig
  phase: Phase
  /** Remaining chambers in firing order. Index 0 is next under the hammer. */
  cylinder: Chamber[]
  /** The full cylinder as loaded, kept hidden until the hand settles. */
  loadedOrder: Chamber[]
  loadedLive: number
  loadedTotal: number
  /** How many chambers have already been fired this hand. */
  fired: number
  turn: Side
  chips: Record<Side, number>
  pot: number
  ante: number
  /** Chips the side facing a raise must match to stay in the hand. */
  toCall: number
  /** Side that made the outstanding raise, if any. */
  raiser: Side | null
  /** Raises already made against the current chamber, to cap escalation. */
  raisesThisChamber: number
  passesLeft: Record<Side, number>
  outcome: RoundOutcome | null
  round: number
}

export const MAX_RAISES_PER_CHAMBER = 3

export const MODES: Record<ModeId, ModeConfig> = {
  /** The baseline game: you set your own risk and the betting is open. */
  classic: {
    id: 'classic',
    venue: 'saloon',
    chambers: 6,
    loads: [1, 2, 3, 4, 5],
    loadedBy: 'player',
    betting: true,
    anteBase: 20,
    blankAnte: 0,
    passes: 0,
    passToll: 0,
    pacing: 1,
  },
  /**
   * Four chambers, one round, no betting past the ante. Hands end fast and
   * the whole game is the tempo fight over who holds the turn.
   */
  quickdraw: {
    id: 'quickdraw',
    venue: 'saloon',
    chambers: 4,
    loads: [1],
    loadedBy: 'player',
    betting: false,
    anteBase: 45,
    blankAnte: 0,
    passes: 0,
    passToll: 0,
    pacing: 0.62,
  },
  /**
   * At least half the cylinder is live and every chamber survived forces both
   * sides to feed the pot, so the stakes climb as the odds turn lethal.
   */
  widowmaker: {
    id: 'widowmaker',
    venue: 'saloon',
    chambers: 6,
    loads: [3, 4, 5],
    loadedBy: 'player',
    betting: true,
    anteBase: 30,
    blankAnte: 18,
    passes: 0,
    passToll: 0,
    pacing: 0.85,
  },
  /**
   * They load your cylinder, not you. In exchange each side may slide the iron
   * across once a hand without firing, for a price.
   */
  diablo: {
    id: 'diablo',
    venue: 'cantina',
    chambers: 6,
    loads: [2, 3, 4, 5],
    loadedBy: 'dealer',
    betting: true,
    anteBase: 25,
    blankAnte: 0,
    passes: 1,
    passToll: 30,
    pacing: 1,
  },
}

export const MODE_ORDER: ModeId[] = ['classic', 'quickdraw', 'widowmaker', 'diablo']
