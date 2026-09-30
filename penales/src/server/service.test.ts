import { describe, expect, it } from 'vitest'
import { MAX_KICKS, multiplierAfter, payoutFor, TABLE, type Zone, ZONES } from '../game/table.ts'
import { houseNet } from './ledger.ts'
import { House, MAX_STAKE, MIN_STAKE, recompute, verifyCommitment } from './service.ts'
import { Rejected, Store } from './store.ts'

/** Deterministic server seeds, so every assertion below is about one fixed world. */
const entropy = (start = 0x10) => {
  let n = start
  return (len: number) => new Uint8Array(len).fill(n++ & 0xff)
}

const table = (start = 0x10, funds = 1_000_000) => {
  const house = new House(entropy(start))
  house.fund('ana', funds, 'fund:ana')
  return house
}

let keys = 0
const key = () => `k${++keys}`

/** A stake in the middle of the table's range. */
const BET = 2_000

/** Plays until the round closes, or until `zones` runs out. */
function play(house: House, stake: number, zones: readonly Zone[]) {
  const opened = house.open('ana', stake, key())
  const roundId = opened.round!.id
  for (const z of zones) {
    const view = house.view('ana')
    if (view.round!.status !== 'open') break
    house.kick('ana', roundId, z, key())
  }
  return house.view('ana').round!
}

/** The same, banking whatever survived - so the seed can then be retired. */
function playOut(house: House, stake: number, zones: readonly Zone[]) {
  const round = play(house, stake, zones)
  if (round.status !== 'open') return round
  house.cashOut('ana', round.id, key())
  return house.view('ana').round!
}

describe('the client is never given anything it could compute an outcome with', () => {
  it('keeps the live server seed out of every view, at every stage', () => {
    const house = table()
    const seed = [...house.store.read().seeds.values()][0].serverSeed
    expect(seed).toHaveLength(64)

    const opened = house.open('ana', BET, key())
    house.kick('ana', opened.round!.id, 'bc', key())

    /*
     * The assertion is on the serialised view rather than on named fields, so a
     * field added later cannot leak the seed past this test by not being
     * mentioned in it. This is the single most important line in the file: while
     * the seed is live the client does not merely distrust it, the client does
     * not have it, and there is therefore no validation path to get wrong.
     */
    for (const stage of [house.view('ana'), opened]) {
      expect(JSON.stringify(stage)).not.toContain(seed)
      expect(stage.fair.serverSeed).toBeNull()
      expect(stage.round!.fair.serverSeed).toBeNull()
    }

    /* And the commitment IS published, from the first moment. A player who does
     * not write it down before playing has nothing to check later. */
    expect(house.view('ana').fair.commitment).toHaveLength(64)
  })

  it('prints the odds on the goal before anybody has played', () => {
    /* The goal has odds on it whether or not a round is open, and a player deciding
     * what to ante wants to read them. Without this the first load showed "x 0%" in
     * all six corners - which is what asking a round that does not exist what it pays
     * will get you. */
    const house = table()
    expect(house.view('ana').round).toBeNull()
    const board = house.view('ana').openingBoard
    expect(board).toHaveLength(ZONES.length)
    for (const row of board) {
      expect(row.multiplier).toBeGreaterThan(1)
      expect(row.p).toBeGreaterThan(0)
    }
  })

  it('publishes the odds it is pricing against', () => {
    /* The other half of not being asked to trust us: every multiplier on the
     * board comes with the probability it was derived from. */
    const house = table()
    const view = house.open('ana', BET, key())
    for (const row of view.round!.board) {
      expect(row.p).toBeGreaterThan(0)
      expect(row.p).toBeLessThan(1)
      expect(row.multiplier).toBeGreaterThan(1)
    }
  })

  it('reveals the seed only when the player retires it', () => {
    const house = table()
    playOut(house, BET, ['bc'])

    expect(house.view('ana').revealed).toHaveLength(0)

    const after = house.rotateSeed('ana', 'mi-nueva-semilla', key())
    expect(after.revealed).toHaveLength(1)
    expect(verifyCommitment(after.revealed[0].serverSeed, after.revealed[0].commitment)).toBe(true)
    /* The new seed is live, so it is still a secret. */
    expect(after.fair.serverSeed).toBeNull()
    expect(after.fair.commitment).not.toBe(after.revealed[0].commitment)
  })

  it('refuses to retire a seed with a round still running', () => {
    const house = table()
    const opened = house.open('ana', BET, key())
    house.kick('ana', opened.round!.id, 'tl', key())
    if (house.view('ana').round!.status !== 'open') return

    /* Revealing now would hand the player the rest of the keeper's night. */
    expect(() => house.rotateSeed('ana', 'otra', key())).toThrow(/finish the shootout/)
    expect(() => house.setClientSeed('ana', 'otra', key())).toThrow(/finish the shootout/)
  })
})

