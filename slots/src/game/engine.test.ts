import { describe, expect, it } from 'vitest'
import {
  CLEAN_BELL_RATE,
  MACHINES,
  PROOF,
  SETTLEMENT,
  STAKES,
  START_BANK,
  callHouse,
  cool,
  machineById,
  opening,
  payout,
  pull,
  reactionTo,
  returnToPlayer,
  rng,
  setStake,
  settle,
  settlementFor,
  shortChanged,
  windowAt,
} from './engine'
import { createTable, type Table } from './table'
import { FACES, STOPS, type Face, type Machine, type Outcome, type Reaction } from './types'

const honest = machineById('honest')
const drummer = machineById('drummer')
const bandido = machineById('bandido')

/** Every band with the bias switched off, for the invariance tests. */
const straight = (m: Machine): Machine => ({ ...m, id: `${m.id}-straight`, nearMissBias: 0 })

function run(machine: Machine, spins: number, seed = 7) {
  const next = rng(seed)
  let coinsOut = 0
  let bellsOnThird = 0
  let nearMisses = 0
  let teases = 0
  /** Teases the third reel did not complete: the only ones it could miss by one. */
  let missable = 0
  for (let i = 0; i < spins; i++) {
    const out = pull(machine, next)
    coinsOut += out.coins
    if (out.bellOnThird) bellsOnThird++
    if (out.nearMiss) nearMisses++
    if (out.tease) teases++
    if (out.tease && out.line[2] !== out.line[0]) missable++
  }
  return { coinsOut, bellsOnThird, nearMisses, teases, missable, spins }
}

describe('the bands', () => {
  it('are twenty stops of real symbols', () => {
    for (const m of MACHINES) {
      for (const band of m.bands) {
        expect(band).toHaveLength(STOPS)
        for (const face of band) expect(FACES).toContain(face)
      }
    }
  })

  it('carry the bells the payout card implies, or fewer', () => {
    const bells = (band: Face[]) => band.filter((x) => x === 'bell').length
    expect(bells(honest.bands[2])).toBe(2)
    expect(bells(drummer.bands[2])).toBe(1)
    expect(bells(bandido.bands[2])).toBe(0)
    // The first two are the same on every machine in the house. The house only
    // ever touches the band the player is watching hardest.
    expect(drummer.bands[0]).toEqual(honest.bands[0])
    expect(bandido.bands[1]).toEqual(honest.bands[1])
  })

  it('puts a bell in the honest third window three times in ten', () => {
    let seen = 0
    for (let i = 0; i < STOPS; i++) if (windowAt(honest.bands[2], i).includes('bell')) seen++
    expect(seen / STOPS).toBeCloseTo(CLEAN_BELL_RATE, 10)
  })

  it('cannot pay the hundred on the crooked machine, whatever the card says', () => {
    expect(returnToPlayer(bandido)).toBeGreaterThan(0)
    let jackpots = 0
    for (let i = 0; i < STOPS; i++)
      for (let j = 0; j < STOPS; j++)
        for (let k = 0; k < STOPS; k++)
          if (payout([bandido.bands[0][i], bandido.bands[1][j], bandido.bands[2][k]]) === 100) jackpots++
    expect(jackpots).toBe(0)
  })
})

describe('the payout card', () => {
  it('reads the same on all three machines', () => {
    // Nothing machine-specific is allowed into payout(): the card is the card.
    expect(payout(['bell', 'bell', 'bell'])).toBe(100)
    expect(payout(['shoe', 'shoe', 'shoe'])).toBe(30)
    expect(payout(['star', 'star', 'star'])).toBe(20)
    expect(payout(['spade', 'spade', 'spade'])).toBe(10)
    expect(payout(['heart', 'heart', 'heart'])).toBe(10)
    expect(payout(['bell', 'bell', 'heart'])).toBe(5)
    expect(payout(['bell', 'star', 'heart'])).toBe(1)
    expect(payout(['star', 'spade', 'heart'])).toBe(0)
  })

  it('hides the whole edge in the bands', () => {
    const rtp = MACHINES.map(returnToPlayer)
    expect(rtp[0]).toBeGreaterThan(rtp[1])
    expect(rtp[1]).toBeGreaterThan(rtp[2])
    expect(rtp[0]).toBeGreaterThan(0.85)
    expect(rtp[0]).toBeLessThan(0.95)
    expect(rtp[2]).toBeLessThan(0.72)
  })
})

