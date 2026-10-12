import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIG_HASH,
  REELS,
  type Mode,
  type Multiplier,
} from "../src/core/config.ts";
import { evaluate, totalCost } from "../src/core/math.ts";
import { gridAt } from "../src/core/rng.ts";
import {
  LocalProvider,
  type OutcomeProvider,
  type Quote,
  type Result,
  type Store,
} from "../src/core/provider.ts";
import {
  awardAt,
  reelFrame,
  reelMotion,
  reelSequence,
  spinTiming,
  stopPosition,
  winTier,
} from "../src/presentation/motion.ts";
import {
  RoundController,
  type Presenter,
  type RoundEvent,
} from "../src/shell/round-controller.ts";

test("visual reel speed is fixed across accepted offsets and continuous through acceleration/braking", () => {
  for (const turbo of [false, true])
    for (let column = 0; column < 3; column++) {
      const motion = reelMotion(column, turbo);
      const launch = (motion.velocity * motion.accelerate) / 2;
      const braking = (motion.velocity * motion.brake) / 2;
      assert(motion.cruise > 0);
      assert(
        Math.abs(
          (motion.travel - launch - braking) / motion.cruise - motion.velocity,
        ) < 1e-10,
      );
      const h = 1e-6;
      const endOfAcceleration =
        (launch - launch * (1 - h / motion.accelerate) ** 2) / h;
      const startOfBraking = (braking * (1 - (1 - h / motion.brake) ** 2)) / h;
      assert(Math.abs(endOfAcceleration - motion.velocity) < 0.001);
      assert(Math.abs(startOfBraking - motion.velocity) < 0.001);
    }
});

test("recycled presentation strips preserve the old visible window and land on every authoritative stop", () => {
  for (let column = 0; column < 3; column++) {
    const strip = REELS[column]!;
    for (const turbo of [false, true]) {
      const { travel } = reelMotion(column, turbo);
      for (let current = 0; current < strip.length; current++)
        for (let stop = 0; stop < strip.length; stop++) {
          const sequence = reelSequence(strip, current, stop, travel);
          assert.equal(sequence.length, travel + 5);
          assert.deepEqual(
            sequence.slice(0, 5),
            [-2, -1, 0, 1, 2].map(
              (offset) => strip[(current + offset + 64) % 64],
            ),
          );
          assert.deepEqual(
            sequence.slice(travel, travel + 5),
            [-2, -1, 0, 1, 2].map((offset) => strip[(stop + offset + 64) % 64]),
          );
          const authoritative = [0, 0, 0];
          authoritative[column] = stop;
          assert.deepEqual(
            sequence.slice(travel + 1, travel + 4),
            gridAt(authoritative).map((row) => row[column]),
          );
        }
    }
  }
});

test("ordinary and quick timing keep ordered reel stops, then reveal the multiplier after settling", () => {
  for (const turbo of [false, true]) {
    const timing = spinTiming(turbo);
    const stops = timing.reels.map((motion) => motion.stopAt);
    assert(stops[0]! < stops[1]! && stops[1]! < stops[2]!);
    assert(timing.baseAt > stops[2]! + timing.reels[2]!.settle);
    assert(timing.multiplierAt > timing.baseAt);
    assert(timing.lineAt > timing.multiplierAt);
    assert(
      turbo
        ? stops[2]! >= 0.9 && stops[2]! <= 1.1
        : stops[2]! >= 1.8 && stops[2]! <= 2.1,
    );
  }
  const reduced = spinTiming(true, true);
  assert.equal(reduced.id, "reduced");
  assert(reduced.reels.every((r) => r.travel === 0 && r.velocity === 0));
  assert.equal(reduced.bounce, 0);
  assert.throws(() => reelMotion(3, false));
  assert.throws(() => reelSequence(REELS[0]!, 0, 64, 20));
});