describe('nothing adapts to the shot', () => {
  it('sends the keeper the same way whatever the player does', () => {
    /*
     * The accusation an operator can never otherwise answer, tested directly.
     *
     * Two identical worlds - same entropy, same client seed, same nonce - played
     * with opposite strategies. Reveal both and recompute all ten kicks. The
     * keeper's night has to be identical, including the kicks that one of the two
     * players never got to take.
     */
    const timid: Zone[] = Array.from({ length: MAX_KICKS }, () => 'bc')
    const brave: Zone[] = Array.from({ length: MAX_KICKS }, () => 'tl')

    const reveal = (zones: Zone[]) => {
      const house = table(0x55)
      const round = playOut(house, BET, zones)
      const after = house.rotateSeed('ana', 'next', key())
      const seed = after.revealed[0]
      return recompute(seed.serverSeed, round.fair.clientSeed, round.fair.nonce, []).map(
        (r) => `${r.kick}:${r.dive}:${r.tell}`,
      )
    }

    expect(reveal(timid)).toEqual(reveal(brave))
  })

  it('recomputes, off the revealed seed, exactly what the player was shown', () => {
    const house = table(0x77)
    const round = playOut(house, BET, ['tl', 'bc', 'br', 'tc', 'bl', 'tr', 'bc', 'bl', 'tl', 'bc'])
    const after = house.rotateSeed('ana', 'next', key())
    const seed = after.revealed[0]

    expect(verifyCommitment(seed.serverSeed, round.fair.commitment)).toBe(true)

    const mine = recompute(
      seed.serverSeed,
      round.fair.clientSeed,
      round.fair.nonce,
      round.kicks.map((k) => ({ zone: k.zone as Zone, bribed: k.bribed })),
    )

    /* Every kick the player took, independently reproduced on their own machine
     * from three strings. This is what "provably fair" has to cash out as. */
    round.kicks.forEach((k, i) => {
      expect(mine[i].result).toBe(k.result)
      expect(mine[i].dive).toBe(k.dive)
      expect(mine[i].tell).toBe(k.shown !== null)
    })

    /* And the kicks nobody took, which is the part players actually enjoy. */
    expect(mine).toHaveLength(MAX_KICKS)
    for (const r of mine.slice(round.kicks.length)) expect(r.result).toBe('not taken')
  })

  it('never reuses a nonce, even on a round that is abandoned', () => {
    const house = table()
    const seen = new Set<number>()
    for (let i = 0; i < 6; i++) {
      const view = house.open('ana', MIN_STAKE, key())
      expect(seen.has(view.round!.fair.nonce)).toBe(false)
      seen.add(view.round!.fair.nonce)
      /* Abandon it by losing it, or by cashing - either way the nonce is spent. */
      house.kick('ana', view.round!.id, 'bc', key())
      if (house.view('ana').round!.status === 'open') house.cashOut('ana', view.round!.id, key())
    }
    expect(seen.size).toBe(6)
  })
})

