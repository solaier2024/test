#!/usr/bin/env node
/*
 * What each machine in the house actually does, measured rather than claimed.
 *
 *   node scripts/odds.mjs
 *
 * The return is enumerated over all 8000 rests, so it is exact and not a
 * simulation. Everything else is a long night at the machine.
 *
 * The line worth reading is the last one: how many pulls it takes before the
 * tally on the left is strong enough to call the house. That number is the
 * length of a session, and it is the only balance knob on this table.
 */
import {
  MACHINES,
  PROOF,
  START_BANK,
  opening,
  pull,
  returnToPlayer,
  rng,
  settle,
  shortChanged,
} from '../src/game/engine.ts'

const SPINS = 200_000
const RUNS = 200
const CAP = 4000

const pct = (x) => `${(x * 100).toFixed(1)}%`

function night(machine) {
  const next = rng(1)
  let nearMiss = 0
  let missable = 0
  let bells = 0
  let coins = 0
  for (let i = 0; i < SPINS; i++) {
    const out = pull(machine, next)
    coins += out.coins
    if (out.bellOnThird) bells++
    if (out.tease && out.line[2] !== out.line[0]) {
      missable++
      if (out.nearMiss) nearMiss++
    }
  }
  return { nearMiss: nearMiss / missable, bells: bells / SPINS, paid: coins / SPINS }
}

/** Pulls until the count clears the bar, with the purse held open. */
function toProof(machine, seed) {
  const next = rng(seed)
  let session = opening(machine)
  let pulls = 0
  while (session.evidence < PROOF && pulls < CAP) {
    session = settle({ ...session, bank: START_BANK, heat: 0 }, pull(machine, next))
    pulls++
  }
  return pulls
}

/** Pulls until the purse is empty, with no calling and no getting thrown out. */
function toBroke(machine, seed) {
  const next = rng(seed)
  let session = opening(machine)
  while (session.bank >= 1 && session.pulls < CAP) {
    session = settle({ ...session, heat: 0 }, pull(machine, next))
  }
  return session.pulls
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const seeds = Array.from({ length: RUNS }, (_, i) => i + 1)

console.log(
  ['machine', 'bells on 3', 'return', 'paid out', 'miss by one', 'pulls to proof', 'pulls to broke']
    .map((s, i) => (i ? s.padStart(15) : s.padEnd(10)))
    .join(''),
)

for (const m of MACHINES) {
  const n = night(m)
  const proofs = seeds.map((s) => toProof(m, s))
  const cleared = proofs.filter((p) => p < CAP)
  const proof = cleared.length < RUNS / 2 ? 'never' : String(median(proofs))
  console.log(
    [
      m.id.padEnd(10),
      String(m.bands[2].filter((x) => x === 'bell').length).padStart(15),
      pct(returnToPlayer(m)).padStart(15),
      pct(n.paid).padStart(15),
      pct(n.nearMiss).padStart(15),
      proof.padStart(15),
      String(median(seeds.map((s) => toBroke(m, s)))).padStart(15),
    ].join(''),
  )
}

console.log(`\n${SPINS.toLocaleString()} pulls each; return enumerated over all 8000 rests.`)
console.log(`a call needs ${PROOF} of evidence, and only lands on a machine that is short: ` +
  MACHINES.filter(shortChanged).map((m) => m.id).join(', '))
