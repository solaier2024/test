import { describe, expect, it } from 'vitest'
import {
  buildShoe,
  canDouble,
  canSplit,
  cardValue,
  countValue,
  createGame,
  double,
  edge,
  hit,
  isNatural,
  nextRound,
  penetrationHit,
  playDealer,
  pressure,
  reshuffle,
  score,
  setBet,
  split,
  stand,
  startRound,
  total,
  trueCount,
} from './engine'
import { ROSA, reactionTo, readDealer, scoreParams } from './ai'
import {
  RULES,
  RULE_ORDER,
  STARTING_CHIPS,
  type Card,
  type GameState,
  type Hand,
  type Rank,
  type RuleId,
} from './types'

/** Deterministic generator so a failure is always reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const card = (rank: Rank, id = 0): Card => ({ rank, suit: 'S', id })

const held = (cards: Card[], bet = 10, extra: Partial<Hand> = {}): Hand => ({
  cards,
  bet,
  done: false,
  doubled: false,
  fromSplit: false,
  surrendered: false,
  ...extra,
})

describe('card arithmetic', () => {
  it('values faces at ten and the ace at eleven', () => {
    expect(cardValue('K')).toBe(10)
    expect(cardValue('10')).toBe(10)
    expect(cardValue('A')).toBe(11)
    expect(cardValue('7')).toBe(7)
  })

  it('counts Hi-Lo so low cards help the house', () => {
    expect(countValue('2')).toBe(1)
    expect(countValue('6')).toBe(1)
    expect(countValue('7')).toBe(0)
    expect(countValue('9')).toBe(0)
    expect(countValue('10')).toBe(-1)
    expect(countValue('A')).toBe(-1)
  })

  it('sums a whole deck to zero', () => {
    const shoe = buildShoe(1, seeded(1))
    expect(shoe.reduce((s, c) => s + countValue(c.rank), 0)).toBe(0)
  })

  it('drops aces to one only as far as it has to', () => {
    expect(score([card('A'), card('9', 1)])).toEqual({ total: 20, soft: true })
    expect(score([card('A'), card('9', 1), card('5', 2)])).toEqual({ total: 15, soft: false })
    expect(score([card('A'), card('A', 1)])).toEqual({ total: 12, soft: true })
    expect(score([card('A'), card('A', 1), card('9', 2)])).toEqual({ total: 21, soft: true })
    expect(total([card('K'), card('Q', 1), card('J', 2)])).toBe(30)
  })

  it('calls two cards to twenty-one a natural, but not out of a split', () => {
    expect(isNatural(held([card('A'), card('K', 1)]))).toBe(true)
    expect(isNatural(held([card('A'), card('K', 1)], 10, { fromSplit: true }))).toBe(false)
    expect(isNatural(held([card('7'), card('7', 1), card('7', 2)]))).toBe(false)
  })
})

describe('the shoe', () => {
  it('builds the right number of cards with no duplicate ids', () => {
    for (const decks of [1, 2, 6]) {
      const shoe = buildShoe(decks, seeded(decks))
      expect(shoe).toHaveLength(52 * decks)
      expect(new Set(shoe.map((c) => c.id)).size).toBe(52 * decks)
    }
  })

  it('keeps the running count equal to what has actually been seen', () => {
    const rnd = seeded(7)
    let g = createGame('single', rnd)
    const before = g.shoe.slice()
    g = startRound(g, rnd)
    const seen = before.slice(0, g.dealt)
    expect(g.running).toBe(seen.reduce((s, c) => s + countValue(c.rank), 0))
  })

  /**
   * Nothing is held back and nothing is added: every card that leaves the shoe
   * is on the felt, which is what makes counting worth doing at all.
   */
  it('deals off the front of the shoe and accounts for every card', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const before = createGame('single', seeded(seed * 31)).shoe
      const g = startRound(createGame('single', seeded(seed * 31)), seeded(seed * 31))
      const onFelt = [...g.hands.flatMap((h) => h.cards), ...g.dealerHand.cards]
      // One to you, one to her, twice over, straight off the front.
      expect(g.hands[0].cards.map((c) => c.id)).toEqual([before[0].id, before[2].id])
      expect(g.dealerHand.cards.map((c) => c.id)).toEqual([before[1].id, before[3].id])
      expect(g.running).toBe(onFelt.reduce((s, c) => s + countValue(c.rank), 0))
    }
  })

  it('raises the cut card once penetration is reached', () => {
    const g = createGame('single', seeded(3))
    expect(penetrationHit(g)).toBe(false)
    expect(penetrationHit({ ...g, dealt: Math.ceil(g.shoeSize * g.rules.penetration) })).toBe(true)
  })

  it('comes back full and uncounted after a shuffle', () => {
    const g = reshuffle({ ...createGame('casa', seeded(9)), running: 9, dealt: 200 }, seeded(11))
    expect(g.shoe).toHaveLength(52 * RULES.casa.decks)
    expect(g.running).toBe(0)
    expect(g.dealt).toBe(0)
  })

  it('reports a true count scaled by the decks still to come', () => {
    const g = { ...createGame('casa', seeded(5)), running: 12 }
    expect(trueCount(g)).toBeCloseTo(12 / (g.shoe.length / 52), 5)
    expect(edge(g)).toBeGreaterThan(edge({ ...g, running: -6 }))
    expect(edge({ ...g, running: -40 })).toBe(0)
    expect(edge({ ...g, running: 400 })).toBe(1)
  })
})