/*
 * The load-bearing test of the whole table. The near-miss bias is meant to be
 * invisible in the money - that is what makes it worth doing and what makes it
 * hard to catch. If it ever starts moving the take, the readout on the left
 * becomes the wrong measurement and the game quietly stops being about what it
 * says it is about.
 */
describe('the near-miss bias', () => {
  it('does not touch the payline over all eight thousand rests', () => {
    for (const m of MACHINES) {
      expect(returnToPlayer(m)).toBeCloseTo(returnToPlayer(straight(m)), 12)
    }
  })

  it('pays the same over a long night as the same machine without it', () => {
    for (const m of [drummer, bandido]) {
      const biased = run(m, 60000, 11)
      const clean = run(straight(m), 60000, 11)
      const rtp = returnToPlayer(m)
      expect(biased.coinsOut / biased.spins).toBeCloseTo(rtp, 1)
      expect(clean.coinsOut / clean.spins).toBeCloseTo(rtp, 1)
    }
  })

  it('is the only thing that changes, and it changes a lot', () => {
    const biased = run(bandido, 40000, 3)
    const clean = run(straight(bandido), 40000, 3)
    expect(biased.nearMisses / biased.missable).toBeGreaterThan(0.85)
    expect(clean.nearMisses / clean.missable).toBeLessThan(0.5)
  })

  it('leaves the honest machine alone', () => {
    expect(honest.nearMissBias).toBe(0)
    const a = run(honest, 20000, 5)
    const b = run(straight(honest), 20000, 5)
    expect(a).toEqual(b)
  })
})

/*
 * The crowd is the whole opponent on this table, so "the room reacted" is not
 * a decoration that can be checked by eye - it is the readout. A room that
 * cheers on a schedule rather than on an outcome is a fake room, and the
 * failure is invisible from the outside because the noise is the same noise.
 *
 * This is one end of that wire; scripts/verify-audio.mjs is the other, and
 * measures that the sound which arrives is the one the line names. Between
 * them: the right reaction is chosen, and the chosen reaction is what you
 * hear.
 */
