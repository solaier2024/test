import { describe, expect, it } from 'vitest'
import { honestRange, honestReturn } from '../game/exact.ts'
import {
  BRIBES_PER_SESSION,
  BRIBE_TAKES,
  HEAT_CALL_WRONG,
  MAX_KICKS,
  onTargetOf,
  pGoalBlind,
  pGoalBought,
  reachOf,
  RTP,
  STEAL_RATE,
  STRAIGHT_ROUNDS,
  TABLE,
  type Zone,
  ZONES,
} from '../game/table.ts'
import { House, MIN_STAKE, recompute } from './service.ts'

/*
 * He cheats, and so can you.
 *
 * SERIES.md puts one thing through every table in the house - you are betting on
 * whether his hands are clean - and an earlier version of this table wrote itself out
 * of that on the grounds that nobody can cheat on open ground. This file is the
 * correction. It checks the two halves separately, because they are built on opposite
 * principles and only one of them is allowed to touch the return:
 *
 *   He comes off his line    changes the return, on purpose, and it is disclosed
 *   You buy him              cannot change the return, by construction
 */

const entropy = (start = 0x10) => {
  let n = start
  return (len: number) => new Uint8Array(len).fill(n++ & 0xff)
}

const table = (start = 0x10, funds = 5_000_000) => {
  const house = new House(entropy(start))
  house.fund('ana', funds, 'fund:ana')
  return house
}

let keys = 0
const key = () => `c${++keys}`

/**
 * Plays one round and leaves nothing open, because the House allows one round at a time
 * and a helper that forgets to close makes every test after it fail with the same
 * unhelpful "there is already a shootout running".
 */
function playOne(house: House, zones: readonly Zone[], bribeAt = -1) {
  const opened = house.open('ana', MIN_STAKE, key())
  const id = opened.round!.id
  zones.forEach((z, i) => {
    if (house.view('ana').round!.status !== 'open') return
    house.kick('ana', id, z, key(), i === bribeAt)
  })
  if (house.view('ana').round!.status === 'open') house.cashOut('ana', id, key())
  return house.view('ana').round!
}

/** Finds a seed whose first kick at `zone` is a save he stole a step for. */
function findStolenSave(zone: Zone): { house: House; roundId: string } {
  for (let s = 0; s < 4_000; s++) {
    const house = table(s)
    const round = playOne(house, [zone])
    const last = round.kicks.at(-1)
    if (last?.result === 'saved' && last.stole) return { house, roundId: round.id }
  }
  throw new Error('no stolen save in 4000 seeds; STEAL_RATE may have moved')
}

/** Finds a seed whose first kick at `zone` is a save he did NOT steal a step for. */
function findCleanSave(zone: Zone): { house: House; roundId: string } {
  for (let s = 0; s < 4_000; s++) {
    const house = table(s)
    const round = playOne(house, [zone])
    const last = round.kicks.at(-1)
    if (last?.result === 'saved' && !last.stole) return { house, roundId: round.id }
  }
  throw new Error('no clean save in 4000 seeds')
}

