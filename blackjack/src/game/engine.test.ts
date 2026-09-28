import { describe, expect, it } from 'vitest'
import {
  buildShoe,
  callCheat,
  callHouseRule,
  canDouble,
  canSplit,
  coolOff,
  cardValue,
  countValue,
  createGame,
  double,
  edge,
  hit,
  isNatural,
  makeTell,
  nextRound,
  penetrationHit,
  playDealer,
  reshuffle,
  score,
  setBet,
  split,
  stand,
  startRound,
  total,
  trueCount,
} from './engine'
import { ROSA, chooseCheat, chooseCold, chooseHouseRule, readDealer, scoreParams } from './ai'
import {
  CARD_LANDS_AT,
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
    g = startRound(g, { cheat: null, tell: makeTell(null, false, rnd) }, rnd)
    const seen = before.slice(0, g.dealt)
    expect(g.running).toBe(seen.reduce((s, c) => s + countValue(c.rank), 0))
  })

  /**
   * The fairness property the whole catch mechanic rests on: when she works the
   * shoe she changes the *order*, never the contents, so a player who counts is
   * never lied to by the arithmetic - only by her hands.
   */
  it('cheating reorders the shoe without changing what is in it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ids = createGame('single', seeded(seed * 31)).shoe.map((c) => c.id).sort((a, b) => a - b)

      const rnd = seeded(seed * 31)
      let g = createGame('single', seeded(seed * 31))
      g = startRound(g, { cheat: 'second', tell: makeTell('second', false, rnd) }, rnd)

      const onFelt = [...g.hands.flatMap((h) => h.cards), ...g.dealerHand.cards]
      const after = [...g.shoe.map((c) => c.id), ...onFelt.map((c) => c.id)].sort((a, b) => a - b)
      expect(after).toEqual(ids)
      expect(g.running).toBe(onFelt.reduce((s, c) => s + countValue(c.rank), 0))
    }
  })

  it('raises the cut card once penetration is reached', () => {
    const g = createGame('single', seeded(3))
    expect(penetrationHit(g)).toBe(false)
    expect(penetrationHit({ ...g, dealt: Math.ceil(g.shoeSize * g.rules.penetration) })).toBe(true)
  })

  it('stacks the front of a cold deck with low cards', () => {
    const g = reshuffle(createGame('casa', seeded(9)), true, seeded(11))
    expect(g.shoe.slice(0, 8).every((c) => cardValue(c.rank) <= 6)).toBe(true)
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

describe('the tell', () => {
  it('puts a real tell before the card lands and a decoy after it', () => {
    const rnd = seeded(13)
    for (let i = 0; i < 300; i++) {
      expect(makeTell('second', false, rnd).at).toBeLessThan(CARD_LANDS_AT)
      expect(makeTell(null, false, rnd).at).toBeGreaterThan(CARD_LANDS_AT)
    }
  })

  it('holds longer when you are leaning in', () => {
    const rnd = seeded(17)
    expect(makeTell('peek', true, rnd).hold).toBeGreaterThan(makeTell('peek', false, rnd).hold)
  })
})

describe('the round', () => {
  it('takes the stake off you and puts four cards out', () => {
    const rnd = seeded(21)
    let g = setBet(createGame('single', rnd), 40)
    g = startRound(g, { cheat: null, tell: makeTell(null, false, rnd) }, rnd)
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

  it('pays a natural at the posted rate, and flat when she has bought the rule', () => {
    const stake = 100
    const mk = (id: RuleId, houseCall: GameState['houseCall']): GameState => ({
      ...createGame(id, seeded(29)),
      houseCall,
      // Eighteen, so she stands and the natural is judged against a live hand.
      dealerHand: held([card('9', 2), card('9', 3)], 0, { done: true }),
      hands: [held([card('A'), card('K', 1)], stake, { done: true })],
      chips: 0,
    })
    expect(playDealer(mk('single', null), { cheat: null }, seeded(1)).chips).toBe(stake + 150)
    expect(playDealer(mk('sixfive', null), { cheat: null }, seeded(1)).chips).toBe(stake + 120)
    expect(playDealer(mk('casa', 'flat_natural'), { cheat: null }, seeded(1)).chips).toBe(stake + 100)
  })

  it('stands or draws on soft seventeen according to the table', () => {
    const spot = (id: RuleId): GameState => ({
      ...createGame(id, seeded(31)),
      dealerHand: held([card('A'), card('6', 1)], 0),
      hands: [held([card('10', 9), card('8', 8)], 10, { done: true })],
    })
    expect(playDealer(spot('single'), { cheat: null }, seeded(2)).dealerHand.cards).toHaveLength(2)
    expect(playDealer(spot('casa'), { cheat: null }, seeded(2)).dealerHand.cards.length).toBeGreaterThan(2)
  })

  it('only offers a double or a split when the rules and the cards allow it', () => {
    const pair: GameState = {
      ...createGame('single', seeded(37)),
      phase: 'player',
      hands: [held([card('8'), card('8', 1)], 20)],
    }
    expect(canSplit(pair)).toBe(true)
    expect(canDouble(pair)).toBe(true)
    expect(canSplit({ ...pair, houseCall: 'no_split' })).toBe(false)
    expect(canDouble({ ...pair, houseCall: 'no_double' })).toBe(false)
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

  it('pays a rule fee straight onto your stack', () => {
    const g = createGame('casa', seeded(101))
    const after = callHouseRule(g, 'no_double', 25)
    expect(after.chips).toBe(g.chips + 25)
    expect(after.houseCall).toBe('no_double')
    expect(canDouble({ ...after, phase: 'player', hands: [held([card('6'), card('5', 1)], 20)] })).toBe(false)
  })
})

describe('calling her out', () => {
  const dealt = (cheat: 'second' | null, seed: number) => {
    const rnd = seeded(seed)
    let g = setBet(createGame('single', rnd), 50)
    g = startRound(g, { cheat, tell: makeTell(cheat, false, rnd) }, rnd)
    return g
  }

  it('hands you the round when there really was a move', () => {
    const g = dealt('second', 47)
    if (g.phase === 'settled') return
    const after = callCheat(g, 400)
    expect(after.settlement!.caught).toBe('second')
    expect(after.chips).toBe(g.chips + 100)
    expect(after.seen.caught).toBe(1)
    expect(after.heat).toBeLessThanOrEqual(g.heat)
  })

  it('costs you the stake when there was nothing there', () => {
    const g = dealt(null, 53)
    if (g.phase === 'settled') return
    const after = callCheat(g, 400)
    expect(after.settlement!.falseCall).toBe(true)
    expect(after.chips).toBe(g.chips)
    expect(after.settlement!.net).toBe(-50)
    expect(after.heat).toBeGreaterThan(g.heat)
    expect(after.seen.missed).toBe(1)
  })

  it('will not count a call that arrives long after the deal', () => {
    const g = dealt('second', 59)
    if (g.phase === 'settled') return
    const late = callCheat(g, 9000)
    expect(late.settlement!.caught).toBeNull()
    expect(late.settlement!.falseCall).toBe(true)
  })

  it('only takes one call per round', () => {
    const g = dealt(null, 61)
    if (g.phase === 'settled') return
    const once = callCheat(g, 300)
    expect(callCheat(once, 300)).toBe(once)
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

  it('reaches for the shoe more when the count has gone against the house', () => {
    const run = (running: number, heat: number) => {
      const r = seeded(Math.round(running * 97 + heat * 131 + 1))
      let hits = 0
      for (let i = 0; i < 600; i++) {
        if (chooseCheat({ ...createGame('casa', seeded(2)), running, heat }, ROSA, r)) hits++
      }
      return hits / 600
    }
    expect(run(30, 0)).toBeGreaterThan(run(-30, 0))
    expect(run(30, 0.9)).toBeLessThan(run(30, 0))
  })

  it('only buys a rule at a table that sells them', () => {
    const rnd = seeded(79)
    for (let i = 0; i < 200; i++) expect(chooseHouseRule(createGame('single', rnd), rnd)).toBeNull()
    let bought = 0
    for (let i = 0; i < 400; i++) if (chooseHouseRule(createGame('casa', rnd), rnd)) bought++
    expect(bought).toBeGreaterThan(0)
  })

  it('never rings in a cold deck at a table whose base rate is zero', () => {
    const rnd = seeded(83)
    const g = { ...createGame('single', rnd), rules: { ...RULES.single, cheatBase: 0 }, running: 0, heat: 0 }
    let cold = 0
    for (let i = 0; i < 300; i++) if (chooseCold(g, ROSA, rnd)) cold++
    expect(cold).toBe(0)
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
    let caughtMoves = 0

    for (let i = 0; i < 120 && g.phase !== 'over'; i++) {
      if (g.phase === 'shuffling') {
        g = reshuffle(g, chooseCold(g, ROSA, rnd), rnd)
        shuffles++
      }
      expect(g.phase).toBe('betting')

      g = setBet(g, g.rules.minBet * (1 + Math.floor(rnd() * 4)))
      const rule = chooseHouseRule(g, rnd)
      if (rule) g = callHouseRule(g, rule.which, rule.fee)

      const bank = g.chips
      const cheat = chooseCheat(g, ROSA, rnd)
      g = startRound(g, { cheat, tell: makeTell(cheat, false, rnd) }, rnd)
      if (cheat) caughtMoves++

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

      if (g.phase === 'dealer') g = playDealer(g, { cheat }, rnd)

      expect(g.phase).toBe('settled')
      expect(g.settlement).not.toBeNull()
      expect(g.settlement!.perHand).toHaveLength(g.hands.length)
      expect(g.chips).toBe(bank + g.settlement!.net)
      expect(g.chips).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(g.chips)).toBe(true)
      expect(g.shoe.length + g.dealt).toBe(g.shoeSize)

      rounds++
      g = nextRound(g, rnd)
    }

    expect(rounds).toBeGreaterThan(20)
    // A single deck has to come round more often than six of them.
    if (id === 'single') expect(shuffles).toBeGreaterThan(3)
    expect(caughtMoves).toBeGreaterThan(0)
  })
})

describe('the room cooling off', () => {
  it('forgets, so a long session is possible', () => {
    const hot = { ...createGame('casa', seeded(107)), heat: 0.8 }
    expect(coolOff(hot, 4).heat).toBeLessThan(hot.heat)
    expect(coolOff(hot, 1000).heat).toBe(0)
    expect(coolOff({ ...hot, heat: 0 }, 10).heat).toBe(0)
  })

  it('throws you out only once the room is fully on to you', () => {
    const rnd = seeded(109)
    const warm = nextRound({ ...createGame('casa', rnd), phase: 'settled', heat: 0.97 }, rnd)
    expect(warm.phase).toBe('betting')
    const done = nextRound({ ...createGame('casa', rnd), phase: 'settled', heat: 1 }, rnd)
    expect(done.phase).toBe('over')
  })

  it('ends the night when the stack cannot cover the minimum', () => {
    const rnd = seeded(113)
    const broke = nextRound({ ...createGame('casa', rnd), phase: 'settled', chips: 5 }, rnd)
    expect(broke.phase).toBe('over')
  })
})

describe('what the felt shows once a round is void', () => {
  it('turns her hole card over even when the call was wrong', () => {
    const rnd = seeded(127)
    let g = setBet(createGame('single', rnd), 20)
    g = startRound(g, { cheat: null, tell: makeTell(null, false, rnd) }, rnd)
    if (g.phase === 'settled') return
    expect(g.holeDown).toBe(true)
    const wrong = callCheat(g, 400)
    expect(wrong.settlement!.falseCall).toBe(true)
    // You paid for those cards, so you get to see what you accused her over.
    expect(wrong.holeDown).toBe(false)
    expect(wrong.hands[0].cards).toHaveLength(2)
    expect(wrong.dealerHand.cards).toHaveLength(2)
  })

  it('turns it over when the call was right, too', () => {
    const rnd = seeded(131)
    let g = setBet(createGame('single', rnd), 20)
    g = startRound(g, { cheat: 'second', tell: makeTell('second', false, rnd) }, rnd)
    if (g.phase === 'settled') return
    const right = callCheat(g, 380)
    expect(right.settlement!.caught).toBe('second')
    expect(right.holeDown).toBe(false)
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

  /*
   * A wrong call kills the round on the spot. She does not then play her hand
   * out, so her total can sit at something she would never have stood on - which
   * is the penalty, not the dealer breaking her own rule.
   */
  it('does not make her play on after a wrong call, however low she is sitting', () => {
    const rnd = seeded(139)
    const g: GameState = {
      ...createGame('casa', rnd),
      phase: 'player',
      hands: [held([card('7'), card('5', 1)], 20)],
      dealerHand: held([card('9', 2), card('5', 3)], 0),
      tell: makeTell(null, false, rnd),
    }
    const wrong = callCheat(g, 400)
    expect(wrong.settlement!.falseCall).toBe(true)
    // Fourteen, untouched: she never drew, because there was no hand left to play.
    expect(total(wrong.dealerHand.cards)).toBe(14)
    expect(wrong.dealerHand.cards).toHaveLength(2)
  })

  it('but does make her draw to seventeen when the hand is played properly', () => {
    const rnd = seeded(149)
    const g: GameState = {
      ...createGame('casa', rnd),
      dealerHand: held([card('9'), card('5', 1)], 0),
      hands: [held([card('K', 2), card('8', 3)], 20, { done: true })],
    }
    const played = playDealer(g, { cheat: null }, rnd)
    expect(total(played.dealerHand.cards)).toBeGreaterThanOrEqual(17)
  })
})
