/*
 * The house. Everything that decides anything lives in this file.
 *
 * THE LAYERING, WHICH IS THE POINT
 *
 * The brief is right that this has to be correct from the first line rather
 * than retrofitted, so it is worth being explicit about what "server
 * authoritative" means past the slogan. It is not "the server checks the
 * client's answer". It is:
 *
 *   The client never possesses the information needed to compute an outcome.
 *
 * Not "is not trusted with" - does not have. While a seed is live its server
 * seed exists only here; the client holds a hash of it. There is no validation
 * path to get wrong, no signature to forget to check, and no version of a
 * tampered client that can do anything except ask for a different zone, which
 * is a request it was entitled to make anyway.
 *
 * That is why view() below is written as a redaction rather than as a DTO that
 * happens to leave fields out, and why it is the only way a round becomes
 * visible. The test that matters is service.test.ts asserting the server seed
 * appears nowhere in a serialised view of a live round.
 *
 * WHAT ORDER THINGS HAPPEN IN
 *
 *   commit     a seed is generated, its hash is published, nothing is at stake
 *   open       stake is debited AND the round is created, in one transaction
 *   kick       the player names a zone; the already-committed floats resolve it
 *   settle     payout is credited AND the round is closed, in one transaction
 *   rotate     the seed is retired and revealed; the player can check the lot
 *
 * The two "AND"s are the atomic money requirement. They are single calls to
 * Store.transact, and there is no code path that does one without the other.
 */

import { commit, floatsAt, floatsFor, floatsOf, newSeedPair, type Floats } from '../game/fair.ts'
import {
  BRIBES_PER_SESSION,
  displayMultiplier,
  FLOATS_PER_ROUND,
  HEAT_BRIBE,
  HEAT_BRIBE_FAILED,
  HEAT_CALL_WRONG,
  HEAT_CLEAN_ROUND,
  MAX_KICKS,
  multiplierAfter,
  multiplierIfScored,
  payoutFor,
  pGoal,
  pGoalBought,
  pGoalFor,
  REGULATION_KICKS,
  resolveKick,
  rollsFor,
  STRAIGHT_ROUNDS,
  TABLE,
  type Chips,
  type Dive,
  type Zone,
  ZONES,
} from '../game/table.ts'
import { balance, deposit, payOut, playerAccount, takeStake } from './ledger.ts'
import {
  Rejected,
  Store,
  type Db,
  type KickRecord,
  type PlayerRecord,
  type RoundRecord,
  type SeedRecord,
} from './store.ts'

/*
 * Table limits, in chips.
 *
 * The floor is not a house rule, it is arithmetic. A payout is truncated to the
 * whole chip, so the smallest stake decides how much return truncation quietly
 * eats: the tightest multiplier on the board is 1.18x, and at a stake of 500 the
 * half-chip that gets dropped is under a tenth of a percent. At a stake of 5 it
 * would be four percent, and the table would be advertising a return it does not
 * pay. Chips are subdivided finely for the same reason a cash game would price in
 * minor units - not because anybody counts them one at a time.
 *
 * The ceiling is a house rule, and a soft one. There is no money here, so the
 * only thing it bounds is how quickly a bankroll can end.
 */
export const MIN_STAKE: Chips = 500
export const MAX_STAKE: Chips = 5_000

/* ------------------------------------------------------------ what leaves */

export interface BoardRow {
  zone: Zone
  /** Published. A player who wants to check the paytable should be able to. */
  p: number
  /** What the board would read if this kick goes in. */
  multiplier: number
  /** And what it would read if he had been paid to stay out of this corner. */
  boughtP: number
  boughtMultiplier: number
}

export interface FairView {
  commitment: string
  clientSeed: string
  nonce: number
  /** Present only once the seed is retired. Until then there is nothing to show. */
  serverSeed: string | null
}

