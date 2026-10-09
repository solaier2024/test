// Factorized Bellman certificate for the production extension.
// Public information, roster, memory and pressure affect p, while every issued
// quote enforces the same martingale identity. Thus their cash value factor is
// identically one, and the complete finite match / coach graph can be solved
// without enumerating the Cartesian product of all histories and rosters.
// Concrete parameter checks below are regression coverage, not an exhaustive
// enumeration of continuous seed-generated priors.
import assert from "node:assert/strict";
import {
  initialMatch,
  applyAttack,
  applyDefend,
  END,
  PHASE,
} from "../src/math/rules.js";
import {
  cashBranches,
  attackOptions,
  defenseOptions,
  assertMartingale,
  P_MIN,
  P_MAX,
} from "../src/math/actions.js";
import {
  PLAYERS,
  canAdjust,
  adjustLineup,
  currentPlayer,
  pressureAt,
  CUP_STAGES,
  autoDefense,
} from "../src/math/depth.js";
import {
  ARCHETYPES,
  initialMemory,
  rememberShot,
  keeperDiveDistribution,
} from "../src/math/keeper.js";
import { ShootoutEngine } from "../src/math/engine.js";
import { verifySettlement } from "../src/math/replay.js";

const key = (m) =>
  [
    m.round,
    m.phase,
    m.playerGoals,
    m.oppGoals,
    m.playerTaken,
    m.oppTaken,
    m.suddenDeath,
    m.sdSet,
    m.ended,
  ].join("|");
const matches = new Map();
function walk(m) {
  if (matches.has(key(m))) return;
  matches.set(key(m), m);
  assert.ok(m.playerTaken + m.oppTaken <= 16);
  if (m.ended) return;
  const apply = m.phase === PHASE.ATTACK ? applyAttack : applyDefend;
  for (const success of [true, false]) {
    const child = apply(m, success);
    assert.equal(
      child.playerTaken + child.oppTaken,
      m.playerTaken + m.oppTaken + 1,
    );
    walk(child);
  }
}
walk(initialMatch());

// The remaining-stage rank strictly decreases for shots. A coach move consumes
// its one credit and changes no cash; rank = 2 * remaining stages + credit.
const cache = new Map();
let windows = 0,
  maxEdge = 0,
  checkedBranches = 0;
function solve(m, used) {
  if (m.ended)
    return {
      max: m.ended === END.LOSS ? 0 : 1,
      min: m.ended === END.LOSS ? 0 : 1,
    };
  const k = `${key(m)}#${used}`;
  if (cache.has(k)) return cache.get(k);
  const apply = m.phase === PHASE.ATTACK ? applyAttack : applyDefend;
  const success = apply(m, true),
    failure = apply(m, false);
  const vs = solve(success, used),
    vf = solve(failure, used),
    values = [];
  const failureIsLoss = failure.ended === END.LOSS;
  for (const p of [P_MIN, 0.5, 0.73, P_MAX])
    for (const risk of m.phase === PHASE.ATTACK ? [0.3, 0.55, 0.48] : [0.32]) {
      const b = cashBranches(1, p, risk, failureIsLoss);
      assert.ok(b.onFailure < 1);
      assert.ok(b.onSuccess > 1);
      assert.ok(Math.abs(p * b.onSuccess + (1 - p) * b.onFailure - 1) < 1e-12);
      assert.equal(failureIsLoss, b.onFailure === 0);
      values.push({
        max: p * b.onSuccess * vs.max + (1 - p) * b.onFailure * vf.max,
        min: p * b.onSuccess * vs.min + (1 - p) * b.onFailure * vf.min,
      });
      checkedBranches++;
    }
  if (canAdjust(m, used)) values.push(solve(m, 1));
  if (
    m.phase === PHASE.ATTACK &&
    m.playerTaken > 0 &&
    m.playerTaken === m.oppTaken
  ) {
    const continueBest = Math.max(...values.map((v) => v.max));
    windows++;
    maxEdge = Math.max(maxEdge, continueBest - 1);
    assert.ok(Math.abs(continueBest - 1) < 1e-11);
    values.push({ max: 1, min: 1 });
  }
  const value = {
    max: Math.max(...values.map((v) => v.max)),
    min: Math.min(...values.map((v) => v.min)),
  };
  cache.set(k, value);
  return value;
}
const root = solve(initialMatch(), 0);
assert.ok(Math.abs(root.max - 1) < 1e-11 && Math.abs(root.min - 1) < 1e-11);

