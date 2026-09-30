/* The .ts on the import below is what lets scripts/odds.mjs run this file
 * straight through node's type stripping, with no build step and no second
 * copy of the bands living in a script. */
import { PAYS, STOPS, type Machine, type Outcome, type Reaction, type Session, type Face, type Window } from './types.ts'

/*
 * Everything the machine does, with no clock and no React in it, so the whole
 * table can be played ten thousand times in a test.
 */

/** Deterministic, so a run can be replayed and a test can assert on one. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const b = 'bell'
const s = 'shoe'
const t = 'star'
const p = 'spade'
const d = 'diamond'
const h = 'heart'

/*
 * The bands, written out stop by stop rather than generated, because the
 * neighbours matter as much as the counts: a near miss is a question about
 * which symbol sits next to which, and you cannot ask that of a histogram.
 */

const BAND_A: Face[] = [p, h, s, d, b, t, h, p, d, s, h, t, p, b, d, h, s, p, t, d]
const BAND_B: Face[] = [h, s, p, b, d, p, t, h, d, t, p, h, s, d, b, t, p, d, h, s]

/**
 * Two bells, and far enough apart that their windows do not overlap - so a bell
 * is somewhere in the third window on exactly six stops in twenty. That number
 * is the baseline the whole table is measured against.
 */
const BAND_C_CLEAN: Face[] = [s, h, t, p, s, t, d, h, d, p, d, p, h, s, d, t, b, h, p, b]

/** One bell. Thin, and legal, and invisible from the front of the machine. */
const BAND_C_THIN: Face[] = [t, p, h, s, d, p, t, h, d, h, d, t, s, p, s, p, h, d, h, b]

/**
 * No bell at all: the hundred coin prize on the card cannot be paid.
 *
 * The order is not arbitrary either. Every symbol on this band sits next to
 * every other symbol somewhere, which is what always leaves the bias a stop to
 * move to - so the third reel can miss by one all night without ever once
 * changing what it pays.
 */
const BAND_C_EMPTY: Face[] = [d, s, h, s, p, d, t, p, t, h, t, s, d, p, h, d, h, d, h, p]

export const MACHINES: Machine[] = [
  { id: 'honest', bands: [BAND_A, BAND_B, BAND_C_CLEAN], nearMissBias: 0 },
  { id: 'drummer', bands: [BAND_A, BAND_B, BAND_C_THIN], nearMissBias: 0.35 },
  { id: 'bandido', bands: [BAND_A, BAND_B, BAND_C_EMPTY], nearMissBias: 0.9 },
]

export const machineById = (id: string): Machine =>
  MACHINES.find((m) => m.id === id) ?? MACHINES[0]

const at = (band: Face[], i: number) => band[((i % STOPS) + STOPS) % STOPS]

export const windowAt = (band: Face[], stop: number): Window =>
  [at(band, stop - 1), at(band, stop), at(band, stop + 1)]

/* -------------------------------------------------------------- the payout */

export function payout(line: [Face, Face, Face]): number {
  const bells = line.filter((x) => x === 'bell').length
  if (line[0] === line[1] && line[1] === line[2]) {
    const three = PAYS.find((r) => r.of === line[0] && r.count === 3)
    if (three) return three.coins
    return PAYS.find((r) => r.of === 'suit')!.coins
  }
  const rule = PAYS.find((r) => r.of === 'bells' && r.count === bells)
  return rule ? rule.coins : 0
}

/* ------------------------------------------------------------ the near miss */

/**
 * Stops on the third band that keep the same centre symbol but put `want` next
 * to the line. Precomputed per band because it is asked on every tease.
 */
function teaseStops(band: Face[], want: Face, centre: Face): number[] {
  const out: number[] = []
  for (let i = 0; i < STOPS; i++) {
    if (band[i] !== centre) continue
    if (at(band, i - 1) === want || at(band, i + 1) === want) out.push(i)
  }
  return out
}

const teaseCache = new Map<string, number[]>()
function cachedTeaseStops(machine: Machine, want: Face, centre: Face): number[] {
  const key = `${machine.id}:${want}:${centre}`
  let hit = teaseCache.get(key)
  if (!hit) {
    hit = teaseStops(machine.bands[2], want, centre)
    teaseCache.set(key, hit)
  }
  return hit
}

/* ------------------------------------------------------------------ a pull */

/**
 * @param stake coins in. The card on the front pays per coin, so this is a
 *        straight multiplier on what comes out - and on what the room makes
 *        of it, because the crowd reads coins and not lines.
 */