describe('what the room does about it', () => {
  /** How good the room's answer is. A gasp and a groan both pay nothing. */
  const RANK: Record<Reaction, number> = { sigh: 0, gasp: 0, murmur: 1, cheer: 2, roar: 3, jeer: 0 }

  const outcome = (coins: number, nearMiss = false): Outcome => ({
    stops: [0, 0, 0],
    windows: [
      ['shoe', 'shoe', 'shoe'],
      ['shoe', 'shoe', 'shoe'],
      ['shoe', 'shoe', 'shoe'],
    ],
    line: ['shoe', 'shoe', 'shoe'],
    coins,
    tease: nearMiss,
    nearMiss,
    bellOnThird: false,
  })

  /* The boundaries, named, because they are the whole shape of the thing: the
   * room only comes off the floor for the jackpot band, and a near miss is
   * read as a loss with a story rather than as a win. */
  it('answers the money at every boundary', () => {
    expect(reactionTo(outcome(100))).toBe('roar')
    expect(reactionTo(outcome(30))).toBe('roar')
    expect(reactionTo(outcome(20))).toBe('roar')
    expect(reactionTo(outcome(19))).toBe('cheer')
    expect(reactionTo(outcome(10))).toBe('cheer')
    expect(reactionTo(outcome(5))).toBe('cheer')
    expect(reactionTo(outcome(4))).toBe('murmur')
    expect(reactionTo(outcome(1))).toBe('murmur')
    expect(reactionTo(outcome(0))).toBe('sigh')
    expect(reactionTo(outcome(0, true))).toBe('gasp')
  })

  /*
   * A near miss outranks a coin back but never a win, and that ordering is
   * the reading of the machine rather than an accident of the if-chain. One
   * bell pays a single coin; a pull that hands you one coin and stops one row
   * short of a hundred is not a small win the room mutters through, it is the
   * near miss with salt on it, and the room is watching the band.
   */
  it('lets a near miss outrank a coin back, but never a win', () => {
    expect(reactionTo(outcome(1, true))).toBe('gasp')
    expect(reactionTo(outcome(4, true))).toBe('gasp')
    expect(reactionTo(outcome(5, true))).toBe('cheer')
    expect(reactionTo(outcome(20, true))).toBe('roar')
  })

  /*
   * The one that matters. Over a long night on every machine the room is
   * never wrong about the money: it never celebrates a loss, never groans at
   * a win, and - setting the near misses aside, which are allowed to read
   * above their payout by the rule above - more coins never buy a smaller
   * reaction than fewer did.
   */
  it('never contradicts the money, over thirty thousand pulls a machine', () => {
    for (const m of MACHINES) {
      const next = rng(23)
      /** The worst and best reaction seen for each payout, near misses aside. */
      const seen = new Map<number, { lo: number; hi: number }>()
      for (let i = 0; i < 30000; i++) {
        const out = pull(m, next)
        const kind = reactionTo(out)
        if (out.coins === 0) expect(kind === 'gasp' || kind === 'sigh').toBe(true)
        else if (out.coins < 5) expect(kind === 'gasp' || kind === 'murmur').toBe(true)
        else expect(kind === 'cheer' || kind === 'roar').toBe(true)
        if (out.nearMiss) continue
        const rank = RANK[kind]
        const at = seen.get(out.coins) ?? { lo: rank, hi: rank }
        seen.set(out.coins, { lo: Math.min(at.lo, rank), hi: Math.max(at.hi, rank) })
      }
      const byCoins = [...seen.entries()].sort((a, b) => a[0] - b[0])
      for (let i = 1; i < byCoins.length; i++) {
        expect(byCoins[i][1].lo).toBeGreaterThanOrEqual(byCoins[i - 1][1].hi)
      }
    }
  })

  /* A reaction nobody has ever heard is a reaction nobody has ever checked,
   * which is exactly where the crowd's level went missing for as long as it
   * did. All five that a pull can produce have to be reachable by playing. */
  it('uses all five of the reactions a pull can cause', () => {
    const next = rng(4)
    const seen = new Set<Reaction>()
    for (let i = 0; i < 20000; i++) seen.add(reactionTo(pull(bandido, next)))
    expect([...seen].sort()).toEqual(['cheer', 'gasp', 'murmur', 'roar', 'sigh'])
  })

  /*
   * And the gaff is audible without being profitable, which is the whole idea
   * of the machine said in the room's voice.
   *
   * Stated exactly rather than by counting two runs. The walk only ever moves
   * the third band between stops carrying the same centre symbol, so for any
   * pull it takes, the payline and the payout are bit for bit what they would
   * have been and the single thing it can flip is nearMiss. The question is
   * therefore whether flipping nearMiss on its own can move a reaction across
   * the line between a win and a loss, and the answer has to be no.
   *
   * Counting two runs cannot answer it: the biased machine draws from the rng
   * one extra time on every tease, so after the first one the two runs are
   * looking at different pulls and nothing is comparable but rates.
   */
  it('cannot change what the room does about a win', () => {
    for (const coins of [0, 1, 2, 3, 4, 5, 10, 19, 20, 30, 100]) {
      const quiet = reactionTo(outcome(coins, false))
      const teased = reactionTo(outcome(coins, true))
      if (coins >= 5) expect(teased).toBe(quiet)
      else expect(teased).toBe('gasp')
    }
  })

  /* The other half of it, which has to be counted: the crooked room really
   * does gasp where the straight one would have groaned, often enough for a
   * player on a stool to feel it and be wrong about why. */
  it('makes the crooked room gasp where a straight one groans', () => {
    const gaspShare = (m: Machine) => {
      const next = rng(31)
      let gasps = 0
      let unpaid = 0
      for (let i = 0; i < 40000; i++) {
        const kind = reactionTo(pull(m, next))
        if (kind === 'gasp') gasps++
        if (kind === 'gasp' || kind === 'sigh' || kind === 'murmur') unpaid++
      }
      return gasps / unpaid
    }
    expect(gaspShare(bandido)).toBeGreaterThan(gaspShare(straight(bandido)) * 1.8)
    expect(gaspShare(honest)).toBeLessThan(gaspShare(bandido) / 1.8)
  })
})

