/*
 * The transaction boundary. This file exists because of one line in the brief:
 *
 *   "原子扣款派彩是项目里已记录的硬缺口... 否则会出现扣了钱没派彩、或重复派彩。"
 *
 * Every way that goes wrong is the same bug wearing a different hat: a money
 * move and the state change that justifies it were allowed to happen
 * separately. So the rule here is absolute and there is no API for breaking it:
 *
 *   A money move and the round state that authorises it commit together, or
 *   neither happens.
 *
 * WHY IT LOOKS LIKE THIS
 *
 * The state is in memory because this is a grey box. The SHAPE is not a grey
 * box, and that is the point - the brief is right that writing client-authority
 * first and fixing it later is a rewrite, and the same is true of the wallet.
 * Every construct below maps onto exactly one SQL construct:
 *
 *   transact(fn)        BEGIN ... COMMIT, one statement of isolation
 *   draft               the uncommitted transaction's view
 *   applied             a table with a UNIQUE index on the idempotency key
 *   commit()            the single pointer swap below, which is the COMMIT
 *   invariants()        a deferred CHECK constraint, run before commit lands
 *
 * Swapping this for Postgres means reimplementing four methods. It does not
 * mean touching a line of game logic, a line of ledger logic, or a line of the
 * service - and that is the only property worth defending at this stage,
 * because it is the one that decides whether the real wallet integration is an
 * adapter or a rewrite.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * The real thing needs a distributed story this cannot have: the wallet is a
 * separate service, so the debit and the round live in different databases and
 * "commit together" stops being free. PENALES.md section 6 spells out the
 * reserve/commit/rollback protocol that replaces it and why the idempotency key
 * below is the part that survives unchanged. Read that before wiring this to a
 * real wallet.
 */

import type { Centavos } from '../game/table.ts'

/* ------------------------------------------------------------- the journal */

/** One leg of a money move. Positive credits the account, negative debits it. */
export interface Posting {
  account: string
  amount: Centavos
}

export interface JournalEntry {
  readonly seq: number
  /** The idempotency key of the transaction that wrote it. */
  readonly key: string
  readonly at: number
  readonly kind: 'stake' | 'payout' | 'deposit'
  readonly memo: string
  /** Sums to zero. Enforced, not hoped for. */
  readonly postings: readonly Posting[]
}

/* -------------------------------------------------------------- the tables */

export interface SeedRecord {
  readonly playerId: string
  /** Never leaves the server until `retired`. Enforced in service.ts. */
  readonly serverSeed: string
  readonly commitment: string
  readonly clientSeed: string
  /** Next unused nonce. Monotonic for the life of the seed. */
  readonly nonce: number
  /** Retired seeds are revealable. Live ones are not, and this is one-way. */
  readonly retired: boolean
}

export interface KickRecord {
  readonly zone: string
  readonly result: 'goal' | 'saved' | 'missed'
  readonly dive: string
  /** The dive the player was shown before choosing, when he tipped his hand. */
  readonly shown: string | null
  /** The probability this kick was priced against. Kept for audit and replay. */
  readonly p: number
}

export interface RoundRecord {
  readonly id: string
  readonly playerId: string
  readonly stake: Centavos
  /** Which seed and which nonce produced this round. The audit trail. */
  readonly seedCommitment: string
  readonly clientSeed: string
  readonly nonce: number
  readonly kicks: readonly KickRecord[]
  readonly status: 'open' | 'cashed' | 'busted'
  readonly payout: Centavos
  readonly openedAt: number
  readonly closedAt: number | null
}

export interface Db {
  readonly accounts: Map<string, Centavos>
  readonly journal: JournalEntry[]
  /** Idempotency key -> the serialised result the first call returned. */
  readonly applied: Map<string, string>
  readonly rounds: Map<string, RoundRecord>
  /**
   * Keyed by commitment, and retired seeds are kept rather than deleted - a
   * player has to be able to verify a round from last week, and the commitment
   * printed on that round is the only handle they have on it.
   */
  readonly seeds: Map<string, SeedRecord>
  /** playerId -> the commitment of their live seed. */
  readonly live: Map<string, string>
  /**
   * playerId -> their open round. At most one, which is a rule about money and
   * not about UI: two open rounds on one seed would need two nonces in flight
   * and a player could no longer tell which reveal explains which round.
   */
  readonly openRounds: Map<string, string>
  /**
   * playerId -> their round ids, oldest first. Closed rounds stay: a player has
   * to be able to look at the round they just lost, and at the one from last
   * week they want to verify.
   */
  readonly byPlayer: Map<string, string[]>
  /** Journal sequence. The only scalar a transaction mutates in place. */
  seq: number
}

const empty = (): Db => ({
  accounts: new Map(),
  journal: [],
  applied: new Map(),
  rounds: new Map(),
  seeds: new Map(),
  live: new Map(),
  openRounds: new Map(),
  byPlayer: new Map(),
  seq: 0,
})

/**
 * A copy the transaction can scribble on.
 *
 * Shallow per container, which is safe only because every record type above is
 * readonly - a transaction that wants to change a round builds a new round
 * object. If a record ever gains a mutable field, this becomes a bug that writes
 * uncommitted state into committed state, so: do not.
 *
 * The journal is the exception: it is SHARED, not copied, because it only ever
 * grows and copying it would make the whole store quadratic in the number of
 * rounds ever played. An aborted transaction truncates it back instead - see
 * transact(). Every other container is bounded by retain() below, which is what
 * keeps this copy a fixed cost rather than one that grows all evening.
 */
