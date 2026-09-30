/*
 * Double-entry bookkeeping, in about eighty lines.
 *
 * The single design decision worth arguing about: there is no debit() and no
 * credit(). There is only post(), it takes a set of legs, and it refuses any set
 * that does not sum to zero.
 *
 * That is what structurally rules out the two failures in the brief. "扣了钱没派彩"
 * is a debit with no matching credit; "重复派彩" is a credit posted twice. The
 * first cannot be expressed in this API at all, and the second is caught by the
 * idempotency key in Store.transact. Neither is prevented by being careful.
 *
 * Signs, once, so nobody has to rederive them at a call site: positive credits
 * the account. A player account is an asset from the player's side, so it goes
 * up when they win. House accounts are the mirror and sit negative for a house
 * that is ahead, which looks wrong for about a day and then stops.
 */

import type { Chips } from '../game/table.ts'
import { Rejected, type Db, type JournalEntry, type Posting } from './store.ts'

export const playerAccount = (playerId: string): string => `player:${playerId}`

/** Where stakes land. */
export const HOUSE_WAGERS = 'house:wagers'
/** Where payouts come from. Split from wagers so the take is a subtraction. */
export const HOUSE_PAYOUTS = 'house:payouts'
/** Grey-box only: the faucet that funds a demo balance. See PENALES.md §6. */
export const HOUSE_DEPOSITS = 'house:deposits'

function move(db: Db, account: string, amount: Chips): void {
  db.accounts.set(account, (db.accounts.get(account) ?? 0) + amount)
}

/**
 * The only way money moves. Call it inside Store.transact and nowhere else -
 * outside a transaction it would mutate committed state directly, which is the
 * bug this module is here to make impossible.
 */
export function post(
  db: Db,
  kind: JournalEntry['kind'],
  key: string,
  memo: string,
  postings: readonly Posting[],
): JournalEntry {
  const sum = postings.reduce((a, p) => a + p.amount, 0)
  if (sum !== 0) throw new Error(`a ${kind} posting is out by ${sum} chips; it would invent money`)
  for (const p of postings) {
    if (!Number.isInteger(p.amount)) throw new Error(`${p.account} would move ${p.amount}, which is not a whole centavo`)
  }

  const entry: JournalEntry = { seq: ++db.seq, key, at: Date.now(), kind, memo, postings }
  db.journal.push(entry)
  for (const p of postings) move(db, p.account, p.amount)

  /* The overdraft check lives here as well as in invariants(), so the error
   * names the posting that caused it rather than the account it left behind. */
  for (const p of postings) {
    if (!p.account.startsWith('player:')) continue
    const left = db.accounts.get(p.account) ?? 0
    if (left < 0) throw new Rejected('insufficient_funds', `${p.account} is short by ${-left} chips`)
  }

  return entry
}

export const balance = (db: Db, account: string): Chips => db.accounts.get(account) ?? 0

/* ------------------------------------------------------ the three movements */

export const takeStake = (db: Db, key: string, playerId: string, roundId: string, stake: Chips): JournalEntry =>
  post(db, 'stake', key, `stake on ${roundId}`, [
    { account: playerAccount(playerId), amount: -stake },
    { account: HOUSE_WAGERS, amount: stake },
  ])

export const payOut = (db: Db, key: string, playerId: string, roundId: string, amount: Chips): JournalEntry =>
  post(db, 'payout', key, `payout on ${roundId}`, [
    { account: HOUSE_PAYOUTS, amount: -amount },
    { account: playerAccount(playerId), amount: amount },
  ])

export const deposit = (db: Db, key: string, playerId: string, amount: Chips): JournalEntry =>
  post(db, 'deposit', key, `deposit for ${playerId}`, [
    { account: HOUSE_DEPOSITS, amount: -amount },
    { account: playerAccount(playerId), amount: amount },
  ])

/* ------------------------------------------------------------ reconciliation */

/**
 * What a nightly reconciliation job asks. Two independent readings of the same
 * money: walk the journal, and read the balances. They have to agree.
 *
 * Worth having even though the invariant in store.ts makes disagreement
 * impossible in this implementation - because the real one will not be this
 * implementation, and this is the check that survives the port.
 */
export function reconcile(db: Db): { account: string; fromJournal: Chips; fromBalance: Chips }[] {
  const replayed = new Map<string, Chips>()
  for (const entry of db.journal) {
    for (const p of entry.postings) replayed.set(p.account, (replayed.get(p.account) ?? 0) + p.amount)
  }

  const out: { account: string; fromJournal: Chips; fromBalance: Chips }[] = []
  for (const account of new Set([...replayed.keys(), ...db.accounts.keys()])) {
    const fromJournal = replayed.get(account) ?? 0
    const fromBalance = db.accounts.get(account) ?? 0
    if (fromJournal !== fromBalance) out.push({ account, fromJournal, fromBalance })
  }
  return out
}

/** The house's take. Stakes in, payouts out, deposits ignored - they are float. */
export const houseNet = (db: Db): Chips => balance(db, HOUSE_WAGERS) + balance(db, HOUSE_PAYOUTS)
