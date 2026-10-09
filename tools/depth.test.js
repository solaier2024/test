import test from "node:test";
import assert from "node:assert/strict";
import { ShootoutEngine } from "../src/math/engine.js";
import {
  initialMatch,
  applyAttack,
  applyDefend,
  keyBall,
  remainingShots,
  END,
} from "../src/math/rules.js";
import {
  attackOptions,
  defenseOptions,
  assertMartingale,
} from "../src/math/actions.js";
import {
  PLAYERS,
  DEFAULT_LINEUP,
  CUP_STAGES,
  validateLineup,
  currentPlayer,
  pressureAt,
  advanceStrain,
  adjustLineup,
  autoDefense,
} from "../src/math/depth.js";
import {
  initialMemory,
  keeperDiveDistribution,
  rememberShot,
} from "../src/math/keeper.js";
import { makeConfig } from "../src/math/contract.js";
import { verifySettlement } from "../src/math/replay.js";
import { MatchController } from "../src/shell/match-controller.js";
import { LocalProvider } from "../src/providers/localProvider.js";
import {
  GameProgress,
  PROGRESS_KEY,
  matchHighlights,
  KITS,
} from "../src/shell/progress.js";
import { ShotMediaCache } from "../src/presentation/shot-media-cache.js";
import { StadiumAudio } from "../src/presentation/stadium-audio.js";
import { selectShotClip } from "../src/presentation/video-match.js";
import { readFile } from "node:fs/promises";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const best = (q) => q.options.reduce((a, b) => (a.p >= b.p ? a : b));
const pair = (e) => {
  for (let i = 0; i < 2; i++) {
    const q = e.getQuote();
    e.submit(best(q).id, q.quoteId);
  }
};
function finished(config = {}, wanted = null, prefix = "depth-test") {
  for (let n = 0; n < 200; n++) {
    const engine = new ShootoutEngine({
      stake: 10,
      seed: `${prefix}-${n}`,
      config,
    });
    while (!engine.getSettlement()) {
      const q = engine.getQuote();
      engine.submit(best(q).id, q.quoteId);
    }
    const s = engine.getSettlement();
    if (!wanted || s.reason === wanted) return { engine, settlement: s };
  }
  throw new Error("Fixture not found");
}