export interface RoundView {
  id: string
  stake: Chips
  status: RoundRecord['status']
  kicks: readonly KickRecord[]
  /** Kicks taken. Also the index of the next one. */
  taken: number
  regulation: number
  maxKicks: number
  /** Banked if the player walks now. Zero before the first goal. */
  multiplier: number
  cashOut: Chips
  /** He has tipped his hand for the next kick. This is the read. */
  shown: Dive | null
  board: readonly BoardRow[]
  payout: Chips
  /** Whether the player called him, and whether they were right. */
  called: 'right' | 'wrong' | null
  /**
   * A save is sitting there that could be called. True whether or not he was actually
   * off his line - the whole point is that the house does not tell you.
   */
  callable: boolean
  fair: FairView
}

export interface RevealedSeed {
  commitment: string
  serverSeed: string
  clientSeed: string
  /** How many rounds were played on it. */
  rounds: number
}

export interface PlayerView {
  playerId: string
  balance: Chips
  /** The open round, or the last one played - so a player can see what happened. */
  round: RoundView | null
  /**
   * What the six corners pay on the first kick of a round that has not started.
   *
   * Here because the goal has odds printed on it whether or not anybody is playing,
   * and a player deciding what to ante wants to see them. Before this existed the
   * board on a first load read "x 0%" in all six corners, which is what you get for
   * asking a round that does not exist what it pays.
   */
  openingBoard: readonly BoardRow[]
  fair: FairView
  /** 0 to 1. Session length, never chips. */
  heat: number
  bribesLeft: number
  /** Rounds he will keep his feet on the line for, because he has been called out. */
  straightRounds: number
  /** The man running the lot has had enough. Chips are kept. */
  runOff: boolean
  /** Newest first. What the verify panel reads. */
  history: readonly RoundView[]
  /** Retired seeds, newest first, so a player can verify an old round. */
  revealed: readonly RevealedSeed[]
}

/** How far back a player can look. */
export const HISTORY = 12

/* ----------------------------------------------------------------- helpers */

const seedOf = (db: Db, playerId: string): SeedRecord => {
  const commitmentOf = db.live.get(playerId)
  const seed = commitmentOf === undefined ? undefined : db.seeds.get(commitmentOf)
  if (seed === undefined) throw new Rejected('no_seed', `${playerId} has no live seed`)
  return seed
}

const roundOf = (db: Db, roundId: string): RoundRecord => {
  const round = db.rounds.get(roundId)
  if (round === undefined) throw new Rejected('no_round', `no round ${roundId}`)
  return round
}

/**
 * The six corners, priced two ways: straight, and with him paid to stay out of the
 * corner.
 *
 * Both lines are published because the choice between them is the interesting one, and
 * a player cannot make it without seeing what it costs. Buying him raises the
 * probability and lowers the multiplier by exactly as much - it buys survival on a
 * ladder, never edge.
 */
const boardFor = (survived: readonly number[], shown: Dive | null): BoardRow[] =>
  ZONES.map((zone) => {
    const bought = pGoalBought(zone, shown)
    return {
      zone,
      p: pGoal(zone, shown),
      multiplier: displayMultiplier(multiplierIfScored(survived, zone, shown)),
      boughtP: bought,
      boughtMultiplier: displayMultiplier(multiplierAfter([...survived, bought])),
    }
  })

/* -------------------------------------------------------------------- heat */

const playerOf = (db: Db, playerId: string): PlayerRecord =>
  db.players.get(playerId) ?? {
    id: playerId,
    heat: 0,
    bribesLeft: BRIBES_PER_SESSION,
    straightRounds: 0,
    runOff: false,
  }

/**
 * Everything that happens to a player because a round ended.
 *
 * One function rather than the three call sites that each used to remember half of it -
 * a losing kick, a finished ladder and a cash-out all end a round, and all three have to
 * cool the heat and spend a round of his good behaviour. The first version decremented
 * his good behaviour in open() instead, which was off by one: set to five and decremented
 * before the first of the five, so the fifth round had him stealing again.
 */