describe('the round', () => {
  it('takes the stake off you and puts four cards out', () => {
    const rnd = seeded(21)
    let g = setBet(createGame('single', rnd), 40)
    g = startRound(g, rnd)
    expect(g.chips).toBe(STARTING_CHIPS - 40)
    expect(g.hands[0].cards).toHaveLength(2)
    expect(g.dealerHand.cards).toHaveLength(2)
    expect(g.dealt).toBe(4)
  })

  it('never lets a bet go under the table minimum or over the stack', () => {
    const g = createGame('casa', seeded(23))
    expect(setBet(g, 1).bet).toBe(g.rules.minBet)
    expect(setBet(g, 99999).bet).toBe(g.chips)
  })

  it('pays a natural at the rate posted on the felt', () => {
    const stake = 100
    const mk = (id: RuleId): GameState => ({
      ...createGame(id, seeded(29)),
      // Eighteen, so she stands and the natural is judged against a live hand.
      dealerHand: held([card('9', 2), card('9', 3)], 0, { done: true }),
      hands: [held([card('A'), card('K', 1)], stake, { done: true })],
      chips: 0,
    })
    expect(playDealer(mk('single'), seeded(1)).chips).toBe(stake + 150)
    expect(playDealer(mk('sixfive'), seeded(1)).chips).toBe(stake + 120)
  })

  it('stands or draws on soft seventeen according to the table', () => {
    const spot = (id: RuleId): GameState => ({
      ...createGame(id, seeded(31)),
      dealerHand: held([card('A'), card('6', 1)], 0),
      hands: [held([card('10', 9), card('8', 8)], 10, { done: true })],
    })
    expect(playDealer(spot('single'), seeded(2)).dealerHand.cards).toHaveLength(2)
    expect(playDealer(spot('casa'), seeded(2)).dealerHand.cards.length).toBeGreaterThan(2)
  })

  it('only offers a double or a split when the rules and the cards allow it', () => {
    const pair: GameState = {
      ...createGame('single', seeded(37)),
      phase: 'player',
      hands: [held([card('8'), card('8', 1)], 20)],
    }
    expect(canSplit(pair)).toBe(true)
    expect(canDouble(pair)).toBe(true)
    expect(canDouble({ ...pair, chips: 0 })).toBe(false)

    const three = { ...pair, hands: [held([card('8'), card('8', 1), card('2', 2)], 20)] }
    expect(canSplit(three)).toBe(false)
    expect(canDouble(three)).toBe(false)
  })

  it('gives split aces exactly one card each and hands over', () => {
    const rnd = seeded(41)
    const after = split(
      { ...createGame('single', rnd), phase: 'player', hands: [held([card('A'), card('A', 1)], 20)] },
      rnd,
    )
    expect(after.hands).toHaveLength(2)
    expect(after.hands.every((h) => h.cards.length === 2 && h.done)).toBe(true)
    expect(after.phase).not.toBe('player')
  })

  it('doubles the stake, takes one card and closes the hand', () => {
    const rnd = seeded(43)
    const g: GameState = {
      ...createGame('single', rnd),
      phase: 'player',
      hands: [held([card('6'), card('5', 1)], 20)],
    }
    const before = g.chips
    const after = double(g, rnd)
    expect(after.chips).toBe(before - 20)
    expect(after.hands[0].bet).toBe(40)
    expect(after.hands[0].cards).toHaveLength(3)
    expect(after.hands[0].done).toBe(true)
  })

  it('settles a bust without making her play her hand out', () => {
    const rnd = seeded(97)
    const g: GameState = {
      ...createGame('single', rnd),
      phase: 'player',
      hands: [held([card('K'), card('9', 1)], 20)],
      dealerHand: held([card('5', 2), card('6', 3)], 0),
      chips: 0,
    }
    const after = hit(g, rnd)
    expect(after.phase).toBe('settled')
    expect(after.settlement!.perHand).toEqual(['bust'])
    expect(after.chips).toBe(0)
    expect(after.holeDown).toBe(false)
  })

  it('measures the pressure on a hand against the whole stack, not the chip', () => {
    const g = createGame('single', seeded(151))
    const thin = pressure({ ...g, chips: 490, hands: [held([], 10)] })
    const everything = pressure({ ...g, chips: 0, hands: [held([], 30)] })
    expect(thin).toBeLessThan(0.1)
    expect(everything).toBe(1)
    expect(pressure({ ...g, chips: 0, hands: [] })).toBe(1)
  })
})