test("three complete sudden-death pairs permit exactly sixteen kicks before a draw", () => {
  let m = initialMatch();
  for (let i = 0; i < 5; i++) {
    m = applyAttack(m, true);
    m = applyDefend(m, false);
  }
  for (let set = 1; set <= 3; set++) {
    assert.equal(m.sdSet, set);
    assert.equal(m.ended, null);
    assert.deepEqual(remainingShots(m), { player: 1, opp: 1 });
    m = applyAttack(m, false);
    assert.deepEqual(remainingShots(m), { player: 0, opp: 1 });
    assert.ok(!keyBall(m).text.includes("扑出即取胜"));
    m = applyDefend(m, true);
    assert.equal(m.ended, set === 3 ? END.DRAW : null);
  }
  assert.equal(m.playerTaken + m.oppTaken, 16);
  assert.deepEqual(remainingShots(m), { player: 0, opp: 0 });
});
test("equalizer cue only appears when a goal really levels the score", () => {
  const m = {
    ...initialMatch(),
    playerTaken: 1,
    oppTaken: 1,
    round: 2,
    oppGoals: 2,
  };
  assert.notEqual(keyBall(m)?.kind, "equalize");
  assert.equal(keyBall({ ...m, oppGoals: 1 }).kind, "equalize");
});
test("only calibrated rule limits, draw payout and mode configuration are accepted", () => {
  for (const c of [
    { drawReturnFactor: 1.1 },
    { regularRounds: 3 },
    { suddenDeathSets: 5 },
    { targetRtp: NaN },
    { mode: "secret" },
    { autoDefensePolicy: "random" },
    { amountDecimals: 0 },
    { cashBonus: 10 },
  ])
    assert.throws(() => makeConfig(c));
  assert.throws(() => new ShootoutEngine({ stake: Infinity }));
  assert.ok(Object.isFrozen(makeConfig()));
});
test("lineup identity, order and sudden-death cycle are validated", () => {
  assert.throws(() =>
    validateLineup(["luna", "luna", "torres", "rios", "silva"]),
  );
  assert.throws(() =>
    validateLineup(["luna", "vega", "torres", "rios", "unknown"]),
  );
  for (let i = 0; i < 8; i++)
    assert.equal(
      currentPlayer({ playerTaken: i }, DEFAULT_LINEUP).id,
      DEFAULT_LINEUP[i % 5],
    );
  const a = new ShootoutEngine({ stake: 10, seed: "lineup" });
  const b = new ShootoutEngine({
    stake: 10,
    seed: "lineup",
    lineup: [...DEFAULT_LINEUP].reverse(),
  });
  assert.notEqual(a.getQuote().quoteId, b.getQuote().quoteId);
  assert.notEqual(a.sessionId, b.sessionId);
});
test("pressure follows recent outcomes, recovers, and retains context floors", () => {
  assert.equal(pressureAt(initialMatch(), 0).level, 0);
  const m = { ...initialMatch(), playerTaken: 1, oppTaken: 1, oppGoals: 1 };
  assert.equal(pressureAt(m, 0).level, 1);
  assert.equal(advanceStrain(advanceStrain(0, false), false), 2);
  assert.equal(pressureAt(m, advanceStrain(2, true)).level, 1);
  assert.equal(pressureAt({ ...m, playerTaken: 4, round: 5 }, 0).level, 2);
  assert.equal(pressureAt({ ...m, suddenDeath: true }, 0).level, 2);
});
test("specializations and pressure change quotes; ice still responds to keeper memory", () => {
  const m = initialMatch(),
    dist = { L: 0.34, C: 0.32, R: 0.34 },
    pressure = { level: 2 };
  const options = (trait) =>
    attackOptions(m, 9.6, dist, {
      pressure,
      player: PLAYERS.find((p) => p.trait === trait),
    });
  const marks = options("marksman"),
    power = options("power"),
    ice = options("ice");
  near(marks[0].modifiers.traitBonus, 0.055);
  near(power[1].modifiers.traitBonus, 0.07);
  assert.equal(ice[0].modifiers.pressurePenalty, 0);
  near(marks[0].modifiers.pressurePenalty, 0.075);
  const mem = rememberShot(initialMemory(), "anticipator", "L");
  const learned = keeperDiveDistribution(dist, mem, "anticipator");
  const after = attackOptions(m, 9.6, learned, {
    pressure,
    player: PLAYERS.find((p) => p.trait === "ice"),
  });
  assert.ok(after[0].p < ice[0].p);
  for (const opts of [
    marks,
    power,
    ice,
    after,
    defenseOptions(m, 9.6, dist, { pressure }),
  ])
    assertMartingale(9.6, opts);
});
test("independent chip has one legal target and cannot borrow straight-shot footage", async () => {
  const options = attackOptions(
    initialMatch(),
    9.6,
    { L: 0.4, C: 0.2, R: 0.4 },
    { enableChip: true, player: PLAYERS.find((p) => p.trait === "artist") },
  );
  const chip = options.filter((o) => o.shot === "chip");
  assert.equal(chip.length, 1);
  assert.equal(chip[0].dir, "C");
  near(chip[0].modifiers.traitBonus, 0.075);
  assertMartingale(9.6, options);
  const manifest = JSON.parse(
    await readFile(
      new URL("../public/assets/media-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    selectShotClip(manifest, {
      phase: "attack",
      dir: "C",
      shot: "chip",
      success: false,
    }),
    null,
  );
  assert.ok(
    !new ShootoutEngine({ stake: 10 })
      .getQuote()
      .options.some((o) => o.shot === "chip"),
  );
});
test("coach spends one credit, preserves cash and memory, invalidates old quotes and enters the path", () => {
  const e = new ShootoutEngine({ stake: 10, seed: "coach-test" });
  pair(e);
  const before = e.getState(),
    old = e.getQuote(),
    mem = structuredClone(e.memory),
    cash = e.cash;
  const event = e.adjust(1, 4, old.quoteId);
  assert.equal(e.cash, cash);
  assert.deepEqual(e.memory, mem);
  assert.equal(e.strain, before.pressure.strain);
  assert.equal(e.getState().playerGoals, before.playerGoals);
  assert.equal(e.getState().oppGoals, before.oppGoals);
  assert.equal(e.getState().currentPlayer.id, "silva");
  assert.equal(e.getState().adjustmentsUsed, 1);
  assert.notEqual(e.getQuote().quoteId, old.quoteId);
  assert.ok(e.getQuote().quoteId.includes("swap-1-4"));
  assert.notEqual(e.getQuote().options[0].p, old.options[0].p);
  assert.equal(e.adjust(4, 1, old.quoteId), event);
  assert.throws(() => e.submit(old.options[0].id, old.quoteId));
  assert.throws(() => e.adjust(2, 3, e.getQuote().quoteId));
  assert.throws(() =>
    adjustLineup(
      { ...initialMatch(), playerTaken: 4, oppTaken: 4 },
      DEFAULT_LINEUP,
      0,
      3,
      4,
    ),
  );
});
test("quote data cannot be edited and a settled last action remains idempotent", () => {
  const e = new ShootoutEngine({ stake: 10, seed: "quote-freeze" });
  const q = e.getQuote();
  assert.throws(() => {
    q.options[0].p = 1;
  });
  let last, lastId;
  while (!e.getSettlement()) {
    const q = e.getQuote();
    lastId = q.options[0].id;
    last = e.submit(lastId, q.quoteId);
  }
  assert.equal(e.submit(lastId, last.quoteId), last);
  assert.throws(() => e.submit("different-action", last.quoteId));
});
test("authoritative physical shot directions are distinct from chosen defensive directions", () => {
  let seen = false;
  for (let n = 0; n < 20 && !seen; n++) {
    const e = new ShootoutEngine({ stake: 10, seed: `directions-${n}` });
    e.submit("L-placed", e.getQuote().quoteId);
    const r = e.submit("dive-L", e.getQuote().quoteId);
    const record = e.getPublicInfo().opponentHistory[0];
    assert.equal(record.ballDir, r.ballDir);
    assert.equal(record.diveDir, "L");
    if (!r.success) {
      assert.equal(record.ballDir, "R");
      seen = true;
    }
  }
  assert.ok(seen);
});
test("quick defense reads only public options, has fixed tie order and plays both stages", async () => {
  assert.equal(
    autoDefense({
      phase: "defend",
      options: ["R", "C", "L"].map((dir) => ({ dir, p: 0.4 })),
    }).dir,
    "L",
  );
  const played = [],
    provider = new LocalProvider({ seed: "quick-test" });
  const c = new MatchController({
    provider,
    present: {
      play: async (r) => {
        played.push(r);
      },
    },
  });
  c.setMode("quick");
  await c.start();
  const originalSubmit = provider.submit.bind(provider);
  let expected;
  provider.submit = async (action, quote) => {
    if (provider.engine.getQuote().phase === "defend")
      expected = autoDefense(provider.engine.getQuote()).id;
    if (expected) assert.equal(action, expected);
    return originalSubmit(action, quote);
  };
  await c.submit();
  assert.deepEqual(
    played.map((r) => r.phase),
    ["attack", "defend"],
  );
  assert.equal(c.state.quote.phase, "attack");
  assert.equal(c.state.quote.canCashOut, true);
  assert.equal(c.state.busy, false);
});
test("failed auto-defense preflight preserves the completed attack and retries without extra attack", async () => {
  let fail = true;
  const c = new MatchController({
    provider: new LocalProvider({ seed: "auto-preflight" }),
    present: {
      preflight: async (_, phase) => {
        if (phase === "defend" && fail) throw new Error("offline");
      },
      play: async () => {},
    },
  });
  c.setMode("quick");
  await c.start();
  assert.equal(await c.submit(), false);
  assert.equal(c.state.events.length, 1);
  assert.equal(c.state.quote.phase, "defend");
  fail = false;
  assert.equal(await c.submit(), true);
  assert.equal(c.state.events.length, 2);
});
test("public pre-match brief matches the opponent selected at start", async () => {
  const provider = new LocalProvider({ seed: "brief" }),
    preview = provider.preview();
  const { info } = await provider.start({ stake: 10 });
  assert.deepEqual(preview.preMatchTendency, info.preMatchTendency);
  assert.deepEqual(preview.shooterTendency, info.shooterTendency);
});
test("replay verifies complete configs, initial order and coach path, rejecting tampered events", () => {
  const e = new ShootoutEngine({
    stake: 10,
    seed: "verified-coach",
    config: { mode: "quick", enableChip: true },
  });
  pair(e);
  e.adjust(4, 1, e.getQuote().quoteId);
  while (!e.getSettlement()) {
    const q = e.getQuote();
    e.submit(best(q).id, q.quoteId);
  }
  const s = e.getSettlement();
  assert.equal(verifySettlement(s), true);
  const changed = structuredClone(s);
  changed.events[0].probability = 0.999;
  assert.equal(verifySettlement(changed), false);
  const wrongLineup = structuredClone(s);
  wrongLineup.initialLineup.reverse();
  assert.equal(verifySettlement(wrongLineup), false);
  const wrongScore = structuredClone(s);
  wrongScore.match.playerGoals += 1;
  assert.equal(verifySettlement(wrongScore), false);
  const wrongPressure = structuredClone(s);
  wrongPressure.events[0].pressureAfter.level = 7;
  assert.equal(verifySettlement(wrongPressure), false);
});
test("achievements count actual early-ended attempts and persistence is idempotent", () => {
  const storageMap = new Map(),
    storage = {
      getItem: (key) => storageMap.get(key),
      setItem: (key, v) => storageMap.set(key, v),
    };
  const p = new GameProgress(storage),
    { engine, settlement } = finished({}, "win");
  const result = p.record(settlement, engine.archetype);
  assert.equal(result.duplicate, false);
  const stats = structuredClone(p.profile.stats);
  const reload = new GameProgress(storage);
  assert.equal(reload.record(settlement, engine.archetype).duplicate, true);
  assert.deepEqual(reload.profile.stats, stats);
  const attacks = settlement.events.filter((e) => e.kind === "attack");
  assert.ok(
    matchHighlights(settlement)[0].includes(
      `${attacks.filter((e) => e.success).length}/${attacks.length}`,
    ),
  );
  assert.ok(matchHighlights(settlement).length <= 3);
});
test("cup advances only on independently settled wins and cashout abandons the run", () => {
  const p = new GameProgress();
  p.startCup();
  for (let i = 0; i < CUP_STAGES.length; i++) {
    const { engine, settlement } = finished(
      { cupStage: CUP_STAGES[i].id },
      "win",
      `cup-${i}`,
    );
    assert.equal(engine.archetype, CUP_STAGES[i].archetype);
    p.record(settlement, engine.archetype);
    assert.equal(p.profile.cup.stage, i + 1);
    assert.equal(p.profile.stats.cups, i === 2 ? 1 : 0);
  }
  assert.equal(p.profile.cup.status, "completed");
  assert.ok(p.profile.achievements.includes("champion"));
  p.startCup();
  const e = new ShootoutEngine({
    stake: 10,
    seed: "cup-cash",
    config: { cupStage: "quarter" },
  });
  pair(e);
  p.record(e.cashOut(e.getQuote().quoteId), e.archetype);
  assert.equal(p.profile.cup.stage, 0);
  assert.equal(p.profile.cup.status, "eliminated");
});
test("malformed profile and unavailable storage fall back without breaking matches", () => {
  const p = new GameProgress({
    getItem: () => "{invalid",
    setItem: () => {
      throw new Error("quota");
    },
  });
  assert.deepEqual(p.profile.lineup, DEFAULT_LINEUP);
  p.save();
  assert.equal(p.storageAvailable, false);
  const bad = new GameProgress({
    getItem: () =>
      JSON.stringify({
        version: 1,
        stats: { wins: -2 },
        achievements: ["invented"],
        cup: { stage: 5, status: "active" },
        records: "broken",
        opponents: ["unknown"],
      }),
    setItem: () => {},
  });
  assert.equal(bad.profile.stats.wins, 0);
  assert.equal(bad.profile.cup, null);
  assert.deepEqual(bad.profile.achievements, []);
});
test("cosmetic preferences change neither quotes nor deterministic outcomes", () => {
  const p = new GameProgress(),
    a = new ShootoutEngine({ stake: 10, seed: "cosmetic" });
  p.profile.stats.wins = 3;
  p.preferences({ kit: "green", title: null });
  assert.equal(KITS.find((k) => k.id === p.profile.kit).name, "主场绿");
  const b = new ShootoutEngine({ stake: 10, seed: "cosmetic" });
  assert.deepEqual(a.getQuote(), b.getQuote());
  assert.deepEqual(
    a.submit("L-placed", a.getQuote().quoteId),
    b.submit("L-placed", b.getQuote().quoteId),
  );
});
test("media cache bounds bytes as well as entry count and protects a playing blob", async () => {
  const cache = new ShotMediaCache({
    maxEntries: 4,
    maxBytes: 10,
    resolveUrl: (url) => url,
    fetchMedia: async () => ({
      ok: true,
      blob: async () => new Blob(["123456"]),
    }),
  });
  const a = "https://example.invalid/a.mp4",
    b = "https://example.invalid/b.mp4",
    c = "https://example.invalid/c.mp4";
  const unpin = cache.pin(a);
  await cache.load({ src: a });
  await assert.rejects(cache.load({ src: b }));
  assert.ok(cache.entries.has(a));
  assert.equal(cache.entries.has(b), false);
  unpin();
  await cache.load({ src: c });
  assert.equal(cache.entries.has(a), false);
  assert.equal(cache.entries.size, 1);
  cache.destroy();
  assert.equal(cache.sizes.size, 0);
});
test("refresh replays the same accepted path, including coach moves, and preserves the next quote", async () => {
  const map = new Map(),
    storage = {
      getItem: (key) => map.get(key),
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    };
  const p = new LocalProvider({ seed: "resume-test", storage });
  await p.start({ stake: 10, mode: "quick", preparationMs: 5432 });
  for (let i = 0; i < 2; i++)
    await p.submit(best(p.engine.getQuote()).id, p.engine.getQuote().quoteId);
  await p.adjust(1, 4, p.engine.getQuote().quoteId);
  const before = p.resume(),
    reloaded = new LocalProvider({ storage });
  const after = reloaded.resume();
  assert.deepEqual(after.state, before.state);
  assert.deepEqual(after.quote, before.quote);
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.info.opponentHistory, before.info.opponentHistory);
  const c = new MatchController({ provider: reloaded, present: {} });
  await c.restore();
  assert.equal(c.state.mode, "quick");
  assert.equal(c.state.match.adjustmentsUsed, 1);
  assert.equal(c.state.events.length, 2);
  assert.equal(c.state.busy, false);
  assert.equal(c.state.preparationMs, 5432);
  await c.cashOut();
  assert.ok(verifySettlement(c.state.settlement));
  const settled = new LocalProvider({ storage });
  assert.equal(
    settled.resume().settlement.settlementId,
    c.state.settlement.settlementId,
  );
  settled.release();
  assert.equal(map.has("last-kick-session-v1"), false);
});
test("a corrupt unfinished session never invents a quote or payout", () => {
  const p = new LocalProvider({
    storage: {
      getItem: () =>
        JSON.stringify({
          version: 1,
          seed: "invalid",
          stake: 10,
          actions: ["fabricated"],
          config: {},
          lineup: DEFAULT_LINEUP,
        }),
    },
  });
  assert.equal(p.resume(), null);
  assert.ok(p.restoreError);
});
test("quick opponent turn receives its whistle and the audio follows actual pressure", () => {
  const audio = new StadiumAudio(),
    seen = [];
  audio.setMix = () => {};
  audio.ambience = () => {};
  audio.whistle = () => seen.push(audio.readyQuoteId);
  const state = (id, level, busy, activity) => ({
    screen: "play",
    busy,
    activity,
    quote: { quoteId: id, pressure: { level } },
  });
  audio.match(state("attack-q", 0, false));
  audio.match(state("attack-q", 0, true, "playing"));
  audio.match(state("defend-q", 2, true, "loading"));
  audio.match(state("defend-q", 2, true, "playing"));
  assert.deepEqual(seen, ["attack-q", "defend-q"]);
  assert.equal(audio.pressure, 1);
});