function endRound(db: Db, playerId: string, bribed: boolean): void {
  const was = playerOf(db, playerId)
  db.players.set(playerId, {
    ...was,
    straightRounds: Math.max(0, was.straightRounds - 1),
  })
  /* Playing it straight is how you cool off, and it is the only reason not to buy him
   * every single time. */
  if (!bribed) stir(db, playerId, HEAT_CLEAN_ROUND)
}

/**
 * Moves heat, and runs the player off the lot when it tops out.
 *
 * The only thing heat does. It moves no chips - that is what makes it safe to hang a
 * whole cheating system off it without touching the return - and being run off keeps
 * everything already won. What ends is the evening.
 */
function stir(db: Db, playerId: string, by: number): PlayerRecord {
  const was = playerOf(db, playerId)
  const heat = Math.min(1, Math.max(0, was.heat + by))
  const next: PlayerRecord = { ...was, heat, runOff: was.runOff || heat >= 1 }
  db.players.set(playerId, next)
  return next
}

/** The probabilities of the goals already scored, in order. */
const survivedOf = (round: RoundRecord): number[] => round.kicks.filter((k) => k.result === 'goal').map((k) => k.p)

/**
 * The floats behind a round.
 *
 * Every kick in the round is a function of (server seed, client seed, nonce)
 * alone, fixed the moment the round opened - which is the property the whole
 * trust story rests on: kick nine was decided before kick one was taken, so
 * nothing can adapt to how the player is doing.
 *
 * Derived on demand rather than all at once. That is a performance detail and
 * changes no outcome: the value at a cursor does not depend on whether anything
 * asked for its neighbours.
 */
const roundFloats = (seed: SeedRecord, round: RoundRecord): Floats =>
  floatsFor(seed.serverSeed, round.clientSeed, round.nonce)

/**
 * What he shows before the next kick.
 *
 * A partial reveal of committed randomness, which is safe because it is the
 * mechanic: the tell roll is independent of the dive, so handing over the dive
 * when the tell fires tells the player nothing about any other kick. The
 * repricing in pGoal() is what stops it being free.
 */
const shownFor = (at: Floats, taken: number): Dive | null => {
  if (taken >= MAX_KICKS) return null
  const rolls = rollsFor(at, taken)
  return rolls.tell ? rolls.dive : null
}

/* -------------------------------------------------------------- the service */

export class House {
  readonly store: Store
  private readonly random: (n: number) => Uint8Array
  private ids = 0

  /**
   * @param random entropy for server seeds. Named at construction so that no
   *        call site can quietly fall back to Math.random - a weak seed makes
   *        the commitment theatre rather than proof.
   */
  constructor(random: (n: number) => Uint8Array, store: Store = new Store()) {
    this.random = random
    this.store = store
  }

  private nextId(prefix: string): string {
    return `${prefix}_${(++this.ids).toString(36).padStart(4, '0')}`
  }

  /* ------------------------------------------------------------- accounts */

  /** Puts chips in front of a player. There is nowhere else for them to come from. */
  fund(playerId: string, amount: Chips, key = `fund:${playerId}:${amount}:${this.nextId('f')}`): PlayerView {
    return this.store.transact(key, (db) => {
      deposit(db, key, playerId, amount)
      this.ensureSeed(db, playerId, playerId)
      return this.playerView(db, playerId)
    })
  }

  private ensureSeed(db: Db, playerId: string, clientSeed: string): SeedRecord {
    const existing = db.live.get(playerId)
    if (existing !== undefined) return db.seeds.get(existing)!

    const pair = newSeedPair(this.random)
    const seed: SeedRecord = {
      playerId,
      serverSeed: pair.serverSeed,
      commitment: pair.commitment,
      clientSeed,
      nonce: 0,
      retired: false,
    }
    db.seeds.set(seed.commitment, seed)
    db.live.set(playerId, seed.commitment)
    return seed
  }

  /* ----------------------------------------------------------------- seeds */

