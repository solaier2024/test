import { describe, expect, it } from 'vitest'
import { deposit, houseNet, payOut, post, reconcile, takeStake } from './ledger.ts'
import { Rejected, Store } from './store.ts'

/*
 * The two failures named in the brief, written as tests:
 *
 *   扣了钱没派彩  money left the player and the payout never happened
 *   重复派彩      the payout happened twice
 *
 * Both are the same bug - a money move that was allowed to happen apart from the
 * state change justifying it - and both are meant to be unrepresentable rather
 * than merely avoided. These tests are the argument that they are.
 */

const funded = (amount = 100_000) => {
  const store = new Store()
  store.transact('seed', (db) => deposit(db, 'seed', 'ana', amount))
  return store
}

describe('the transaction commits or it does not', () => {
  it('leaves nothing behind when the process dies before the commit', () => {
    const store = funded()
    const before = store.read()

    /* All the work done, the invariants checked, and then the lights go out.
     * This is the moment the brief is worried about, so it gets its own seam
     * rather than being argued about in a comment. */
    store.crashBeforeCommit = () => {
      throw new Error('the pod was rescheduled')
    }

    expect(() =>
      store.transact('r1', (db) => {
        takeStake(db, 'r1:stake', 'ana', 'r1', 50_000)
        db.rounds.set('r1', {
          id: 'r1',
          playerId: 'ana',
          stake: 50_000,
          seedCommitment: 'c',
          clientSeed: 'x',
          nonce: 0,
          kicks: [],
          status: 'open',
          called: null,
          payout: 0,
          openedAt: 0,
          closedAt: null,
        })
      }),
    ).toThrow(/rescheduled/)

    expect(store.balance('player:ana')).toBe(100_000)
    expect(store.read().rounds.size).toBe(0)
    expect(store.read().journal).toHaveLength(1)
    /* Not merely equal - the same object. The commit is a pointer swap, so an
     * uncommitted transaction cannot have touched what is committed. */
    expect(store.read()).toBe(before)
  })

  it('lets a retry through after the crash, and gets it right the second time', () => {
    const store = funded()
    store.crashBeforeCommit = () => {
      throw new Error('down')
    }
    expect(() => store.transact('r1', (db) => takeStake(db, 'r1:stake', 'ana', 'r1', 50_000))).toThrow()

    store.crashBeforeCommit = null
    store.transact('r1', (db) => takeStake(db, 'r1:stake', 'ana', 'r1', 50_000))

    /* Charged once, not twice and not never. The idempotency key did not get
     * burned by the failed attempt, because nothing about the failed attempt was
     * recorded - which is the whole reason the key is written inside the
     * transaction and not before it. */
    expect(store.balance('player:ana')).toBe(50_000)
    expect(store.read().journal.filter((e) => e.kind === 'stake')).toHaveLength(1)
  })
})

describe('the idempotency key', () => {
  it('pays once however many times it is asked', () => {
    const store = funded()
    const key = 'payout:r1'

    const first = store.transact(key, (db) => payOut(db, key, 'ana', 'r1', 25_000).seq)
    /* A client retry, a load balancer retry, and an impatient player's second
     * tap all look exactly like this. */
    const second = store.transact(key, (db) => payOut(db, key, 'ana', 'r1', 25_000).seq)
    const third = store.transact(key, (db) => payOut(db, key, 'ana', 'r1', 25_000).seq)

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(store.balance('player:ana')).toBe(125_000)
    expect(store.read().journal.filter((e) => e.kind === 'payout')).toHaveLength(1)
  })

  it('replays the first answer without running the body again', () => {
    const store = funded()
    let ran = 0
    const body = () => {
      ran++
      return { ok: true }
    }
    expect(store.transact('k', body)).toEqual({ ok: true })
    expect(store.transact('k', body)).toEqual({ ok: true })
    expect(ran).toBe(1)
  })

  it('does not memoise a refusal', () => {
    const store = funded(1_000)

    /* A refusal is an answer about a moment, not about a key. "You had 10 chips
     * at 12:04" must not still be the answer at 12:09 after a deposit, or the
     * retry that should succeed is permanently poisoned by the one that failed. */
    expect(() => store.transact('bet', (db) => takeStake(db, 'bet', 'ana', 'r1', 50_000))).toThrow(Rejected)

    store.transact('top-up', (db) => deposit(db, 'top-up', 'ana', 100_000))
    store.transact('bet', (db) => takeStake(db, 'bet', 'ana', 'r1', 50_000))

    expect(store.balance('player:ana')).toBe(51_000)
  })
})

describe('double entry', () => {
  it('refuses a posting that does not balance', () => {
    const store = funded()
    /* The debit-with-no-credit shape, which is 扣了钱没派彩 in its purest form.
     * It is not caught by review here; it cannot be written down. */
    expect(() =>
      store.transact('bad', (db) => post(db, 'payout', 'bad', 'invented money', [{ account: 'player:ana', amount: 1 }])),
    ).toThrow(/invent money/)
    expect(store.balance('player:ana')).toBe(100_000)
  })

  it('refuses fractions of a centavo', () => {
    const store = funded()
    expect(() =>
      store.transact('bad', (db) =>
        post(db, 'payout', 'bad', 'half a centavo', [
          { account: 'house:payouts', amount: -0.5 },
          { account: 'player:ana', amount: 0.5 },
        ]),
      ),
    ).toThrow(/whole centavo/)
  })

  it('refuses to overdraw a player', () => {
    const store = funded(1_000)
    expect(() => store.transact('bet', (db) => takeStake(db, 'bet', 'ana', 'r1', 50_000))).toThrow(/short by 49000/)
    expect(store.balance('player:ana')).toBe(1_000)
  })

  it('keeps the world summing to zero', () => {
    const store = funded()
    store.transact('a', (db) => takeStake(db, 'a', 'ana', 'r1', 30_000))
    store.transact('b', (db) => payOut(db, 'b', 'ana', 'r1', 45_000))

    const total = [...store.read().accounts.values()].reduce((x, y) => x + y, 0)
    expect(total).toBe(0)
    /* Staked 300, paid 450, so the house is down 150. */
    expect(houseNet(store.read())).toBe(-15_000)
  })

  it('reconciles the journal against the balances', () => {
    const store = funded()
    for (let i = 0; i < 50; i++) {
      store.transact(`s${i}`, (db) => takeStake(db, `s${i}`, 'ana', `r${i}`, 500))
      if (i % 3 === 0) store.transact(`p${i}`, (db) => payOut(db, `p${i}`, 'ana', `r${i}`, 900))
    }
    /* Two independent readings of the same money. The check a nightly job runs,
     * and the one that survives the port to a real database - where it stops
     * being guaranteed by construction and starts being worth running. */
    expect(reconcile(store.read())).toEqual([])
  })
})
