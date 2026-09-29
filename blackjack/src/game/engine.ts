import {
  CARD_LANDS_AT,
  DEAL_MS,
  RULES,
  STARTING_CHIPS,
  type Card,
  type GameState,
  type Hand,
  type HandResult,
  type Rank,
  type RuleId,
  type RuleSet,
  type Suit,
} from './types'

const SUITS: Suit[] = ['S', 'H', 'D', 'C']
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/** Hi-Lo: low cards help the house, tens and aces help you. */
export function countValue(rank: Rank): number {
  if (rank === 'A' || rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return -1
  if (rank === '2' || rank === '3' || rank === '4' || rank === '5' || rank === '6') return 1
  return 0
}

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10
  return Number(rank)
}

export function shuffle<T>(items: T[], rnd: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildShoe(decks: number, rnd: () => number = Math.random): Card[] {
  const cards: Card[] = []
  let id = 0
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit, id: id++ })
  }
  return shuffle(cards, rnd)
}

/**
 * Best total for a hand, plus whether an ace is still counting as eleven.
 * Aces drop to one as needed, so the total returned is always the playable one.
 */
export function score(cards: Card[]): { total: number; soft: boolean } {
  let total = 0
  let aces = 0
  for (const c of cards) {
    total += cardValue(c.rank)
    if (c.rank === 'A') aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export const total = (cards: Card[]) => score(cards).total
export const busted = (cards: Card[]) => total(cards) > 21

/** Two cards to twenty-one, and not out of a split. */
export function isNatural(hand: Hand): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && total(hand.cards) === 21
}

export function decksLeft(state: GameState): number {
  return Math.max(0.25, state.shoe.length / 52)
}

/** Running count divided by the decks still in the shoe. */
export function trueCount(state: GameState): number {
  return state.running / decksLeft(state)
}

/**
 * How far the count has moved in your favour, normalised for display and for
 * the score's `edge` parameter. Deliberately coarse: this is a feeling, not a
 * readout, and the felt shows it as the thickness left in the shoe.
 */
export function edge(state: GameState): number {
  const t = trueCount(state)
  return Math.max(0, Math.min(1, (t + 1) / 6))
}

/**
 * How much of the night is riding on the felt right now, counting the stake
 * against everything you brought to the table. This is what the arrangement
 * and the vignette tighten on: a ten-chip bet off five hundred is a shrug, the
 * same bet with thirty left is the whole evening.
 */
export function pressure(state: GameState): number {
  const staked = state.hands.reduce((s, h) => s + h.bet, 0) || state.bet
  const stack = staked + state.chips
  if (stack <= 0) return 1
  return Math.max(0, Math.min(1, (staked / stack) * 2.2))
}

export function penetrationHit(state: GameState): boolean {
  return state.dealt >= state.shoeSize * state.rules.penetration
}

const hand = (bet: number, fromSplit = false): Hand => ({
  cards: [],
  bet,
  done: false,
  doubled: false,
  fromSplit,
  surrendered: false,
})

export function createGame(ruleId: RuleId = 'single', rnd: () => number = Math.random): GameState {
  const rules = RULES[ruleId]
  const shoe = buildShoe(rules.decks, rnd)
  return {
    rules,
    phase: 'betting',
    shoe,
    shoeSize: shoe.length,
    dealt: 0,
    running: 0,
    hands: [],
    active: 0,
    dealerHand: hand(0),
    holeDown: true,
    chips: STARTING_CHIPS,
    bet: rules.minBet,
    settlement: null,
    round: 1,
  }
}

/** Takes the front card and folds it into the running count. */
function draw(state: GameState): Card {
  const card = state.shoe[0]
  state.shoe = state.shoe.slice(1)
  state.dealt += 1
  state.running += countValue(card.rank)
  return card
}

/** Puts the stake on the felt and deals the round out. */
export function startRound(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  const stake = Math.max(next.rules.minBet, Math.min(next.bet, next.chips))

  next.chips -= stake
  next.hands = [hand(stake)]
  next.active = 0
  next.dealerHand = hand(0)
  next.holeDown = true
  next.settlement = null
  next.bet = stake

  // Two to you, two to her, her second one face down.
  next.hands[0].cards.push(draw(next))
  next.dealerHand.cards.push(draw(next))
  next.hands[0].cards.push(draw(next))
  next.dealerHand.cards.push(draw(next))

  next.phase = 'player'
  if (isNatural(next.hands[0]) || total(next.dealerHand.cards) === 21) {
    return settle(next, rnd)
  }
  return next
}

export function canDouble(state: GameState): boolean {
  const h = state.hands[state.active]
  if (!h || h.done) return false
  if (!state.rules.doubleAllowed) return false
  return h.cards.length === 2 && state.chips >= h.bet
}

export function canSplit(state: GameState): boolean {
  const h = state.hands[state.active]
  if (!h || h.done) return false
  if (state.hands.length > state.rules.resplits) return false
  if (h.cards.length !== 2) return false
  if (cardValue(h.cards[0].rank) !== cardValue(h.cards[1].rank)) return false
  return state.chips >= h.bet
}

export function hit(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.hands = next.hands.map((h, i) => (i === next.active ? { ...h, cards: [...h.cards] } : h))
  const h = next.hands[next.active]
  h.cards.push(draw(next))
  if (busted(h.cards) || total(h.cards) === 21) h.done = true
  return advance(next, rnd)
}

export function stand(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.hands = next.hands.map((h, i) => (i === next.active ? { ...h, done: true } : h))
  return advance(next, rnd)
}

export function double(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.hands = next.hands.map((h, i) => (i === next.active ? { ...h, cards: [...h.cards] } : h))
  const h = next.hands[next.active]
  next.chips -= h.bet
  h.bet *= 2
  h.doubled = true
  h.cards.push(draw(next))
  h.done = true
  return advance(next, rnd)
}

export function split(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  const src = next.hands[next.active]
  next.chips -= src.bet

  const left: Hand = { ...src, cards: [src.cards[0]], fromSplit: true }
  const right: Hand = { ...hand(src.bet, true), cards: [src.cards[1]] }
  left.cards.push(draw(next))
  right.cards.push(draw(next))

  // Split aces take one card each and that is the hand.
  if (src.cards[0].rank === 'A') {
    left.done = true
    right.done = true
  }
  if (total(left.cards) === 21) left.done = true
  if (total(right.cards) === 21) right.done = true

  next.hands = [...next.hands.slice(0, next.active), left, right, ...next.hands.slice(next.active + 1)]
  return advance(next, rnd)
}

/** Moves to the next unfinished hand, or hands over to her. */
function advance(state: GameState, rnd: () => number): GameState {
  const nextIdx = state.hands.findIndex((h, i) => i >= state.active && !h.done)
  if (nextIdx >= 0) {
    state.active = nextIdx
    state.phase = 'player'
    return state
  }
  const live = state.hands.some((h) => !busted(h.cards) && !h.surrendered)
  if (!live) return settle(state, rnd)
  state.phase = 'dealer'
  return state
}

/** She turns her hole card and draws to the house rule. */
export function playDealer(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.holeDown = false
  next.dealerHand = { ...next.dealerHand, cards: [...next.dealerHand.cards] }

  for (let guard = 0; guard < 12; guard++) {
    const { total: t, soft } = score(next.dealerHand.cards)
    if (t > 21) break
    if (t > 17) break
    if (t === 17 && !(soft && next.rules.hitsSoft17)) break
    next.dealerHand.cards.push(draw(next))
  }
  return settle(next, rnd)
}

function payout(h: Hand, result: HandResult, rules: RuleSet): number {
  switch (result) {
    case 'natural': {
      const [n, d] = rules.naturalPays
      return h.bet + Math.round((h.bet * n) / d)
    }
    case 'win':
      return h.bet * 2
    case 'push':
      return h.bet
    default:
      return 0
  }
}

function judge(player: Hand, dealer: Hand): HandResult {
  if (busted(player.cards)) return 'bust'
  const p = total(player.cards)
  const d = total(dealer.cards)
  const pNat = isNatural(player)
  const dNat = dealer.cards.length === 2 && d === 21

  if (pNat && dNat) return 'push'
  if (pNat) return 'natural'
  if (dNat) return 'lose'
  if (busted(dealer.cards)) return 'win'
  if (p > d) return 'win'
  if (p < d) return 'lose'
  return 'push'
}

/** Closes the round out and moves the chips. */
export function settle(state: GameState, _rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.holeDown = false

  const perHand: HandResult[] = []
  let returned = 0
  const staked = next.hands.reduce((s, h) => s + h.bet, 0)

  for (const h of next.hands) {
    const r = judge(h, next.dealerHand)
    perHand.push(r)
    returned += payout(h, r, next.rules)
  }

  next.chips += returned
  next.settlement = { perHand, net: returned - staked }
  next.phase = 'settled'
  return next
}

/** Starts the next round, shuffling first if the cut card came up. */
export function nextRound(state: GameState, _rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  if (next.chips < next.rules.minBet) {
    next.phase = 'over'
    return next
  }
  next.round += 1
  next.hands = []
  next.dealerHand = hand(0)
  next.settlement = null
  next.phase = penetrationHit(next) ? 'shuffling' : 'betting'
  return next
}

/** A fresh shoe, riffled out where you can see it. */
export function reshuffle(state: GameState, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.shoe = buildShoe(next.rules.decks, rnd)
  next.shoeSize = next.shoe.length
  next.dealt = 0
  next.running = 0
  next.phase = 'betting'
  return next
}

export function setBet(state: GameState, amount: number): GameState {
  const capped = Math.max(state.rules.minBet, Math.min(amount, state.chips))
  return { ...state, bet: capped }
}

export { CARD_LANDS_AT, DEAL_MS }