// All 6P5 = 720 unique five-player orders, every legal coach pair, and both
// used/unspent credits. Probability identity is independent of their ordering.
const lineups = [];
function orders(prefix) {
  if (prefix.length === 5) {
    lineups.push(prefix);
    return;
  }
  for (const p of PLAYERS)
    if (!prefix.includes(p.id)) orders([...prefix, p.id]);
}
orders([]);
assert.equal(lineups.length, 720);
let coachPairs = 0;
for (const m of matches.values()) {
  for (let strain = 0; strain <= 2; strain++) {
    const pressure = pressureAt(m, strain);
    assert.ok([0, 1, 2].includes(pressure.level));
  }
  if (!canAdjust(m, 0)) continue;
  for (const lineup of lineups)
    for (let a = m.playerTaken; a < 5; a++)
      for (let b = a + 1; b < 5; b++) {
        const adjusted = adjustLineup(m, lineup, 0, a, b);
        assert.deepEqual(
          adjusted.slice(0, m.playerTaken),
          lineup.slice(0, m.playerTaken),
        );
        assert.equal(adjusted[a], lineup[b]);
        assert.equal(adjusted[b], lineup[a]);
        assert.equal(new Set(adjusted).size, 5);
        assert.ok(!canAdjust(m, 1));
        assert.ok(PLAYERS.some((p) => p.id === currentPlayer(m, adjusted).id));
        coachPairs++;
      }
}

// All direction histories up to eight player kicks, all archetypes, four
// published priors, every trait and pressure level, plus isolated chip math.
const priors = [
  { L: 1 / 3, C: 1 / 3, R: 1 / 3 },
  ...CUP_STAGES.map((s) => s.keeper),
];
const representatives = ["marksman", "power", "artist", "ice"].map((trait) =>
  PLAYERS.find((p) => p.trait === trait),
);
let histories = 0,
  quotedActions = 0;
for (const archetype of Object.keys(ARCHETYPES)) {
  function check(memory, depth) {
    histories++;
    for (const prior of priors) {
      const dist = keeperDiveDistribution(prior, memory, archetype);
      assert.ok(Math.abs(dist.L + dist.C + dist.R - 1) < 1e-12);
      for (const player of representatives)
        for (let level = 0; level < 3; level++) {
          const options = attackOptions(initialMatch(), 1, dist, {
            player,
            pressure: { level },
            enableChip: true,
          });
          assertMartingale(1, options);
          for (const o of options) {
            assert.ok(o.p >= P_MIN && o.p <= P_MAX);
            assert.ok(o.onFailure < 1);
            quotedActions++;
          }
        }
    }
    if (depth === 8) return;
    for (const dir of ["L", "C", "R"])
      check(rememberShot(memory, archetype, dir), depth + 1);
  }
  check(initialMemory(), 0);
}
for (const prior of priors)
  for (let level = 0; level < 3; level++) {
    const options = defenseOptions(initialMatch(), 1, prior, {
      pressure: { level },
    });
    assertMartingale(1, options);
    quotedActions += options.length;
    assert.equal(
      autoDefense({ phase: "defend", options }).p,
      Math.max(...options.map((o) => o.p)),
    );
  }

// Replays exercise the implementation's path binding, public policy, pressure,
// coaching and all cup configs. This is deterministic regression, not proof of
// unseen continuous priors nor a human comprehension trial.
for (let n = 0; n < 240; n++) {
  const engine = new ShootoutEngine({
    stake: 10,
    seed: `depth-certificate-${n}`,
    lineup: lineups[n % lineups.length],
    config: {
      mode: n % 2 ? "quick" : "full",
      cupStage: n % 4 ? CUP_STAGES[(n % 4) - 1].id : null,
      enableChip: n % 3 === 0,
    },
  });
  while (!engine.getSettlement()) {
    const q = engine.getQuote();
    if (q.canCashOut && n % 7 === 0) {
      engine.cashOut(q.quoteId);
      break;
    }
    if (q.canAdjust && n % 3 !== 0) {
      const start = engine.match.playerTaken;
      engine.adjust(start, 4, q.quoteId);
      continue;
    }
    const option =
      q.phase === PHASE.DEFEND && engine.config.mode === "quick"
        ? autoDefense(q)
        : q.options[(n + engine.log.length) % q.options.length];
    engine.submit(option.id, q.quoteId);
  }
  assert.equal(verifySettlement(engine.getSettlement()), true);
}
console.log(
  JSON.stringify(
    {
      status: "PASS",
      certificate: "finite-factorized-Bellman-v1",
      reachableMatchStates: matches.size,
      bellmanStates: cache.size,
      branchChecks: checkedBranches,
      allRosterOrders: lineups.length,
      legalCoachPairs: coachPairs,
      historyContexts: histories,
      concreteQuotedActions: quotedActions,
      replayedMatches: 240,
      cashWindows: windows,
      maxContinueEdge: maxEdge,
      phiMax: root.max,
      phiMin: root.min,
      terminalRoundingBoundMXN: 0.005,
      coverage:
        "All finite match/coach transitions; all roster orders; trait and pressure combinations; four concrete priors per archetype. Continuous priors are covered by the enforced conditional quote identity, not seed enumeration.",
    },
    null,
    2,
  ),
);