  /**
   * The player's half of the commitment.
   *
   * Refused while a round is open, and that refusal is load-bearing: the round's
   * floats are a function of the client seed, so allowing a change mid-round
   * would let a player re-roll a keeper they had already seen.
   */
  setClientSeed(playerId: string, clientSeed: string, key: string): PlayerView {
    if (clientSeed.length === 0 || clientSeed.length > 256) {
      throw new Rejected('bad_client_seed', 'a client seed is between 1 and 256 characters')
    }
    return this.store.transact(key, (db) => {
      if (db.openRounds.has(playerId)) throw new Rejected('round_open', 'finish the shootout first')
      const seed = seedOf(db, playerId)
      db.seeds.set(seed.commitment, { ...seed, clientSeed })
      return this.playerView(db, playerId)
    })
  }

  /**
   * Retire the live seed, reveal it, and commit to the next one.
   *
   * This is the whole point of the scheme and it is the player's move, not ours:
   * they ask, we hand over the seed that produced every round they have played,
   * and they can recompute all of it. We cannot refuse without the refusal
   * itself being the answer.
   */
  rotateSeed(playerId: string, nextClientSeed: string, key: string): PlayerView {
    return this.store.transact(key, (db) => {
      if (db.openRounds.has(playerId)) throw new Rejected('round_open', 'finish the shootout first')
      const seed = seedOf(db, playerId)
      db.seeds.set(seed.commitment, { ...seed, retired: true })
      db.live.delete(playerId)
      this.ensureSeed(db, playerId, nextClientSeed)
      return this.playerView(db, playerId)
    })
  }

  /* ----------------------------------------------------------------- rounds */

  /**
   * Stake debited and round created in ONE transaction.
   *
   * If this throws, the player was not charged - there is no state in which the
   * money left and the round did not appear. That sentence is the entire reason
   * store.ts exists.
   */
  open(playerId: string, stake: Chips, key: string): PlayerView {
    if (!Number.isInteger(stake)) throw new Rejected('bad_stake', 'stakes are whole chips')
    if (stake < MIN_STAKE || stake > MAX_STAKE) {
      throw new Rejected('bad_stake', `stake must be between ${MIN_STAKE} and ${MAX_STAKE} chips`)
    }

    const roundId = this.nextId('r')

    return this.store.transact(key, (db) => {
      if (db.openRounds.has(playerId)) throw new Rejected('round_open', 'there is already a shootout running')
      if (playerOf(db, playerId).runOff) throw new Rejected('run_off', 'the man running the lot has had enough')

      db.players.set(playerId, playerOf(db, playerId))
      const seed = this.ensureSeed(db, playerId, playerId)
      if (balance(db, playerAccount(playerId)) < stake) {
        throw new Rejected('insufficient_funds', 'not enough in the account for that stake')
      }

      const round: RoundRecord = {
        id: roundId,
        playerId,
        stake,
        seedCommitment: seed.commitment,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
        kicks: [],
        status: 'open',
        called: null,
        payout: 0,
        openedAt: Date.now(),
        closedAt: null,
      }

      /* The nonce is burned here, before the first kick, so a round that is
       * abandoned still consumes it. Reusing a nonce would mean two rounds with
       * the same keeper - which a player who kept their reveals could spot, and
       * would be right to call cheating. */
      db.seeds.set(seed.commitment, { ...seed, nonce: seed.nonce + 1 })
      db.rounds.set(round.id, round)
      db.openRounds.set(playerId, round.id)
      db.byPlayer.set(playerId, [...(db.byPlayer.get(playerId) ?? []), round.id])

      takeStake(db, `${key}:stake`, playerId, round.id, stake)

      return this.playerView(db, playerId)
    })
  }