describe('he comes off his line', () => {
  it('gets further for it, and the board does not say so', () => {
    /* The whole theft in one assertion: his reach goes up, and pGoalBlind - the number
     * printed on the goal - is computed from the clean reach. The difference is his. */
    for (const z of ZONES) {
      expect(reachOf(z, true)).toBeGreaterThan(reachOf(z, false))
      const quoted = pGoalBlind(z)
      const real = TABLE[z].onTarget * (1 - TABLE[z].dive * reachOf(z, true))
      expect(real).toBeLessThan(quoted)
    }
  })

  it('costs the player five points of return at the worst, and it is disclosed', () => {
    /*
     * The number that has to be published rather than buried. This is a deliberate break
     * with the rest of the paytable, where no way of playing beats another, and it is the
     * same break EL BANDIDO MANCO makes - three machines, one pay card, and the player's
     * job is working out which one they are at.
     *
     * Bounded rather than pinned, so the constants can be retuned, but the gap must stay
     * a gap worth learning about and must never be so wide it reads as a different game.
     */
    const r = honestRange()
    expect(r.clean).toBeCloseTo(RTP, 10)
    expect(r.robbed).toBeLessThan(RTP - 0.02)
    expect(r.robbed).toBeGreaterThan(RTP - 0.08)
  })

  it('takes more from a player with more riding', () => {
    /* He is stealing a share of a multiplier, so the longer the ladder the bigger his
     * cut. This is the shape that killed every refund-based remedy: a flat refund cannot
     * track it. */
    const one = honestReturn('bl', 1).robbed
    const five = honestReturn('bl', 5).robbed
    const ten = honestReturn('bl', 10).robbed
    expect(five).toBeLessThan(one)
    expect(ten).toBeLessThan(five)
  })

  it('keeps his feet on the line once he has been called out', () => {
    const { house, roundId } = findStolenSave('bc')
    const after = house.call('ana', roundId, key())

    expect(after.round!.called).toBe('right')
    expect(after.straightRounds).toBe(STRAIGHT_ROUNDS)

    /* And it is real: with him straight, no kick can be a steal. */
    for (let i = 0; i < STRAIGHT_ROUNDS; i++) {
      const round = playOne(house, ['bc', 'bc', 'bc'])
      for (const k of round.kicks) {
        expect(k.straight).toBe(true)
        expect(k.stole).toBe(false)
      }
    }
  })

  it('goes back to it once the watching wears off', () => {
    const { house, roundId } = findStolenSave('bc')
    house.call('ana', roundId, key())
    for (let i = 0; i < STRAIGHT_ROUNDS + 1; i++) playOne(house, ['bc'])
    expect(house.view('ana').straightRounds).toBe(0)
  })

  it('pays nothing for being called, and that is the point', () => {
    /*
     * Every version of paying for this overshoots - a void hands back the whole ladder,
     * and a flat ante refund solved out to about a tenth of an ante, which is both
     * unexplainable and insulting. The remedy is that the game becomes fair, which
     * cannot exceed the fair game BY CONSTRUCTION.
     *
     * So: a correct call moves no chips.
     */
    const { house, roundId } = findStolenSave('bc')
    const before = house.view('ana').balance
    const payouts = house.store.read().journal.filter((e) => e.kind === 'payout').length

    const after = house.call('ana', roundId, key())

    expect(after.balance).toBe(before)
    expect(house.store.read().journal.filter((e) => e.kind === 'payout')).toHaveLength(payouts)
    expect(after.round!.payout).toBe(0)
  })

  it('costs standing to call him when his feet were on the line', () => {
    const { house, roundId } = findCleanSave('bc')
    const before = house.view('ana').heat

    const after = house.call('ana', roundId, key())
    expect(after.round!.called).toBe('wrong')
    expect(after.heat).toBeCloseTo(before + HEAT_CALL_WRONG, 10)
    expect(after.straightRounds).toBe(0)
  })

  it('allows one call, and only on a save', () => {
    const { house, roundId } = findStolenSave('bc')
    house.call('ana', roundId, key())
    expect(() => house.call('ana', roundId, key())).toThrow(/only get one/)

    /* A miss is the shooter's fault and there is nothing to call. */
    const house2 = table(0x99)
    const opened = house2.open('ana', MIN_STAKE, key())
    expect(() => house2.call('ana', opened.round!.id, key())).toThrow(/nothing to call/)
  })

  it('tells the player afterwards, on the reveal, that they missed one', () => {
    /*
     * The most useful line in the verify panel. A player who was saved and said nothing
     * can see, for certain, that he was off his line - which turns a loss into something
     * they can do differently, and is the difference between a read you can practise and
     * a guess.
     */
    const { house, roundId } = findStolenSave('bc')
    const round = house.store.read().rounds.get(roundId)!
    const after = house.rotateSeed('ana', 'next', key())
    const seed = after.revealed[0]

    const mine = recompute(
      seed.serverSeed,
      round.clientSeed,
      round.nonce,
      round.kicks.map((k) => ({ zone: k.zone as Zone, bribed: k.bribed })),
    )
    expect(mine[0].stole).toBe(true)
    expect(mine[0].result).toBe('saved')
  })
})

