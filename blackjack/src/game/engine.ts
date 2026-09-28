import {
  CARD_LANDS_AT,
  DEAL_MS,
  HEAT_OUT,
  RULES,
  STARTING_CHIPS,
  type Card,
  type CheatKind,
  type GameState,
  type Hand,
  type HandResult,
  type HouseCall,
  type Rank,
  type RuleId,
  type RuleSet,
  type Suit,
  type Tell,
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
    heat: 0,
    houseCall: null,
    houseFee: 0,
    tell: null,
    called: false,
    settlement: null,
    round: 1,
    seen: { calls: 0, caught: 0, missed: 0 },
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

/**
 * Her move on the shoe: instead of the top card the next one out is chosen from
 * a little deeper, so she can hand you something worse or keep something better.
 * The card still leaves the shoe, so the count a player keeps stays honest -
 * cheating changes the order, never the contents.
 */
function drawCrooked(state: GameState, want: 'low' | 'high'): Card {
  const reach = Math.min(4, state.shoe.length)
  let pick = 0
  let best = -Infinity
  for (let i = 0; i < reach; i++) {
    const v = cardValue(state.shoe[i].rank)
    const s = want === 'low' ? -v : v
    if (s > best) {
      best = s
      pick = i
    }
  }
  const card = state.shoe[pick]
  state.shoe = [...state.shoe.slice(0, pick), ...state.shoe.slice(pick + 1)]
  state.dealt += 1
  state.running += countValue(card.rank)
  return card
}

/**
 * Where the flicker sits in the deal. A real tell lands while the card is still
 * in her hand; a decoy only ever happens after it has touched the felt. That
 * gap is the whole skill, so it is generated here rather than in the view.
 */
export function makeTell(cheat: CheatKind | null, leaning: boolean, rnd: () => number = Math.random): Tell {
  const hold = leaning ? 190 : 110
  if (cheat) return { at: 300 + Math.floor(rnd() * 150), hold, cheat }
  return { at: CARD_LANDS_AT + 80 + Math.floor(rnd() * 160), hold, cheat: null }
}

export interface DealPlan {
  /** Set when she is working this round. */
  cheat: CheatKind | null
  /** Shown whether or not she is working, so the flicker itself gives nothing away. */
  tell: Tell
}

/** Puts the stake on the felt and deals the round out. */
export function startRound(state: GameState, plan: DealPlan, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  const stake = Math.max(next.rules.minBet, Math.min(next.bet, next.chips))

  next.chips -= stake
  next.hands = [hand(stake)]
  next.active = 0
  next.dealerHand = hand(0)
  next.holeDown = true
  next.settlement = null
  next.called = false
  next.tell = plan.tell
  next.bet = stake

  // Two to you, two to her, hers second one face down. When she is dealing
  // seconds she keeps the better card and hands the worse one across.
  next.hands[0].cards.push(plan.cheat === 'second' ? drawCrooked(next, 'low') : draw(next))
  next.dealerHand.cards.push(draw(next))
  next.hands[0].cards.push(draw(next))
  next.dealerHand.cards.push(plan.cheat === 'second' ? drawCrooked(next, 'high') : draw(next))

  next.phase = 'player'
  if (isNatural(next.hands[0]) || total(next.dealerHand.cards) === 21) {
    return settle(next, null, rnd)
  }
  return next
}

/** Buys a rule for the round and pays the table for it. */
export function callHouseRule(state: GameState, which: HouseCall, fee: number): GameState {
  const next: GameState = { ...state }
  next.houseCall = which
  next.houseFee = fee
  next.chips += fee
  return next
}

export function canDouble(state: GameState): boolean {
  const h = state.hands[state.active]
  if (!h || h.done) return false
  if (!state.rules.doubleAllowed || state.houseCall === 'no_double') return false
  return h.cards.length === 2 && state.chips >= h.bet
}

export function canSplit(state: GameState): boolean {
  const h = state.hands[state.active]
  if (!h || h.done) return false
  if (state.houseCall === 'no_split') return false
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
  if (!live) return settle(state, null, rnd)
  state.phase = 'dealer'
  return state
}

/** She turns her hole card and draws to the house rule. */
export function playDealer(state: GameState, plan: { cheat: CheatKind | null }, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.holeDown = false
  next.dealerHand = { ...next.dealerHand, cards: [...next.dealerHand.cards] }

  for (let guard = 0; guard < 12; guard++) {
    const { total: t, soft } = score(next.dealerHand.cards)
    if (t > 21) break
    if (t > 17) break
    if (t === 17 && !(soft && next.rules.hitsSoft17)) break
    // Having peeked, she knows what she needs and reaches for it.
    next.dealerHand.cards.push(plan.cheat === 'peek' ? drawCrooked(next, 'high') : draw(next))
  }
  return settle(next, null, rnd)
}

function payout(h: Hand, result: HandResult, rules: RuleSet, houseCall: HouseCall | null): number {
  switch (result) {
    case 'natural': {
      const [n, d] = houseCall === 'flat_natural' ? [1, 1] : rules.naturalPays
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

/**
 * Closes the round out. A caught cheat hands you every hand on the felt
 * regardless of the cards, because the round is void and she is the one who
 * voided it.
 */
export function settle(state: GameState, caught: CheatKind | null, _rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  next.holeDown = false

  const perHand: HandResult[] = []
  let returned = 0
  const staked = next.hands.reduce((s, h) => s + h.bet, 0)

  if (caught) {
    for (const h of next.hands) {
      perHand.push('win')
      returned += h.bet * 2
    }
  } else {
    for (const h of next.hands) {
      const r = judge(h, next.dealerHand)
      perHand.push(r)
      returned += payout(h, r, next.rules, next.houseCall)
    }
  }

  next.chips += returned
  next.settlement = { perHand, net: returned - staked, caught, falseCall: false }
  next.phase = 'settled'
  return next
}

/**
 * You say it out loud. Right, and the round is yours and the room cools off a
 * little; wrong, and it costs you the stake and she has your measure.
 */
export function callCheat(state: GameState, sinceDeal: number): GameState {
  if (state.called) return state
  const next: GameState = { ...state }
  next.called = true
  next.seen = { ...next.seen, calls: next.seen.calls + 1 }

  const live = next.tell?.cheat ?? null
  const inTime = sinceDeal <= DEAL_MS + 420

  if (live && inTime) {
    next.seen = { ...next.seen, caught: next.seen.caught + 1 }
    next.heat = Math.max(0, next.heat - 0.2)
    const settled = settle(next, live)
    settled.settlement = { ...settled.settlement!, caught: live }
    return settled
  }

  // Nothing there. The stake goes, the room notices, and the cards are dead.
  //
  // Her hole card still turns over. The hand is void either way, and leaving it
  // face down reads as a bug rather than as a penalty - you paid for those cards,
  // so you get to see what you accused her over.
  next.seen = { ...next.seen, missed: next.seen.missed + 1 }
  next.heat = Math.min(1, next.heat + 0.17)
  next.holeDown = false
  const staked = next.hands.reduce((s, h) => s + h.bet, 0)
  next.settlement = { perHand: next.hands.map(() => 'lose' as HandResult), net: -staked, caught: null, falseCall: true }
  next.phase = 'settled'
  return next
}

/** Leaning in to watch her hands is not free; she can tell. */
export function addHeat(state: GameState, amount: number): GameState {
  return { ...state, heat: Math.max(0, Math.min(1, state.heat + amount)) }
}

/**
 * The room forgets. Sitting quietly cools the table back down, which is what
 * makes leaning a decision with a price rather than a budget you spend once and
 * then have to leave. Without this a handful of wrong calls ends the night.
 */
export function coolOff(state: GameState, seconds: number): GameState {
  if (state.heat <= 0) return state
  return { ...state, heat: Math.max(0, state.heat - seconds * 0.022) }
}

/** Starts the next round, shuffling first if the cut card came up. */
export function nextRound(state: GameState, _rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  if (next.chips < next.rules.minBet) {
    next.phase = 'over'
    return next
  }
  if (next.heat >= HEAT_OUT) {
    next.phase = 'over'
    return next
  }
  next.round += 1
  next.hands = []
  next.dealerHand = hand(0)
  next.settlement = null
  next.tell = null
  next.called = false
  next.houseCall = null
  next.houseFee = 0
  next.phase = penetrationHit(next) ? 'shuffling' : 'betting'
  return next
}

/**
 * A fresh shoe. When she rings in a cold deck the top of it is stacked in her
 * favour, which is why a shuffle is worth watching as closely as a deal.
 */
export function reshuffle(state: GameState, cold: boolean, rnd: () => number = Math.random): GameState {
  const next: GameState = { ...state }
  const fresh = buildShoe(next.rules.decks, rnd)
  if (cold) {
    // Low cards to the front: your doubles miss and her stiffs get made.
    const low = fresh.filter((c) => cardValue(c.rank) <= 6)
    const rest = fresh.filter((c) => cardValue(c.rank) > 6)
    next.shoe = [...low.slice(0, 8), ...shuffle([...low.slice(8), ...rest], rnd)]
  } else {
    next.shoe = fresh
  }
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
