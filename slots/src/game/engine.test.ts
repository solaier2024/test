import { describe, expect, it } from 'vitest'
import {
  CLEAN_BELL_RATE,
  MACHINES,
  PROOF,
  START_BANK,
  callHouse,
  cool,
  machineById,
  opening,
  payout,
  pull,
  returnToPlayer,
  rng,
  settle,
  shortChanged,
  windowAt,
} from './engine'
import { FACES, STOPS, type Face, type Machine } from './types'

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
