export type Suit = 'S' | 'H' | 'D' | 'C'

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

export interface Card {
  rank: Rank
  suit: Suit
  /** Stable across a shoe so React keys survive a re-render mid-animation. */
  id: number
}

export type Side = 'player' | 'dealer'

export type RuleId = 'single' | 'casa' | 'sixfive'

/**
 * Everything that differs between the tables. The engine reads this rather than
 * branching on the rule id, so a new variant is a data change.
 */
export interface RuleSet {
  id: RuleId
  decks: number
  /** Dealer draws on soft 17 rather than standing. */
  hitsSoft17: boolean
  /** How many times a hand may be split. 0 disables splitting. */
  resplits: number
  /** Numerator and denominator of the natural's payout, e.g. [3, 2]. */
  naturalPays: [number, number]
  doubleAllowed: boolean
  /** Fraction of the shoe dealt before the cut card comes up. */
  penetration: number
  minBet: number
}

export const RULES: Record<RuleId, RuleSet> = {
  /**
   * One deck, so counting bites immediately. The shortest shoe in the house,
   * dealt to the most honest rules on the floor: she stands on all seventeens
   * and the natural pays properly.
   */
  single: {
    id: 'single',
    decks: 1,
    hitsSoft17: false,
    resplits: 1,
    naturalPays: [3, 2],
    doubleAllowed: true,
    penetration: 0.72,
    minBet: 10,
  },
  /**
   * Six decks and she hits soft seventeen. The busy table: the count moves
   * slowly, the shoe lasts, and the house keeps a little more of it.
   */
  casa: {
    id: 'casa',
    decks: 6,
    hitsSoft17: true,
    resplits: 2,
    naturalPays: [3, 2],
    doubleAllowed: true,
    penetration: 0.68,
    minBet: 15,
  },
  /**
   * The natural pays 6:5 instead of 3:2. Nothing is hidden about it - the
   * sign is on the felt - and it is still the worst table in the room.
   */
  sixfive: {
    id: 'sixfive',
    decks: 6,
    hitsSoft17: true,
    resplits: 1,
    naturalPays: [6, 5],
    doubleAllowed: true,
    penetration: 0.6,
    minBet: 10,
  },
}

export const RULE_ORDER: RuleId[] = ['single', 'casa', 'sixfive']

export type Phase =
  /** Chips on the felt; nothing is dealt yet. */
  | 'betting'
  /** Cards are coming out; input is locked while the deal plays. */
  | 'dealing'
  /** Your move on the active hand. */
  | 'player'
  /** She plays her hand out. */
  | 'dealer'
  /** Hands are settled and the payout is on the felt. */
  | 'settled'
  /** The cut card came up; she is shuffling. */
  | 'shuffling'
  /** Out of chips, or asked to leave. */
  | 'over'

/** When the card touches the felt, in milliseconds into the deal. */
export const CARD_LANDS_AT = 520
export const DEAL_MS = 760

export interface Hand {
  cards: Card[]
  bet: number
  /** Set once the hand can take no more cards. */
  done: boolean
  doubled: boolean
  /** Split hands cannot make a natural, and an ace split takes one card. */
  fromSplit: boolean
  surrendered: boolean
}

export type HandResult = 'win' | 'lose' | 'push' | 'natural' | 'bust'

export interface Settlement {
  perHand: HandResult[]
  /** Chips moved, net of the stake already on the felt. */
  net: number
}

export interface GameState {
  rules: RuleSet
  phase: Phase
  /** Undealt cards, front of the array first. */
  shoe: Card[]
  /** How many cards the shoe held when it was last shuffled. */
  shoeSize: number
  /** Cards dealt since the shuffle, for the penetration check. */
  dealt: number
  /** Hi-Lo running count over the cards that have been seen. */
  running: number
  hands: Hand[]
  active: number
  dealerHand: Hand
  /** Her second card stays face down until she plays. */
  holeDown: boolean
  chips: number
  bet: number
  settlement: Settlement | null
  round: number
}

export const STARTING_CHIPS = 500