describe('the money moves with the round or not at all', () => {
  it('debits the stake and creates the round in one transaction', () => {
    const house = table()
    const before = house.view('ana').balance
    const view = house.open('ana', MAX_STAKE, key())
    expect(view.balance).toBe(before - MAX_STAKE)
    expect(view.round!.status).toBe('open')
    expect(view.round!.stake).toBe(MAX_STAKE)
  })

  it('charges nothing when the process dies opening a round', () => {
    const house = table()
    house.store.crashBeforeCommit = () => {
      throw new Error('gone')
    }
    expect(() => house.open('ana', MAX_STAKE, key())).toThrow(/gone/)

    house.store.crashBeforeCommit = null
    /* No charge, no round, and crucially no burnt nonce - the seed is untouched,
     * so the next round is not mysteriously missing one. */
    expect(house.view('ana').balance).toBe(1_000_000)
    expect(house.view('ana').round).toBeNull()
    expect(house.view('ana').fair.nonce).toBe(0)
  })

  it('credits the payout and closes the round in one transaction', () => {
    const house = table(0x21)
    const opened = house.open('ana', BET, key())
    const id = opened.round!.id

    house.kick('ana', id, 'bc', key())
    const mid = house.view('ana').round!
    if (mid.status !== 'open') return

    const owed = mid.cashOut
    const before = house.view('ana').balance
    const after = house.cashOut('ana', id, key())

    expect(after.round!.status).toBe('cashed')
    expect(after.round!.payout).toBe(owed)
    expect(after.balance).toBe(before + owed)
  })

  it('pays nothing and closes nothing when the process dies cashing out', () => {
    const house = table(0x21)
    const opened = house.open('ana', BET, key())
    const id = opened.round!.id
    house.kick('ana', id, 'bc', key())
    if (house.view('ana').round!.status !== 'open') return

    const before = house.view('ana').balance
    house.store.crashBeforeCommit = () => {
      throw new Error('gone')
    }
    const cashKey = key()
    expect(() => house.cashOut('ana', id, cashKey)).toThrow(/gone/)

    /* The exposure the brief names: money not paid, round still open. Recovery is
     * that the round is STILL PLAYABLE, so nothing was lost - and the retry with
     * the same key pays exactly once. */
    expect(house.view('ana').balance).toBe(before)
    expect(house.view('ana').round!.status).toBe('open')

    house.store.crashBeforeCommit = null
    const retried = house.cashOut('ana', id, cashKey)
    expect(retried.round!.status).toBe('cashed')
    expect(retried.balance).toBe(before + retried.round!.payout)

    /* And a third attempt pays nothing further. */
    const again = house.cashOut('ana', id, cashKey)
    expect(again.balance).toBe(retried.balance)
  })

  it('pays a cash-out exactly once however many times the button is pressed', () => {
    const house = table(0x21)
    const opened = house.open('ana', BET, key())
    const id = opened.round!.id
    house.kick('ana', id, 'bc', key())
    if (house.view('ana').round!.status !== 'open') return

    const cashKey = key()
    const first = house.cashOut('ana', id, cashKey)
    for (let i = 0; i < 5; i++) expect(house.cashOut('ana', id, cashKey).balance).toBe(first.balance)

    expect(house.store.read().journal.filter((e) => e.kind === 'payout')).toHaveLength(1)
  })

  it('refuses a second cash-out under a fresh key, rather than paying twice', () => {
    /* Idempotency covers the retry. This covers the bug: a client that generates
     * a new key per press would slip past the key and has to be stopped by the
     * round's own state. Both defences are needed and neither is sufficient. */
    const house = table(0x21)
    const opened = house.open('ana', BET, key())
    const id = opened.round!.id
    house.kick('ana', id, 'bc', key())
    if (house.view('ana').round!.status !== 'open') return

    house.cashOut('ana', id, key())
    expect(() => house.cashOut('ana', id, key())).toThrow(/over/)
    expect(house.store.read().journal.filter((e) => e.kind === 'payout')).toHaveLength(1)
  })

  it('takes no second money move when a kick is missed or saved', () => {
    const house = table(0x33)
    const before = house.view('ana').balance
    const round = play(house, BET, Array.from({ length: MAX_KICKS }, () => 'tl'))
    if (round.status !== 'busted') return

    expect(round.payout).toBe(0)
    expect(house.view('ana').balance).toBe(before - BET)
    /* A loss is one money move, taken when the round opened. There is no second
     * leg to lose, which is why a crash on a losing kick cannot cost anyone. */
    expect(house.store.read().journal.filter((e) => e.kind === 'payout')).toHaveLength(0)
  })

  it('keeps the books balanced across a few hundred rounds', () => {
    const house = table(0x44, 10_000_000)
    for (let i = 0; i < 300; i++) {
      const view = house.open('ana', MIN_STAKE, key())
      const id = view.round!.id
      for (let k = 0; k < 3; k++) {
        if (house.view('ana').round!.status !== 'open') break
        house.kick('ana', id, ZONES[(i + k) % ZONES.length], key())
      }
      if (house.view('ana').round!.status === 'open') house.cashOut('ana', id, key())
    }

    const total = [...house.store.read().accounts.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(0)
    /* Over 300 rounds the house should be roughly ahead, and the only assertion
     * worth making on that small a sample is the sign of nothing having leaked. */
    expect(Number.isInteger(houseNet(house.store.read()))).toBe(true)
  })
})

describe('the rules of the round', () => {
  it('allows one shootout at a time', () => {
    const house = table()
    house.open('ana', BET, key())
    expect(() => house.open('ana', BET, key())).toThrow(/already a shootout/)
  })

  it('holds the table limits', () => {
    const house = table()
    expect(() => house.open('ana', MIN_STAKE - 1, key())).toThrow(/stake must be/)
    expect(() => house.open('ana', MAX_STAKE + 1, key())).toThrow(/stake must be/)
    expect(() => house.open('ana', 1000.5, key())).toThrow(/whole chips/)
  })

  it('refuses a stake the player cannot cover, without moving anything', () => {
    const house = table(0x10, BET - 1)
    expect(() => house.open('ana', BET, key())).toThrow(Rejected)
    expect(house.view('ana').balance).toBe(BET - 1)
    expect(house.view('ana').round).toBeNull()
  })

  it('refuses a zone that is not on the goal', () => {
    const house = table()
    const opened = house.open('ana', BET, key())
    expect(() => house.kick('ana', opened.round!.id, 'moon' as Zone, key())).toThrow(/no such zone/)
  })

  it('refuses another player reaching into the round', () => {
    const house = table()
    house.fund('beto', 100_000, 'fund:beto')
    const opened = house.open('ana', BET, key())
    expect(() => house.kick('beto', opened.round!.id, 'bc', key())).toThrow(/not your round/)
    expect(() => house.cashOut('beto', opened.round!.id, key())).toThrow(/not your round/)
  })

  it('will not pay out a round with no goals in it', () => {
    const house = table()
    const opened = house.open('ana', BET, key())
    expect(() => house.cashOut('ana', opened.round!.id, key())).toThrow(/score one first/)
  })

  it('pays itself out when the ladder runs out of kicks', () => {
    /* A perfect ten. Searched for rather than contrived, because the assertion is
     * that the round settles ITSELF - a finished round left open with no legal
     * move would need a timeout job to close it, and a timeout job that pays
     * money is exactly the thing this design is avoiding. */
    for (let s = 0; s < 400; s++) {
      const house = table(s)
      const round = play(house, MIN_STAKE, Array.from({ length: MAX_KICKS }, () => 'bc'))
      /* Ten KICKS is not ten GOALS - a round can reach the last kick and lose it, and
       * once he started stealing a step that became the commoner way to get here. This
       * test is about the round settling itself, so it wants the perfect run. */
      if (round.kicks.length < MAX_KICKS || round.kicks.some((k) => k.result !== 'goal')) continue

      expect(round.status).toBe('cashed')
      expect(round.payout).toBe(payoutFor(MIN_STAKE, multiplierAfter(round.kicks.map((k) => k.p))))
      expect(house.view('ana').round!.taken).toBe(MAX_KICKS)
      expect(() => house.kick('ana', round.id, 'bc', key())).toThrow(/over/)
      return
    }
    throw new Error('no perfect run in 400 seeds; the paytable may have moved')
  })
})

describe('the tell', () => {
  it('shows his hand before the kick, and reprices it', () => {
    /* Hunt for a round whose first kick carries the tell, then check the board
     * agrees with what the player can now see: the zone he has gone to must be
     * priced worse than the same zone would be blind, and the ones he has left
     * must be priced better. */
    for (let s = 0; s < 400; s++) {
      const house = table(s)
      const view = house.open('ana', MIN_STAKE, key())
      const round = view.round!
      if (round.shown === null) continue

      const shown = round.shown
      const covered = round.board.find((r) => r.zone === shown)!
      expect(covered.p).toBeCloseTo(TABLE[shown].onTarget * (1 - TABLE[shown].reach), 12)

      for (const row of round.board) {
        if (row.zone === shown) continue
        /* Nowhere he is not, the only thing left to beat is yourself. */
        expect(row.p).toBeCloseTo(TABLE[row.zone].onTarget, 12)
      }
      return
    }
    throw new Error('no tell in 400 seeds; TELL_RATE may have moved')
  })

  it('records what the player was shown, so a reveal can be checked against it', () => {
    const house = table(0x91)
    const round = play(house, MIN_STAKE, ['tl', 'bc', 'br'])
    for (const k of round.kicks) {
      if (k.shown === null) continue
      /* If he tipped his hand, the hand he tipped was the one he played. */
      expect(k.shown).toBe(k.dive)
    }
  })
})

describe('the seed the player brings', () => {
  it('changes the keeper, which is the point of having one', () => {
    const play1 = () => {
      const house = table(0xa1)
      house.setClientSeed('ana', 'semilla-uno', key())
      return play(house, MIN_STAKE, Array.from({ length: MAX_KICKS }, () => 'bc')).kicks.map((k) => k.dive).join()
    }
    const play2 = () => {
      const house = table(0xa1)
      house.setClientSeed('ana', 'semilla-dos', key())
      return play(house, MIN_STAKE, Array.from({ length: MAX_KICKS }, () => 'bc')).kicks.map((k) => k.dive).join()
    }
    expect(play1()).not.toBe(play2())
  })

  it('is bounded, because it goes in a hash and in a database', () => {
    const house = table()
    expect(() => house.setClientSeed('ana', '', key())).toThrow(/1 and 256/)
    expect(() => house.setClientSeed('ana', 'x'.repeat(257), key())).toThrow(/1 and 256/)
  })
})

describe('a shared store', () => {
  it('lets two players play without seeing each other', () => {
    /* One Store, two players - the shape a real deployment has, and the cheapest
     * place to catch a view that leaks across accounts. */
    const store = new Store()
    const house = new House(entropy(0xb0), store)
    house.fund('ana', 100_000, 'f:ana')
    house.fund('beto', 100_000, 'f:beto')

    house.open('ana', BET, key())
    house.open('beto', MAX_STAKE, key())

    expect(house.view('ana').round!.stake).toBe(BET)
    expect(house.view('beto').round!.stake).toBe(MAX_STAKE)
    expect(house.view('ana').fair.commitment).not.toBe(house.view('beto').fair.commitment)
    expect(house.view('ana').history).toHaveLength(1)
  })
})