export function pull(machine: Machine, next: () => number, stake = 1): Outcome {
  const stops: [number, number, number] = [
    Math.floor(next() * STOPS),
    Math.floor(next() * STOPS),
    Math.floor(next() * STOPS),
  ]

  const tease = at(machine.bands[0], stops[0]) === at(machine.bands[1], stops[1])
  const want = at(machine.bands[0], stops[0])
  const centre = at(machine.bands[2], stops[2])

  /*
   * The gaff. Only ever between stops carrying the same centre symbol, so the
   * payline is untouched and the night's take is identical to the honest one.
   * The only thing it moves is what the room can see beside the line - and a
   * test enumerates all 8000 stop combinations to hold this to it.
   */
  if (tease && centre !== want && machine.nearMissBias > 0 && next() < machine.nearMissBias) {
    const candidates = cachedTeaseStops(machine, want, centre)
    if (candidates.length) stops[2] = candidates[Math.floor(next() * candidates.length)]
  }

  const windows = [
    windowAt(machine.bands[0], stops[0]),
    windowAt(machine.bands[1], stops[1]),
    windowAt(machine.bands[2], stops[2]),
  ] as [Window, Window, Window]

  const line: [Face, Face, Face] = [windows[0][1], windows[1][1], windows[2][1]]

  return {
    stops,
    windows,
    line,
    coins: payout(line) * stake,
    tease,
    nearMiss: tease && line[2] !== want && (windows[2][0] === want || windows[2][2] === want),
    bellOnThird: windows[2].includes('bell'),
  }
}

/* --------------------------------------------------------------- the count */

/**
 * The only thing a player can actually measure from a stool.
 *
 * The card on the front implies the same band on all three reels, so a bell
 * should be somewhere in the third window a little under a third of the time.
 * Every pull is one sample of that, and this is the running weight of evidence
 * for "there are fewer bells on that band than the front of this machine says".
 *
 * It is a log likelihood ratio and not a percentage on purpose: a percentage
 * after nine pulls looks like knowledge and is not. This gets to the threshold
 * only when the count has earned it.
 */
export const CLEAN_BELL_RATE = 0.3
export const SHORT_BELL_RATE = 0.1
export const PROOF = 5

export const seenBell = Math.log(SHORT_BELL_RATE / CLEAN_BELL_RATE)
export const noBell = Math.log((1 - SHORT_BELL_RATE) / (1 - CLEAN_BELL_RATE))

export const shortChanged = (m: Machine) =>
  m.bands[2].filter((x) => x === 'bell').length < 2

/* ------------------------------------------------------------- the session */

export const START_BANK = 60
export const CALL_COST = 8

/*
 * Coins on a pull, and the one number the player sets.
 *
 * It is a decision rather than a variance dial because the money and the
 * count do not move together.
 *
 *   The money scales, and the edge does not. The card pays per coin, so three
 *   in is three times everything on it, and the return stays what the bands
 *   make it at every stake. "Bet more to win it back" does not work here and
 *   is not supposed to.
 *
 *   The count does not scale. A pull is one look at the third window whatever
 *   it cost, so evidence per pull is flat and evidence per COIN is divided by
 *   three.
 *
 *   And the purse is the clock. Three coins a pull is a night about a third
 *   as long - measured over 200 nights a machine by scripts/odds.mjs: 168
 *   pulls down to 53 on the bandido, 185 down to 60 on the drummer. Proving a
 *   machine is short of bells takes pulls and nothing else, so spending them
 *   faster is spending the thing the proof is made of.
 *
 * What makes that a choice and not just a worse option is the settlement,
 * which is paid at the level the night was played at. So the stake buys a
 * bigger prize with a smaller chance of collecting it, and how much smaller
 * depends on the machine, which is the good part: the bandido gives itself
 * away inside about twenty pulls, so on that one every stake reaches the
 * proof and the bet is close to free money. The drummer takes most of a night
 * to say what is wrong with it, and there it is the whole game - 83.5% of
 * one-coin nights get to the proof and 32% of three-coin ones do.
 *
 * Heat, notably, is NOT part of this. The intuition that a big bettor draws
 * more attention is wrong in the numbers, and in the opposite direction:
 * higher stakes end the night sooner, which means fewer wins and fewer calls,
 * so being thrown out gets LESS likely, not more. On the honest machine 38%
 * of one-coin nights end with the coat coming over, against 13% at three.
 */
export const STAKES = [1, 2, 3] as const
export const MIN_STAKE = STAKES[0]

/**
 * What the house hands back when the room makes it hand something back, per
 * coin the player was putting in.
 *
 * Scaled by the average stake over the night rather than the stake showing
 * when you call, which would just be a lever to yank on the last pull: the
 * house settles at the level you were playing at, and one big bet at the end
 * moves that average by nothing.
 */
export const SETTLEMENT = 45