const draftOf = (db: Db): Db => ({
  accounts: new Map(db.accounts),
  journal: db.journal,
  applied: new Map(db.applied),
  rounds: new Map(db.rounds),
  seeds: new Map(db.seeds),
  live: new Map(db.live),
  openRounds: new Map(db.openRounds),
  /* The inner arrays are appended to, so they are copied too - a shallow Map
   * copy would share them with committed state. */
  byPlayer: new Map([...db.byPlayer].map(([k, v]) => [k, [...v]])),
  seq: db.seq,
})

/** How many rounds per player stay in memory. Older ones page from the journal. */
export const RETAIN_ROUNDS = 16

/**
 * How many idempotency keys are remembered.
 *
 * Not a cache size - a retention policy, and it is one a real deployment has to
 * pick a number for too. An idempotency key cannot be honoured forever, so the
 * question is only whether the window is chosen deliberately or discovered when
 * the table runs out of disk. It has to comfortably outlive any client's retry
 * budget; the real answer is a time window rather than a count, which is a thing
 * a database can express and a Map cannot.
 */
export const RETAIN_KEYS = 4096

/**
 * Retention, applied inside the transaction so that committed state is never
 * touched outside one.
 */
function retain(db: Db): void {
  for (const [playerId, ids] of db.byPlayer) {
    if (ids.length <= RETAIN_ROUNDS) continue
    for (const id of ids.splice(0, ids.length - RETAIN_ROUNDS)) {
      /* An open round is never evicted - it is live state, not history. */
      if (db.openRounds.get(playerId) === id) ids.unshift(id)
      else db.rounds.delete(id)
    }
  }

  /* Map iterates in insertion order, so the oldest keys are the first ones out. */
  const over = db.applied.size - RETAIN_KEYS
  if (over <= 0) return
  let dropped = 0
  for (const k of db.applied.keys()) {
    if (dropped++ >= over) break
    db.applied.delete(k)
  }
}

/* ---------------------------------------------------------------- the store */

export class Rejected extends Error {
  /* A refusal the caller asked for - insufficient funds, round already closed.
   * Separated from a crash because a refusal is an answer and a crash is not,
   * and because only one of them should be memoised against the idempotency
   * key. See transact(). */
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'Rejected'
    this.code = code
  }
}

export class Store {
  /* The only mutable reference in the file. Replacing it IS the commit. */
  private db: Db = empty()

  /**
   * Test seam for the failure this whole file exists to rule out: a process
   * that dies with all the work done and nothing committed. Set it and the next
   * transaction throws at the last possible instant.
   */
  crashBeforeCommit: (() => void) | null = null

  read(): Db {
    return this.db
  }

  /**
   * @param key idempotency key. The same key never moves money twice - it
   *        replays the first answer instead. This is the property that makes a
   *        client retry, a load balancer retry, and a player double-tapping the
   *        button all safe, and it is why every call site is made to supply one
   *        rather than being offered a convenient overload that does not.
   */
  transact<T>(key: string, fn: (draft: Db) => T): T {
    const already = this.db.applied.get(key)
    if (already !== undefined) return JSON.parse(already) as T

    /* The journal is shared with the draft, so its committed length has to be
     * remembered in order to undo appends from a transaction that does not land. */
    const committed = this.db.journal.length
    const draft = draftOf(this.db)

    try {
      const result = fn(draft)

      /* Refusals never reach here - fn throws Rejected and we never commit, so a
       * retry gets a fresh decision. That is deliberate: "you had insufficient
       * funds at 12:04" is not an answer worth replaying at 12:09. */
      draft.applied.set(key, JSON.stringify(result))

      retain(draft)
      invariants(draft)
      this.crashBeforeCommit?.()

      /* The commit. One assignment, and until it runs nothing a caller can reach
       * has changed. */
      this.db = draft
      return result
    } catch (e) {
      this.db.journal.length = committed
      throw e
    }
  }

  balance(account: string): Centavos {
    return this.db.accounts.get(account) ?? 0
  }
}

/* ------------------------------------------------------------- invariants */

/**
 * Checked on the draft, before it becomes the truth. The kind of check that is
 * cheap here and forensic archaeology later.
 *
 * Only the accounts, which is a handful of rows - the per-entry balance is
 * checked in ledger.post() as the entry is written, because walking the whole
 * journal on every transaction would make a hundred thousand rounds quadratic
 * and this runs on the money path.
 */
export function invariants(db: Db): void {
  let total = 0
  for (const [account, amount] of db.accounts) {
    if (!Number.isInteger(amount)) throw new Error(`${account} holds ${amount}, which is not a whole centavo`)
    if (account.startsWith('player:') && amount < 0) throw new Error(`${account} is overdrawn: ${amount}`)
    total += amount
  }
  /* Double entry: the house's books are the negative of everyone's balances, so
   * the world sums to zero. If it ever does not, money was invented or lost and
   * the journal is the only place to find out where. */
  if (total !== 0) throw new Error(`the books are out by ${total} centavos`)
}
