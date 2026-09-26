export type Side = 'player' | 'dealer'

export type Target = 'self' | 'opponent'

/** A chamber is either loaded with a live round or an empty casing. */
export type Chamber = 'live' | 'blank'

export type Phase =
  /** Between rounds: the player picks how many live rounds go in the cylinder. */
  | 'loading'
  /** Cylinder is spun and sealed; the active side may bet then fire. */
  | 'betting'
  /** A raise is on the table and the other side must call or fold. */
  | 'facing_raise'
  /** A shot is being played out cinematically; input is locked. */
  | 'resolving'
  /** Round is over, waiting for acknowledgement. */
  | 'round_over'
  /** One side is out of chips. */
  | 'match_over'

export interface RoundOutcome {
  winner: Side
  /** 'shot' means someone took a live round; 'fold' means someone conceded. */
  reason: 'shot' | 'fold'
  pot: number
}

export interface GameState {
  phase: Phase
  /** Remaining chambers in firing order. Index 0 is next under the hammer. */
  cylinder: Chamber[]
  /** Total live rounds loaded at the start of the round, for display. */
  loadedLive: number
  loadedTotal: number
  /** How many chambers have already been fired this round. */
  fired: number
  turn: Side
  chips: Record<Side, number>
  pot: number
  ante: number
  /** Chips the side facing a raise must match to stay in the round. */
  toCall: number
  /** Side that made the outstanding raise, if any. */
  raiser: Side | null
  /** Raises already made this chamber, used to cap escalation. */
  raisesThisChamber: number
  outcome: RoundOutcome | null
  round: number
  log: string[]
}

export const CYLINDER_SIZE = 6
export const MAX_RAISES_PER_CHAMBER = 3