export function settlementFor(session: Session): number {
  const average = session.pulls > 0 ? session.staked / session.pulls : MIN_STAKE
  return Math.round(SETTLEMENT * average)
}

export function opening(machine: Machine): Session {
  return {
    machine,
    bank: START_BANK,
    stake: MIN_STAKE,
    staked: 0,
    pulls: 0,
    bells: 0,
    evidence: 0,
    heat: 0,
    best: 0,
    phase: 'ready',
    ended: null,
  }
}

/** Only between pulls, and never more than the purse can cover. */
export function setStake(session: Session, stake: number): Session {
  if (session.phase !== 'ready') return session
  if (!STAKES.includes(stake as (typeof STAKES)[number])) return session
  if (stake > session.bank) return session
  return { ...session, stake }
}

/** Heat from a pull: winning loudly is what gets you looked at. */
const heatFor = (coins: number) => (coins >= 20 ? 0.1 : coins >= 5 ? 0.05 : 0)

export function settle(session: Session, out: Outcome): Session {
  const bank = session.bank - session.stake + out.coins
  const heat = Math.min(1, session.heat + heatFor(out.coins))
  const next: Session = {
    ...session,
    bank,
    staked: session.staked + session.stake,
    /* The purse can no longer cover what is set. Come down to what it can,
     * rather than ending a night that still has coins in it. */
    stake: Math.min(session.stake, Math.max(MIN_STAKE, bank)),
    pulls: session.pulls + 1,
    bells: session.bells + (out.bellOnThird ? 1 : 0),
    evidence: session.evidence + (out.bellOnThird ? seenBell : noBell),
    heat,
    best: Math.max(session.best, out.coins),
    phase: 'ready',
    ended: null,
  }
  if (heat >= 1) return { ...next, phase: 'over', ended: 'thrown-out' }
  if (bank < MIN_STAKE) return { ...next, phase: 'over', ended: 'broke' }
  return next
}

/** The room forgets. Without this, three bad calls end the night. */
export function cool(session: Session, seconds: number): Session {
  if (session.phase === 'over' || session.heat <= 0) return session
  return { ...session, heat: Math.max(0, session.heat - seconds * 0.02) }
}

export interface CallResult {
  session: Session
  won: boolean
  /** Set when the count was strong enough but the machine was straight. */
  wrongMachine: boolean
}

/**
 * Calling the house is itself a bet, and what it is staked on is the count.
 * Being right about a machine you cannot show is being wrong: the room settles
 * this, and the room only reads the tally.
 */
export function callHouse(session: Session): CallResult {
  const proven = session.evidence >= PROOF
  const crooked = shortChanged(session.machine)
  if (proven && crooked) {
    return {
      session: { ...session, bank: session.bank + settlementFor(session), phase: 'over', ended: 'proved' },
      won: true,
      wrongMachine: false,
    }
  }
  const bank = session.bank - CALL_COST
  const heat = Math.min(1, session.heat + 0.34)
  const session2: Session = { ...session, bank, heat, phase: 'ready' }
  if (heat >= 1) return { session: { ...session2, phase: 'over', ended: 'thrown-out' }, won: false, wrongMachine: !crooked }
  if (bank < MIN_STAKE) return { session: { ...session2, phase: 'over', ended: 'broke' }, won: false, wrongMachine: !crooked }
  return { session: session2, won: false, wrongMachine: proven && !crooked }
}

/* -------------------------------------------------------------- the room */

/**
 * What the room does about it. This is the whole opponent on this table: there
 * is no dealer here, so the crowd carries every job a face used to - the odds
 * readout, the pressure, and the jury on a call.
 */
export function reactionTo(out: Outcome): Reaction {
  if (out.coins >= 20) return 'roar'
  if (out.coins >= 5) return 'cheer'
  if (out.nearMiss) return 'gasp'
  if (out.coins > 0) return 'murmur'
  return 'sigh'
}

/* ------------------------------------------------------ house edge, exactly */

/**
 * Enumerates all STOPS^3 rests. Used by the tests and by scripts/odds.mjs.
 *
 * Per coin, and therefore the same at every stake: the card pays a multiple
 * of what goes in, so the edge is a property of the bands and nothing the
 * player sets can move it. That is worth being able to say out loud, because
 * "bet more to win it back" is the oldest wrong idea in the building.
 */
export function returnToPlayer(machine: Machine): number {
  let total = 0
  for (let i = 0; i < STOPS; i++) {
    for (let j = 0; j < STOPS; j++) {
      for (let k = 0; k < STOPS; k++) {
        total += payout([machine.bands[0][i], machine.bands[1][j], machine.bands[2][k]])
      }
    }
  }
  return total / (STOPS ** 3 * MIN_STAKE)
}