describe('you buy him', () => {
  it('is priced so it cannot buy edge', () => {
    /*
     * The other half of the spine, and it obeys the opposite rule. Paying him raises the
     * probability and lowers the multiplier by exactly as much, so the money buys
     * survival on a ladder and never return. The check is the same one every priced piece
     * of information in this game gets.
     */
    for (const z of ZONES) {
      const p = pGoalBought(z, null)
      expect(p * (RTP / p)).toBeCloseTo(RTP, 12)
      /* And it is worth something: better odds than shooting into an unbought keeper. */
      expect(p).toBeGreaterThan(pGoalBlind(z))
      /* But not as good as him definitely going elsewhere, because the money can be
       * refused. */
      expect(p).toBeLessThan(onTargetOf(z))
      expect(p).toBeCloseTo(BRIBE_TAKES * onTargetOf(z) + (1 - BRIBE_TAKES) * pGoalBlind(z), 12)
    }
  })

  it('is worth most where he actually lives', () => {
    /* Down the middle he is nearly always there, so paying him to leave is worth a great
     * deal. In a top corner he was never there and the money is nearly wasted. A player
     * who works that out is playing better, and still cannot beat 97%. */
    const worth = (z: Zone) => pGoalBought(z, null) / pGoalBlind(z)
    expect(worth('bc')).toBeGreaterThan(worth('tl'))
  })

  it('sends him somewhere else when the money takes', () => {
    for (let s = 0; s < 400; s++) {
      const house = table(s)
      const round = playOne(house, ['bc'], 0)
      const k = round.kicks[0]
      if (!k.bought) continue
      expect(k.bribed).toBe(true)
      expect(k.dive).not.toBe('bc')
      /* Priced against the bought probability, not the straight one. */
      expect(k.p).toBeCloseTo(pGoalBought('bc', k.shown as Zone | null), 12)
      return
    }
    throw new Error('the money never took in 400 seeds; BRIBE_TAKES may have moved')
  })

  it('leaves him alone when the money does not take, and costs extra standing', () => {
    for (let s = 0; s < 400; s++) {
      const house = table(s)
      const before = house.view('ana').heat
      const round = playOne(house, ['bc'], 0)
      const k = round.kicks[0]
      if (k.bought) continue
      expect(k.bribed).toBe(true)
      /* He mentions it to the man running the lot. */
      expect(house.view('ana').heat).toBeGreaterThan(before)
      return
    }
    throw new Error('the money always took in 400 seeds')
  })

  it('runs out', () => {
    const house = table(0x31)
    for (let i = 0; i < BRIBES_PER_SESSION; i++) {
      const opened = house.open('ana', MIN_STAKE, key())
      house.kick('ana', opened.round!.id, 'bc', key(), true)
      const now = house.view('ana').round!
      if (now.status === 'open') house.cashOut('ana', now.id, key())
    }
    expect(house.view('ana').bribesLeft).toBe(0)

    const opened = house.open('ana', MIN_STAKE, key())
    expect(() => house.kick('ana', opened.round!.id, 'bc', key(), true)).toThrow(/not take your money/)
  })

  it('can be reproduced from the seed, money and all', () => {
    /* Buying him does not break the commitment. Whether the money took is a committed
     * roll, and where he went instead is the same dive float with the bought corner
     * struck out - so a reveal reproduces every kick including the crooked ones. */
    const house = table(0x51)
    const round = playOne(house, ['bc', 'bl', 'tl'], 1)
    const record = house.store.read().rounds.get(round.id)!

    const after = house.rotateSeed('ana', 'next', key())
    const seed = after.revealed[0]
    const mine = recompute(
      seed.serverSeed,
      record.clientSeed,
      record.nonce,
      record.kicks.map((k) => ({ zone: k.zone as Zone, bribed: k.bribed })),
    )

    record.kicks.forEach((k, i) => {
      expect(mine[i].result).toBe(k.result)
      expect(mine[i].dive).toBe(k.dive)
      expect(mine[i].bought).toBe(k.bought)
    })
  })
})

