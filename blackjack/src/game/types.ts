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
  /** She may rewrite one rule for a round, paying the table for the privilege. */
  houseMayRule: boolean
  /** Fraction of the shoe dealt before the cut card comes up. */
  penetration: number
  /** How often she reaches for a move, before her nerve is taken into account. */
  cheatBase: number
  minBet: number
}

export const RULES: Record<RuleId, RuleSet> = {
  /**
   * One deck, so counting bites immediately and she knows it. The shortest
   * shoe in the house and the one she has to work hardest to control.
   */
  single: {
    id: 'single',
    decks: 1,
    hitsSoft17: false,
    resplits: 1,
    naturalPays: [3, 2],
    doubleAllowed: true,
    houseMayRule: false,
    penetration: 0.72,
    cheatBase: 0.3,
    minBet: 10,
  },
  /**
   * Six decks and she may rewrite a rule whenever she likes, as long as she
   * pays the table for it. The house talks; you decide whether to keep sitting.
   */
  casa: {
    id: 'casa',
    decks: 6,
    hitsSoft17: true,
    resplits: 2,
    naturalPays: [3, 2],
    doubleAllowed: true,
    houseMayRule: true,
    penetration: 0.68,
    cheatBase: 0.24,
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
    houseMayRule: false,
    penetration: 0.6,
    cheatBase: 0.18,
    minBet: 10,
  },
}

export const RULE_ORDER: RuleId[] = ['single', 'casa', 'sixfive']

/** A rule she can suspend for one round at a price. */
export type HouseCall = 'no_double' | 'flat_natural' | 'no_split'

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

export type CheatKind =
  /** Slides the second card out while the top one stays put. */
  | 'second'
  /** Lifts a corner of the hole card she is not supposed to know. */
  | 'peek'
  /** Rings in a stacked packet during the shuffle. */
  | 'cold'

/**
 * One deal's worth of hand movement. Exactly one of these is live per deal,
 * and the tell is honest: if `cheat` is set, the flicker really is there.
 *
 * The learnable rule is *when*: a real tell happens while the card is still in
 * her hand, a decoy only ever happens after it has landed. That is a
 * perceptual skill rather than a dice roll, and nothing about it is hidden.
 */
export interface Tell {
  /** Milliseconds from the start of the deal to the flicker. */
  at: number
  /** How long the flicker is visible. Leaning in lengthens it. */
  hold: number
  /** Set when this deal actually carries a move. */
  cheat: CheatKind | null
}

/** When the card touches the felt, in milliseconds into the deal. */
export const CARD_LANDS_AT = 520
export const DEAL_MS = 760
/** How long after a deal a call still counts as being about that deal. */
export const CALL_GRACE = 420

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
  /** Set when the round ended because you called her out. */
  caught: CheatKind | null
  /** Set when you called and there was nothing there. */
  falseCall: boolean
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
  /** 0 to 1. She stops dealing to you at the top. */
  heat: number
  /** Her rule for this round, if she bought one. */
  houseCall: HouseCall | null
  /** What she paid the table for it, shown so the price is never hidden. */
  houseFee: number
  tell: Tell | null
  /** Set for the round while a call is still unresolved. */
  called: boolean
  settlement: Settlement | null
  round: number
  /** Running tally shown in the HUD, the way the first game counts bluffs. */
  seen: { calls: number; caught: number; missed: number }
}

export const STARTING_CHIPS = 500
export const HEAT_OUT = 1