describe('the dealer', () => {
  const spot = (rnd: () => number): GameState => ({
    ...createGame('casa', rnd),
    hands: [held([card('7'), card('6', 1)], 10)],
    dealerHand: held([card('K', 2)], 0),
  })

  it('shows a mood that is sometimes not the one she holds', () => {
    const rnd = seeded(67)
    let bluffs = 0
    for (let i = 0; i < 400; i++) {
      const read = readDealer(spot(rnd), ROSA, rnd)
      if (read.bluffing) bluffs++
      else expect(read.shown).toBe(read.truth)
    }
    expect(bluffs / 400).toBeGreaterThan(0.25)
    expect(bluffs / 400).toBeLessThan(0.52)
  })

  it('binds the score to what she shows, never to what she holds', () => {
    const g = spot(seeded(71))
    const warm = scoreParams(g, { truth: 'sharp', shown: 'warm', bluffing: true })
    const sharp = scoreParams(g, { truth: 'warm', shown: 'sharp', bluffing: true })
    expect(warm.warmth).toBeGreaterThan(sharp.warmth)
    // Swapping only the truth leaves the music exactly where it was.
    expect(scoreParams(g, { truth: 'cool', shown: 'warm', bluffing: true }).warmth).toBe(warm.warmth)
  })

  it('names the hand she has to name and takes the rest with two faces', () => {
    expect(reactionTo(150, ['natural'])).toBe('natural')
    expect(reactionTo(20, ['win'])).toBe('warm')
    expect(reactionTo(-20, ['lose'])).toBe('sharp')
    expect(reactionTo(0, ['push'])).toBe('cool')
  })
})

/**
 * The long run. Plays each table out with a plain basic-strategy bot and asserts
 * what must hold no matter what the cards do: chips are conserved to the penny,
 * every round terminates, and there is always a legal move.
 *
 * Conservation is exact because every chip that leaves the stack lands on the
 * felt: the stake, each split and each double all move the same amount both
 * ways, so `chips` after a settled round is `chips before + settlement.net`.
 */