describe('the count', () => {
  const evidenceAfter = (m: Machine, spins: number, seed: number) => {
    const next = rng(seed)
    let session = opening(m)
    for (let i = 0; i < spins; i++) {
      session = settle({ ...session, bank: START_BANK, heat: 0 }, pull(m, next))
    }
    return session.evidence
  }

  it('clears the bar on the crooked machine inside a stack of coins', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(evidenceAfter(bandido, 30, seed)).toBeGreaterThan(PROOF)
    }
  })

  it('never clears it on a straight one', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(evidenceAfter(honest, 400, seed)).toBeLessThan(PROOF)
    }
  })

  it('leans the right way on the thin band, but makes you work for it', () => {
    expect(evidenceAfter(drummer, 40, 9)).toBeLessThan(PROOF)
    const long = [1, 2, 3, 4].map((s) => evidenceAfter(drummer, 600, s))
    expect(Math.min(...long)).toBeGreaterThan(PROOF)
  })

  it('counts a bell anywhere in the third window, not just on the line', () => {
    const next = rng(21)
    let onLine = 0
    let anywhere = 0
    for (let i = 0; i < 4000; i++) {
      const out = pull(honest, next)
      if (out.line[2] === 'bell') onLine++
      if (out.bellOnThird) anywhere++
    }
    expect(anywhere).toBeGreaterThan(onLine * 2)
  })
})

describe('calling the house', () => {
  const primed = (m: Machine, evidence: number) => ({ ...opening(m), evidence })

  it('pays out when the tally can show it', () => {
    const r = callHouse(primed(bandido, PROOF + 0.1))
    expect(r.won).toBe(true)
    expect(r.session.ended).toBe('proved')
    expect(r.session.bank).toBeGreaterThan(START_BANK)
  })

  it('is refused when you are right but cannot show it', () => {
    const r = callHouse(primed(bandido, PROOF - 0.1))
    expect(r.won).toBe(false)
    expect(r.session.bank).toBeLessThan(START_BANK)
    expect(r.session.heat).toBeGreaterThan(0)
  })

  it('is refused on a straight machine however long you sat there', () => {
    const r = callHouse(primed(honest, PROOF * 4))
    expect(r.won).toBe(false)
    expect(r.wrongMachine).toBe(true)
  })

  it('works on the thin band too: short is short', () => {
    expect(shortChanged(drummer)).toBe(true)
    expect(callHouse(primed(drummer, PROOF + 1)).won).toBe(true)
  })
})

/*
 * The stake is the only number the player sets, and it is a decision rather
 * than a variance dial only because the money and the count do not move
 * together. Each half is pinned separately, because it would be very easy to
 * "simplify" one into the other and quietly turn the choice into a slider.
 */