test("every displayed reel stop matches the accepted grid after one or more complete turns", () => {
  for (let c = 0; c < 3; c++)
    for (let stop = 0; stop < 64; stop++)
      for (const from of [0, 63.875, 126, 8128.25]) {
        const end = stopPosition(from, stop, 64, 2);
        assert(end >= from + 128);
        const frame = reelFrame(end, 64);
        assert.equal(frame.fraction, 0);
        const displayed = [0, 1, 2].map(
          (row) => REELS[c]![(frame.center + row - 1 + 64) % 64],
        );
        const stops = [0, 0, 0];
        stops[c] = stop;
        assert.deepEqual(
          displayed,
          gridAt(stops).map((row) => row[c]),
        );
      }
});
test("recycled food centers remain continuous across the last and first strip cells", () => {
  const a = reelFrame(63.999, 64),
    b = reelFrame(64.001, 64);
  // The same strip cell shifts from the lower recycled slot into the center.
  assert.equal((a.center + 1) % 64, b.center);
  assert(Math.abs(1 - a.fraction - (0 - b.fraction)) < 0.003);
  assert.throws(() => stopPosition(3, 64, 64));
  assert.throws(() => stopPosition(3, 0, 64, 0));
  assert.throws(() => reelFrame(-1, 64));
  assert.throws(() => reelFrame(3, NaN));
});
test("money count-up keeps sub-cent units, clamps progress, and finishes exactly", () => {
  const payout = 672_001n;
  assert.equal(awardAt(payout, 0.5), 336_000n);
  assert.equal(awardAt(payout, 1), payout);
  assert.equal(awardAt(payout, 3), payout);
  assert.equal(awardAt(payout, -0.2), 0n);
  assert.equal(awardAt(payout, NaN), 0n);
  assert.equal(awardAt(0n, 1), 0n);
  assert.equal(awardAt(9_007_199_254_740_995n, 1), 9_007_199_254_740_995n);
});
test("celebration uses actual paid cost: partial returns and break-even stay neutral", () => {
  assert.equal(winTier(0n, 10_000_000n), "none");
  assert.equal(winTier(8_000_000n, 10_000_000n), "return");
  assert.equal(winTier(10_000_000n, 10_000_000n), "return");
  assert.equal(winTier(10_000_001n, 10_000_000n), "win");
  assert.equal(winTier(50_000_000n, 10_000_000n), "big");
  assert.equal(winTier(200_000_000n, 10_000_000n), "grand");
  assert.equal(winTier(50_000_000n, 15_000_000n), "win");
});