describe.each(RULE_ORDER)('a hundred and twenty rounds at %s', (id) => {
  it('conserves chips, always terminates and always has a move', () => {
    const rnd = seeded(1009 + RULE_ORDER.indexOf(id) * 17)
    let g = createGame(id, rnd)
    let rounds = 0
    let shuffles = 0

    for (let i = 0; i < 120 && g.phase !== 'over'; i++) {
      if (g.phase === 'shuffling') {
        g = reshuffle(g, rnd)
        shuffles++
      }
      expect(g.phase).toBe('betting')

      g = setBet(g, g.rules.minBet * (1 + Math.floor(rnd() * 4)))

      const bank = g.chips
      g = startRound(g, rnd)

      let guard = 0
      while (g.phase === 'player') {
        expect(guard++).toBeLessThan(40)
        const h = g.hands[g.active]
        const { total: t, soft } = score(h.cards)
        if (canSplit(g) && (h.cards[0].rank === 'A' || h.cards[0].rank === '8')) g = split(g, rnd)
        else if (canDouble(g) && t === 11) g = double(g, rnd)
        else if (t < 17 || (soft && t < 18)) g = hit(g, rnd)
        else g = stand(g, rnd)
      }

      if (g.phase === 'dealer') g = playDealer(g, rnd)

      expect(g.phase).toBe('settled')
      expect(g.settlement).not.toBeNull()
      expect(g.settlement!.perHand).toHaveLength(g.hands.length)
      expect(g.chips).toBe(bank + g.settlement!.net)
      expect(g.chips).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(g.chips)).toBe(true)
      expect(g.shoe.length + g.dealt).toBe(g.shoeSize)
      expect(pressure(g)).toBeGreaterThanOrEqual(0)
      expect(pressure(g)).toBeLessThanOrEqual(1)

      rounds++
      g = nextRound(g, rnd)
    }

    expect(rounds).toBeGreaterThan(20)
    // A single deck has to come round more often than six of them.
    if (id === 'single') expect(shuffles).toBeGreaterThan(3)
  })
})

describe('the end of the night', () => {
  it('ends the night when the stack cannot cover the minimum', () => {
    const rnd = seeded(113)
    const broke = nextRound({ ...createGame('casa', rnd), phase: 'settled', chips: 5 }, rnd)
    expect(broke.phase).toBe('over')
  })
})

/*
 * Two things a reviewer watching the recording read as bugs. Both are correct,
 * and both are now asserted rather than argued about.
 */
describe('what the felt is actually saying', () => {
  it('reads a ten and an ace as twenty-one, not eleven', () => {
    expect(score([card('K'), card('A', 1)])).toEqual({ total: 21, soft: true })
    expect(score([card('A'), card('10', 1)])).toEqual({ total: 21, soft: true })
    expect(isNatural(held([card('K'), card('A', 1)]))).toBe(true)
  })

  /*
   * With her hole card down the table shows her UPCARD total, not her hand. An
   * ace showing therefore reads 11, which looks like a scoring bug and is not:
   * the second card is face down and has not been counted.
   */
  it('shows only her upcard while the hole card is face down', () => {
    const g: GameState = {
      ...createGame('casa', seeded(137)),
      dealerHand: held([card('A'), card('K', 1)], 0),
      holeDown: true,
    }
    expect(total(g.dealerHand.cards.slice(0, 1))).toBe(11)
    expect(total(g.dealerHand.cards)).toBe(21)
  })

  it('makes her draw to seventeen', () => {
    const rnd = seeded(149)
    const g: GameState = {
      ...createGame('casa', rnd),
      dealerHand: held([card('9'), card('5', 1)], 0),
      hands: [held([card('K', 2), card('8', 3)], 20, { done: true })],
    }
    const played = playDealer(g, rnd)
    expect(total(played.dealerHand.cards)).toBeGreaterThanOrEqual(17)
  })
})