  /**
   * Take a kick.
   *
   * The player supplies a zone and nothing else. Everything the outcome depends
   * on was fixed when the round opened, so there is nothing here to validate and
   * nothing to disagree about.
   */
  kick(playerId: string, roundId: string, zone: Zone, key: string, bribe = false): PlayerView {
    if (!ZONES.includes(zone)) throw new Rejected('bad_zone', `no such zone: ${zone}`)

    return this.store.transact(key, (db) => {
      const round = roundOf(db, roundId)
      if (round.playerId !== playerId) throw new Rejected('not_yours', 'that is not your round')
      if (round.status !== 'open') throw new Rejected('round_closed', 'that shootout is over')
      if (round.kicks.length >= MAX_KICKS) throw new Rejected('no_kicks_left', 'no kicks left')

      const who = playerOf(db, playerId)
      if (bribe && who.bribesLeft <= 0) throw new Rejected('no_bribes_left', 'he will not take your money again tonight')

      const seed = db.seeds.get(round.seedCommitment)!
      const at = roundFloats(seed, round)
      const index = round.kicks.length
      const straight = who.straightRounds > 0
      const rolls = rollsFor(at, index, straight)
      const shown = rolls.tell ? rolls.dive : null

      const played = resolveKick(rolls, zone, bribe)
      const record: KickRecord = {
        zone,
        result: played.result,
        dive: played.dive,
        shown,
        stole: played.stole,
        straight,
        bribed: bribe,
        bought: played.bought,
        /* Priced against what the player knew AND what they did. Paying him raises the
         * probability, so it lowers the multiplier by the same factor - the money buys
         * survival on this ladder and never edge. */
        p: pGoalFor(zone, shown, bribe),
      }
      const kicks = [...round.kicks, record]

      if (bribe) {
        db.players.set(playerId, { ...who, bribesLeft: who.bribesLeft - 1 })
        /* Trying costs heat. Trying and being refused costs more, because he mentions
         * it to the man running the lot. */
        stir(db, playerId, played.bought ? HEAT_BRIBE : HEAT_BRIBE + HEAT_BRIBE_FAILED)
      }

      if (played.result !== 'goal') {
        /*
         * Lost. The stake already moved when the round opened, so closing the round is
         * the whole settlement and there is no second money move to lose. Losses being
         * free of a payout leg is not an optimisation - it is why a crash on a losing
         * kick cannot cost anybody anything.
         *
         * A save stays callable: the round is closed but `called` is still null, and
         * call() is the only thing that can pay on it.
         */
        db.rounds.set(round.id, { ...round, kicks, status: 'busted', payout: 0, closedAt: Date.now() })
        db.openRounds.delete(playerId)
        endRound(db, playerId, kicks.some((k) => k.bribed))
        return this.playerView(db, playerId)
      }

      const survived = [...survivedOf(round), record.p]

      if (kicks.length >= MAX_KICKS) {
        /* The ladder is finished, so there is nothing left to decide and the round pays
         * itself out. Leaving it open with no legal move would be a round that can only
         * be closed by a timeout job. */
        this.settle(db, { ...round, kicks }, survived, `${key}:payout`)
        endRound(db, playerId, kicks.some((k) => k.bribed))
        return this.playerView(db, playerId)
      }

      db.rounds.set(round.id, { ...round, kicks })
      return this.playerView(db, playerId)
    })
  }

  /**
   * Call him for coming off his line.
   *
   * Allowed once, on a save, after the round has closed - which is exactly when a
   * player has seen what they need to see. The house does not say whether he was off
   * his line; the animation showed it and the player either read it or did not.
   *
   * Right: the round is voided and the ante comes back, in one transaction with the
   * status change like every other payout here. Wrong: nothing moves, and the heat
   * does. Either way it is one call and the round remembers it.
   */
  call(playerId: string, roundId: string, key: string): PlayerView {
    return this.store.transact(key, (db) => {
      const round = roundOf(db, roundId)
      if (round.playerId !== playerId) throw new Rejected('not_yours', 'that is not your round')
      if (round.called !== null) throw new Rejected('already_called', 'you only get one')
      if (round.status !== 'busted') throw new Rejected('nothing_to_call', 'there is nothing to call')

      const last = round.kicks.at(-1)
      if (last === undefined || last.result !== 'saved') {
        throw new Rejected('nothing_to_call', 'he only cheats on the ones he saves')
      }

      if (!last.stole) {
        db.rounds.set(round.id, { ...round, called: 'wrong' })
        stir(db, playerId, HEAT_CALL_WRONG)
        return this.playerView(db, playerId)
      }

      /*
       * Nothing is paid, and that is the design rather than a shortfall. Every version of
       * paying for this overshoots - see STRAIGHT_ROUNDS in game/table.ts for the two
       * that were tried and the exact figures that killed them. What a correct call buys
       * is that the next few rounds are the game the board advertises, which cannot
       * exceed the clean return because it IS the clean return.
       */
      db.rounds.set(db.rounds.get(round.id)!.id, { ...round, called: 'right', status: 'voided' })
      db.players.set(playerId, { ...playerOf(db, playerId), straightRounds: STRAIGHT_ROUNDS })
      return this.playerView(db, playerId)
    })
  }