describe('the bet', () => {
  it('pays a straight multiple, and does not touch the edge', () => {
    for (const m of MACHINES) {
      const rtp = returnToPlayer(m)
      for (const stake of STAKES) {
        const next = rng(17)
        let out = 0
        for (let i = 0; i < 40000; i++) out += pull(m, next, stake).coins
        expect(out / (40000 * stake)).toBeCloseTo(rtp, 1)
      }
    }
  })

  /* Same rests, same everything, times the coins in. Not a re-roll at a
   * different size - the machine does not know what you put in it. */
  it('is the same pull at a different price', () => {
    const one = rng(8)
    const three = rng(8)
    for (let i = 0; i < 2000; i++) {
      const a = pull(bandido, one, 1)
      const b = pull(bandido, three, 3)
      expect(b.stops).toEqual(a.stops)
      expect(b.coins).toBe(a.coins * 3)
      expect(b.nearMiss).toBe(a.nearMiss)
      expect(b.bellOnThird).toBe(a.bellOnThird)
    }
  })

  /*
   * And the count is flat. This is the whole trade: a pull is one look at the
   * third window whatever it cost, so betting three buys the same proof at
   * three times the price. If this ever becomes proportional the stake stops
   * being a decision and becomes a difficulty setting.
   */
  it('buys no more evidence for three coins than for one', () => {
    /* A purse deep enough that the night cannot end, so the only difference
     * between the two runs is the price. Writing this without that is how the
     * first version of this test failed: the stake-three purse ran down, the
     * stake came off it on its own, and the last few pulls were at one coin. */
    const ran = (stake: number) => {
      let session = { ...opening(bandido), stake, bank: 1e6 }
      const next = rng(12)
      for (let i = 0; i < 40; i++) {
        session = { ...settle(session, pull(bandido, next, stake)), bank: 1e6 }
      }
      return session
    }
    const cheap = ran(1)
    const dear = ran(3)
    expect(dear.evidence).toBe(cheap.evidence)
    expect(dear.bells).toBe(cheap.bells)
    expect(dear.staked).toBe(cheap.staked * 3)
  })

  /*
   * The other half of the trade, and the one that decides nights: a count is
   * made of pulls, and the purse is how many pulls you have. This is the
   * whole reason the stake is a choice rather than a preference.
   *
   * Measured rather than asserted loosely, because the interesting part is
   * that the size of the effect depends on the machine. The bandido gives
   * itself away inside fifty pulls, so betting big on it costs nothing; the
   * drummer is the one that takes all night, and there it costs most of it.
   */
  it('spends the pulls a count is made of', () => {
    const nights = (m: Machine, stake: number) => {
      let pulls = 0
      let reached = 0
      const N = 200
      for (let s = 0; s < N; s++) {
        let session = { ...opening(m), stake }
        const next = rng(1000 + s)
        let got = false
        while (session.phase !== 'over' && pulls < 1e6) {
          session = settle(session, pull(m, next, session.stake))
          pulls++
          if (session.evidence >= PROOF) got = true
        }
        if (got) reached++
      }
      return { pulls: pulls / N, proved: reached / N }
    }

    const cheap = nights(drummer, 1)
    const dear = nights(drummer, 3)
    // A night about a third as long.
    expect(dear.pulls).toBeLessThan(cheap.pulls * 0.45)
    // And most of the proofs gone with it.
    expect(cheap.proved).toBeGreaterThan(0.75)
    expect(dear.proved).toBeLessThan(cheap.proved * 0.6)

    /* And the counter-example, which is the reason to have a choice at all:
     * on the machine with no bells on the band, the count clears long before
     * the purse does, so the same bet costs nothing. */
    expect(nights(bandido, 1).proved).toBe(1)
    expect(nights(bandido, 3).proved).toBe(1)
  })

  /*
   * Heat is not part of this, and the intuition that it should be is wrong in
   * the opposite direction: a bigger stake ends the night sooner, so there
   * are fewer wins and fewer calls in it and being thrown out gets LESS
   * likely. Pinned because "big bettors draw attention" is exactly the kind
   * of plausible thing somebody would add later.
   */
  it('does not get you thrown out any faster', () => {
    const thrownOut = (stake: number) => {
      let thrown = 0
      for (let s = 0; s < 200; s++) {
        let session = { ...opening(honest), stake }
        const next = rng(1000 + s)
        while (session.phase !== 'over') session = settle(session, pull(honest, next, session.stake))
        if (session.ended === 'thrown-out') thrown++
      }
      return thrown
    }
    expect(thrownOut(3)).toBeLessThan(thrownOut(1))
  })

  it('cannot be set to something the purse cannot cover, or mid-spin', () => {
    const poor = { ...opening(honest), bank: 2 }
    expect(setStake(poor, 3).stake).toBe(1)
    expect(setStake(poor, 2).stake).toBe(2)
    expect(setStake({ ...opening(honest), phase: 'spinning' as const }, 3).stake).toBe(1)
    expect(setStake(opening(honest), 7).stake).toBe(1)
  })

  /* Rather than ending a night that still has coins in it. */
  it('comes down on its own when the purse can no longer cover it', () => {
    const next = rng(2)
    let session = { ...opening(honest), stake: 3, bank: 5 }
    session = settle(session, pull(honest, next, 3))
    if (session.bank < 3 && session.bank >= 1) expect(session.stake).toBeLessThanOrEqual(session.bank)
    expect(session.stake).toBeGreaterThanOrEqual(1)
  })

  /*
   * The settlement follows the level you were playing at, so that proving a
   * machine crooked after a night of three-coin pulls is worth three times
   * proving it after a night of one-coin pulls - and so that the obvious
   * exploit does not work. One big bet on the last pull moves an average over
   * forty by almost nothing.
   */
  describe('the settlement', () => {
    const played = (stake: number, pulls: number) => ({
      ...opening(bandido),
      evidence: PROOF + 0.1,
      pulls,
      staked: stake * pulls,
    })

    it('is paid at the level the night was played at', () => {
      expect(settlementFor(played(1, 40))).toBe(SETTLEMENT)
      expect(settlementFor(played(3, 40))).toBe(SETTLEMENT * 3)
      expect(callHouse(played(3, 40)).session.bank).toBe(START_BANK + SETTLEMENT * 3)
    })

    it('cannot be yanked up on the last pull', () => {
      const quiet = played(1, 40)
      const andOneBigOne = { ...quiet, pulls: 41, staked: quiet.staked + 3 }
      expect(settlementFor(andOneBigOne)).toBeLessThan(SETTLEMENT * 1.1)
    })

    it('pays the minimum to somebody who proved it without playing', () => {
      expect(settlementFor({ ...opening(bandido), pulls: 0, staked: 0 })).toBe(SETTLEMENT)
    })
  })
})