describe('standing', () => {
  it('never moves a chip, which is what makes all of this safe', () => {
    /*
     * The load-bearing property of the whole cheating system. Heat is session length and
     * nothing else: it buys nothing, it costs nothing, and no path through it can touch
     * the house edge. That is the only reason a two-sided cheating mechanic can be bolted
     * onto an exactly-priced ladder without wrecking it.
     */
    const house = table(0x61)
    const before = house.view('ana').balance
    const { house: h2, roundId } = findStolenSave('bc')
    void h2.call('ana', roundId, key())

    /* Wrong calls, bribes, and being run off - none of them post to the ledger. */
    const clean = findCleanSave('bl')
    const balanceBefore = clean.house.view('ana').balance
    clean.house.call('ana', clean.roundId, key())
    expect(clean.house.view('ana').balance).toBe(balanceBefore)
    expect(house.view('ana').balance).toBe(before)
  })

  it('runs the player off the lot when it tops out, and they keep their chips', () => {
    const house = table(0x71)
    let guard = 0
    while (!house.view('ana').runOff && guard++ < 200) {
      const save = findCleanSaveIn(house)
      if (save === null) break
      house.call('ana', save, key())
    }

    const view = house.view('ana')
    expect(view.runOff).toBe(true)
    expect(view.heat).toBe(1)
    expect(view.balance).toBeGreaterThan(0)
    expect(() => house.open('ana', MIN_STAKE, key())).toThrow(/had enough/)
  })

  /** A clean save in THIS house, so heat accumulates across the loop above. */
  function findCleanSaveIn(house: House): string | null {
    for (let i = 0; i < 200; i++) {
      if (house.view('ana').runOff) return null
      const round = playOne(house, ['bc', 'bl', 'tl', 'bl', 'tl'])
      const last = round.kicks.at(-1)
      if (last?.result === 'saved' && !last.stole && round.called === null) return round.id
    }
    return null
  }

  it('cools off when the player keeps it straight', () => {
    const { house, roundId } = findCleanSave('bc')
    house.call('ana', roundId, key())
    const hot = house.view('ana').heat
    expect(hot).toBeGreaterThan(0)

    for (let i = 0; i < 6; i++) playOne(house, ['bc'])
    expect(house.view('ana').heat).toBeLessThan(hot)
  })

  it('is spent by buying him', () => {
    const house = table(0x81)
    const opened = house.open('ana', MIN_STAKE, key())
    house.kick('ana', opened.round!.id, 'bc', key(), true)
    expect(house.view('ana').heat).toBeGreaterThan(0)
    expect(house.view('ana').bribesLeft).toBe(BRIBES_PER_SESSION - 1)
  })
})

describe('the steal is committed like everything else', () => {
  it('does not depend on what the player shoots at', () => {
    const stealsFor = (zone: Zone) => {
      const house = table(0xb1)
      const round = playOne(
        house,
        Array.from({ length: MAX_KICKS }, () => zone),
      )
      const record = house.store.read().rounds.get(round.id)!
      const after = house.rotateSeed('ana', 'next', key())
      return recompute(after.revealed[0].serverSeed, record.clientSeed, record.nonce, [])
        .map((r) => `${r.kick}:${r.stole}`)
        .join()
    }
    /* Same seed, opposite strategies, identical night of infractions. */
    expect(stealsFor('bc')).toBe(stealsFor('tl'))
  })

  it('happens about as often as the table says', () => {
    const house = table(0xc1, 50_000_000)
    let kicks = 0
    let steals = 0
    for (let i = 0; i < 900; i++) {
      const round = playOne(house, ['bc', 'bc', 'bc'])
      for (const k of round.kicks) {
        kicks++
        if (k.stole) steals++
      }
    }
    expect(kicks).toBeGreaterThan(400)
    expect(steals / kicks).toBeCloseTo(STEAL_RATE, 1)
  })
})