  /** Walk away with what is on the board. Payout credited and round closed together. */
  cashOut(playerId: string, roundId: string, key: string): PlayerView {
    return this.store.transact(key, (db) => {
      const round = roundOf(db, roundId)
      if (round.playerId !== playerId) throw new Rejected('not_yours', 'that is not your round')
      if (round.status !== 'open') throw new Rejected('round_closed', 'that shootout is over')

      const survived = survivedOf(round)
      if (survived.length === 0) throw new Rejected('nothing_to_take', 'score one first')

      this.settle(db, round, survived, `${key}:payout`)
      endRound(db, playerId, round.kicks.some((k) => k.bribed))
      return this.playerView(db, playerId)
    })
  }

  /**
   * Payout credited and round closed in ONE transaction.
   *
   * Private, and there is no public way to do either half. If a future feature
   * needs to pay a player, it comes through here or it does not happen.
   */
  private settle(db: Db, round: RoundRecord, survived: readonly number[], key: string): void {
    const payout = payoutFor(round.stake, multiplierAfter(survived))
    db.rounds.set(round.id, { ...round, status: 'cashed', payout, closedAt: Date.now() })
    db.openRounds.delete(round.playerId)
    if (payout > 0) payOut(db, key, round.playerId, round.id, payout)
  }

  /* ------------------------------------------------------------------ views */

  view(playerId: string): PlayerView {
    return this.playerView(this.store.read(), playerId)
  }

  /**
   * The redaction. The only function that turns server state into something a
   * client is allowed to see, so the rule about live seeds has exactly one place
   * to be enforced and exactly one place to be tested.
   */
  private playerView(db: Db, playerId: string): PlayerView {
    const seed = db.live.has(playerId) ? seedOf(db, playerId) : null

    const mine = db.byPlayer.get(playerId) ?? []
    const history = mine
      .slice(-HISTORY)
      .reverse()
      .map((id) => this.roundView(db, roundOf(db, id)))

    const revealed = [...db.seeds.values()]
      .filter((s) => s.playerId === playerId && s.retired)
      .map((s) => ({ commitment: s.commitment, serverSeed: s.serverSeed, clientSeed: s.clientSeed, rounds: s.nonce }))
      .reverse()

    const who = playerOf(db, playerId)

    return {
      playerId,
      balance: balance(db, playerAccount(playerId)),
      round: history[0] ?? null,
      openingBoard: boardFor([], null),
      heat: who.heat,
      bribesLeft: who.bribesLeft,
      /** Rounds he will keep his feet on the line for. Earned by calling him out. */
      straightRounds: who.straightRounds,
      runOff: who.runOff,
      history,
      fair: {
        commitment: seed?.commitment ?? '',
        clientSeed: seed?.clientSeed ?? '',
        nonce: seed?.nonce ?? 0,
        /* Null while live. Not "omitted if live" - a field that is sometimes
         * absent invites a client that reads it when it is there. */
        serverSeed: null,
      },
      revealed,
    }
  }