describe('the night', () => {
  it('ends when the coins do', () => {
    let session = opening(honest)
    const next = rng(4)
    for (let i = 0; i < 4000 && session.phase !== 'over'; i++) session = settle(session, pull(honest, next))
    expect(session.phase).toBe('over')
    expect(['broke', 'thrown-out']).toContain(session.ended)
  })

  it('lets the room forget', () => {
    const hot = { ...opening(honest), heat: 0.5 }
    expect(cool(hot, 10).heat).toBeLessThan(0.5)
    expect(cool(hot, 10000).heat).toBe(0)
    expect(cool({ ...hot, phase: 'over' as const }, 10).heat).toBe(0.5)
  })

  it('throws you out for being watched, not for being poor', () => {
    const watched = callHouse({ ...opening(bandido), heat: 0.8 })
    expect(watched.session.ended).toBe('thrown-out')
  })

  it('is the same night twice from the same seed', () => {
    const one = run(bandido, 500, 99)
    const two = run(bandido, 500, 99)
    expect(one).toEqual(two)
  })
})

/*
 * These are tests about one frame of the table's loop, not about the engine.
 *
 * The loop does two things in a pass - runs the beats of a pull that have come
 * due, then cools the room off - and both of them write the session. That is
 * fine as long as the second one sees what the first one wrote. It did not,
 * for a while, because the session lived in React state and the loop read it
 * through a ref that only refreshes on render. See table.ts.
 */
describe('one frame of the table', () => {
  /** A frame: whatever beats came due, and then the cooling tick. */
  const frame = (table: Table, beats: Array<(t: Table) => void>, seconds = 0.3) => {
    for (const beat of beats) beat(table)
    table.commit((s) => cool(s, seconds))
  }

  /* Real spins off the bandido, with the money forced, so these stay honest
   * outcomes if the shape of one ever changes. */
  const lose: Outcome = { ...pull(bandido, rng(11)), coins: 0, bellOnThird: false }
  const win: Outcome = { ...lose, coins: 20, bellOnThird: true }

  it('keeps a pull that resolves in the same frame as a cooling tick', () => {
    const start = { ...opening(bandido), heat: 0.5 }
    const table = createTable(start)
    frame(table, [(t) => t.commit((s) => settle(s, win))])
    expect(table.current.pulls).toBe(1)
    expect(table.current.bank).toBe(START_BANK - 1 + 20)
    expect(table.current.bells).toBe(1)
    /* The fix is not to drop the other writer: a frame is the two of them
     * composed, in order, and neither one is allowed to go missing. */
    expect(table.current).toEqual(cool(settle(start, win), 0.3))
  })

  it('keeps a raised stake that a cooling tick lands on top of', () => {
    const table = createTable({ ...opening(bandido), heat: 0.5 })
    frame(table, [(t) => t.commit((s) => setStake(s, 3))])
    expect(table.current.stake).toBe(3)
  })

  it('charges once for a pull however many writers ran that frame', () => {
    const table = createTable({ ...opening(bandido), heat: 0.5 })
    for (let i = 0; i < 10; i++) frame(table, [(t) => t.commit((s) => settle(s, lose))])
    expect(table.current.pulls).toBe(10)
    expect(table.current.bank).toBe(START_BANK - 10)
  })

  it('does not wake React when the engine says nothing happened', () => {
    const table = createTable(opening(bandido))
    let renders = 0
    table.subscribe(() => renders++)
    /* cool() of a cold room returns the identical object, and the loop calls it
     * four times a second for the whole night. */
    for (let i = 0; i < 100; i++) table.commit((s) => cool(s, 0.3))
    expect(renders).toBe(0)
    table.commit((s) => settle(s, lose))
    expect(renders).toBe(1)
  })
})