const initialBalance = 1_000_000_000n;
function fixture(
  base = 10_000_000n,
  mode: Mode = "extra",
  multiplier: Multiplier = 3,
): Result {
  const quote: Quote = Object.freeze({
    quoteId: "fixture-quote",
    configHash: CONFIG_HASH,
    baseStakeUnits: base,
    totalCostUnits: totalCost(base, mode),
    mode,
  });
  const stops = [1, 56, 42],
    grid = gridAt(stops),
    award = evaluate(grid, base, multiplier);
  return Object.freeze({
    ...quote,
    ...award,
    grid,
    reelStops: stops,
    multiplier,
    spinId: "MD-0001",
    requestId: "fixture-request",
    balanceAfterUnits:
      initialBalance - quote.totalCostUnits + award.payoutUnits,
    ledgerVersion: 1,
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
function harness(result: Result, acceptGate = Promise.resolve()) {
  let balance = initialBalance,
    calls = 0;
  const history: Result[] = [];
  const provider: OutcomeProvider = {
    get balance() {
      return balance;
    },
    get history() {
      return history;
    },
    quote: () => result,
    accept: async () => {
      calls++;
      balance = result.balanceAfterUnits;
      history.push(result);
      await acceptGate;
      return result;
    },
  };
  return {
    provider,
    get calls() {
      return calls;
    },
  };
}
test("confirmation and presentation block duplicate presses without a second debit", async () => {
  const result = fixture(),
    accepted = deferred(),
    finished = deferred(),
    book = harness(result, accepted.promise);
  let emit!: (event: RoundEvent) => void;
  const flow = new RoundController(
    book.provider,
    async (_r, event) => {
      emit = event;
      await finished.promise;
    },
    () => {},
  );
  const first = flow.spin(result, "first");
  assert.equal(flow.phase, "confirming");
  assert.equal(await flow.spin(result, "duplicate"), false);
  assert.equal(book.calls, 1);
  accepted.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(flow.phase, "presenting");
  assert.equal(flow.displayBalance, initialBalance - result.totalCostUnits);
  assert.equal(book.provider.balance, result.balanceAfterUnits);
  assert.equal(await flow.spin(result, "during-animation"), false);
  flow.reset();
  assert.equal(flow.phase, "presenting");
  emit({ stage: "base" });
  assert.equal(flow.displayedPayout, result.baseWinUnits);
  assert.equal(flow.displayBalance, initialBalance - result.totalCostUnits);
  emit({ stage: "award", progress: 0.5 });
  assert.equal(flow.displayedPayout, result.payoutUnits / 2n);
  assert.equal(
    flow.displayBalance,
    initialBalance - result.totalCostUnits + result.payoutUnits / 2n,
  );
  finished.resolve();
  assert.equal(await first, true);
  assert.equal(flow.displayedPayout, result.payoutUnits);
  assert.equal(flow.displayBalance, book.provider.balance);
  assert.equal(flow.phase, "ready");
  assert.equal(book.calls, 1);
});
test("skip or an immediately finished timeline resolves to the same accepted micro-unit result", async () => {
  const result = fixture(200_000n),
    book = harness(result);
  const flow = new RoundController(
    book.provider,
    async (_r, emit) => emit({ stage: "award", progress: 1 }),
    () => {},
  );
  await flow.spin(result, "skip");
  assert.equal(flow.displayedPayout, result.payoutUnits);
  assert.equal(flow.displayBalance, result.balanceAfterUnits);
  assert.equal(book.provider.history.length, 1);
});
test("renderer failure preserves accepted money and permits the next action", async () => {
  const result = fixture(),
    book = harness(result);
  const flow = new RoundController(
    book.provider,
    async () => {
      throw new Error("Lost display");
    },
    () => {},
  );
  assert.equal(await flow.spin(result, "display-error"), true);
  assert.equal(flow.presentationRecovered, true);
  assert.equal(flow.phase, "ready");
  assert.equal(flow.lastResult, result);
  assert.equal(flow.displayBalance, result.balanceAfterUnits);
  assert.equal(book.calls, 1);
});
test("replaying an older receipt never spends again or animates the balance backwards", async () => {
  const result = fixture(),
    book = harness(result);
  let replaying = false;
  const seen: bigint[] = [];
  let flow!: RoundController;
  const present: Presenter = async (_r, emit, replay) => {
    replaying = replay;
    emit({ stage: "award", progress: 0.25 });
    emit({ stage: "award", progress: 1 });
  };
  flow = new RoundController(book.provider, present, () => {
    if (flow.replaying) seen.push(flow.displayBalance);
  });
  await flow.spin(result, "original");
  const balance = book.provider.balance;
  await flow.replay(result);
  assert.equal(replaying, true);
  assert.equal(book.calls, 1);
  assert.equal(book.provider.history.length, 1);
  assert(seen.length > 0 && seen.every((value) => value === balance));
  assert.equal(flow.displayedPayout, result.payoutUnits);
});
test("accept rejection leaves the previous result intact and no presentation starts", async () => {
  const result = fixture();
  let calls = 0;
  const provider: OutcomeProvider = {
    balance: initialBalance,
    history: [result],
    quote: () => result,
    accept: async () => {
      throw new Error("Expired quote");
    },
  };
  const flow = new RoundController(
    provider,
    async () => {
      calls++;
    },
    () => {},
  );
  await assert.rejects(flow.spin(result, "reject"));
  assert.equal(flow.phase, "ready");
  assert.equal(flow.lastResult, result);
  assert.equal(flow.displayBalance, initialBalance);
  assert.equal(calls, 0);
});
test("reloading during presentation restores the settled ledger, never a second charge", async () => {
  const data = new Map<string, string>();
  const store: Store = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
  const provider = new LocalProvider("0123456789abcdef0123456789abcdef", store),
    animation = deferred();
  const flow = new RoundController(
    provider,
    async () => animation.promise,
    () => {},
  );
  const pending = flow.spin(
    provider.quote(200_000n, "extra"),
    "refresh-in-animation",
  );
  await Promise.resolve();
  const reloaded = new LocalProvider("fedcba9876543210fedcba9876543210", store);
  const recovered = new RoundController(
    reloaded,
    async () => {},
    () => {},
  );
  assert.equal(reloaded.history.length, 1);
  assert.equal(recovered.phase, "ready");
  assert.equal(recovered.displayBalance, provider.balance);
  assert.equal(recovered.displayedPayout, reloaded.history[0]!.payoutUnits);
  const duplicate = await reloaded.accept({
    quoteId: reloaded.history[0]!.quoteId,
    requestId: "refresh-in-animation",
  });
  assert.equal(duplicate.balanceAfterUnits, provider.balance);
  assert.equal(reloaded.history.length, 1);
  animation.resolve();
  await pending;
});