  private roundView(db: Db, round: RoundRecord): RoundView {
    const seed = db.seeds.get(round.seedCommitment)!
    const taken = round.kicks.length
    const survived = survivedOf(round)
    const open = round.status === 'open'

    const shown = open ? shownFor(roundFloats(seed, round), taken) : null

    /*
     * A closed round prices the board from scratch rather than from where it
     * stopped. Leaving the old ladder on it means a finished round advertises what an
     * eleventh kick would have paid - an offer that does not exist, which is the
     * worst kind of cosmetic bug because it reads as a promise.
     */
    const board = boardFor(open ? survived : [], shown)

    const multiplier = survived.length === 0 ? 0 : multiplierAfter(survived)

    return {
      id: round.id,
      stake: round.stake,
      status: round.status,
      kicks: round.kicks,
      taken,
      regulation: REGULATION_KICKS,
      maxKicks: MAX_KICKS,
      multiplier: displayMultiplier(multiplier),
      /* What walking away is worth right now, so zero once there is no longer a
       * now. A closed round keeps its multiplier - "you were at 2.40x and lost
       * it" is information a player is entitled to - but it is not an offer. */
      cashOut: open && survived.length > 0 ? payoutFor(round.stake, multiplier) : 0,
      shown,
      board,
      payout: round.payout,
      called: round.called,
      /*
       * A save with no call made on it. True whether or not he was actually off his
       * line, and that is the whole mechanic: the house does not tell you, the picture
       * did, and a wrong call costs heat.
       */
      callable: round.status === 'busted' && round.called === null && round.kicks.at(-1)?.result === 'saved',
      fair: {
        commitment: round.seedCommitment,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        /* Revealed only once the seed is retired, which is the player's call. */
        serverSeed: seed.retired ? seed.serverSeed : null,
      },
    }
  }
}

/* --------------------------------------------------------- the verifier */

export interface Recomputed {
  kick: number
  dive: Dive
  tell: boolean
  /**
   * He was off his line on this kick.
   *
   * The most useful line in the whole panel, and the reason it is here: a player who
   * was saved and did not call it can now see, for certain, that he was cheating and
   * they missed it. That is a lesson they can take to the next round, which is what
   * separates a read you can practise from a guess.
   */
  stole: boolean
  /** What the player shot at, when they got this far. */
  zone: Zone | null
  /** Whether they paid him, and whether the money took. */
  bribed: boolean
  bought: boolean
  result: 'goal' | 'saved' | 'missed' | 'not taken'
}

/** What the player did on a kick, which the verifier needs in order to reproduce it. */
export interface Taken {
  zone: Zone
  bribed: boolean
}

/**
 * What the player runs, on their own machine, on the revealed seed.
 *
 * Deliberately independent of the House: it takes strings and returns the whole round,
 * including the kicks that were never taken. A player who walked after three goals can
 * see where he was going on the fourth, which is the part that turns "provably fair"
 * from a badge into something anybody can feel.
 *
 * It needs the player's own actions as well as the seed, because the corner and the
 * money are inputs to the outcome - which is the point of the design rather than a
 * weakness in it. The seed fixes what he was going to do; the player decides what gets
 * tested against it.
 */
export function recompute(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  taken: readonly (Taken | null)[],
): Recomputed[] {
  const at = floatsOf(floatsAt(serverSeed, clientSeed, nonce, FLOATS_PER_ROUND))
  return Array.from({ length: MAX_KICKS }, (_, i) => {
    const rolls = rollsFor(at, i)
    const did = taken[i] ?? null
    const played = did === null ? null : resolveKick(rolls, did.zone, did.bribed)
    return {
      kick: i + 1,
      /* The dive he would have made, or the one he actually made once paid. */
      dive: played?.dive ?? rolls.dive,
      tell: rolls.tell,
      stole: rolls.steals,
      zone: did?.zone ?? null,
      bribed: did?.bribed ?? false,
      bought: played?.bought ?? false,
      result: played?.result ?? 'not taken',
    }
  })
}

/** Does the revealed seed match what was published before the round. */
export const verifyCommitment = (serverSeed: string, commitment: string): boolean => commit(serverSeed) === commitment

export { TABLE, ZONES }
