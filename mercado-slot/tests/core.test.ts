import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatMoney, linePay, totalCost } from "../src/core/math.ts";
import { LocalProvider, type Store } from "../src/core/provider.ts";
import { below, draw, gridAt, stream, weighted } from "../src/core/rng.ts";
import { BASE_STAKES, MULTIPLIERS, type Grid } from "../src/core/config.ts";
import { messages, symbolNames } from "../src/i18n.ts";

const seed = "1da396fbbc787a9d986f643279530e62";
const two: Grid = [
  [6, 6, 6],
  [3, 4, 5],
  [2, 2, 2],
];
const none: Grid = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 0, 2],
];
const full: Grid = [
  [7, 7, 7],
  [7, 7, 7],
  [7, 7, 7],
];
function memory(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test("multiple lines are summed once, then multiplied once", () => {
  const result = evaluate(two, 10_000_000n, 3);
  assert.deepEqual(
    result.lineWins.map((w) => w.line),
    [2, 3],
  );
  assert.equal(result.baseWinUnits, 11_200_000n);
  assert.equal(result.payoutUnits, 33_600_000n);
  assert.equal(totalCost(10_000_000n, "extra"), 15_000_000n);
  assert.equal(
    result.payoutUnits - totalCost(10_000_000n, "extra"),
    18_600_000n,
  );
});
test("15x with no payline still pays zero", () => {
  assert.equal(evaluate(none, 10_000_000n, 15).payoutUnits, 0n);
});
test("Wild substitutes but a mixed line never pays; all-Wild is special", () => {
  assert.deepEqual(linePay([7, 6, 7]), { symbol: 6, payTenths: 40 });
  assert.deepEqual(linePay([7, 7, 7]), { symbol: 7, payTenths: 250 });
  assert.equal(linePay([7, 6, 2]), null);
});
test("maximum is reachable and is 375 base stakes / 250 Extra costs", () => {
  assert.deepEqual(gridAt([1, 56, 42]), full);
  const result = evaluate(full, 10_000_000n, 15);
  assert.equal(result.lineWins.length, 5);
  assert.equal(result.payoutUnits, 3_750_000_000n);
  assert.equal(result.payoutUnits / totalCost(10_000_000n, "standard"), 375n);
  assert.equal(result.payoutUnits / totalCost(10_000_000n, "extra"), 250n);
});
test("minimum bet retains sub-cent returns and integer precision", () => {
  const result = evaluate(two, 200_000n, 3);
  assert.equal(result.payoutUnits, 672_000n);
  assert.equal(result.payoutUnits - totalCost(200_000n, "extra"), 372_000n);
  assert.equal(formatMoney(result.payoutUnits, "en-US"), "$0.672");
  assert.equal(formatMoney(-372_000n, "es-MX", true), "−$0.372");
  assert.equal(formatMoney(1_000_000_000n, "en-US"), "$1,000.00");
});
test("invalid grids, stakes, multipliers and reel stops are rejected", () => {
  assert.throws(() => evaluate([[7]], 200_000n, 1));
  assert.throws(() => evaluate(full, 201_000n, 1));
  assert.throws(() => gridAt([64, 1, 1]));
  assert.throws(() => weighted([1.5, 2], () => 0));
  assert.throws(() => below(0n, () => 0));
});
test("rejection sampling discards the biased top interval", () => {
  const words = [0xffffffff, 0xffffffff, 0, 7];
  let count = 0;
  assert.equal(
    below(10n, () => words[count++]!),
    7n,
  );
  assert.equal(count, 4);
});
test("a zero weight cannot be sampled and streams are deterministic", () => {
  assert.equal(
    weighted([0, 1, 0], () => 0),
    1,
  );
  assert.deepEqual(
    Array.from({ length: 12 }, stream(seed, "r", "axis")),
    Array.from({ length: 12 }, stream(seed, "r", "axis")),
  );
  assert.notDeepEqual(
    Array.from({ length: 12 }, stream(seed, "r", "axis")),
    Array.from({ length: 12 }, stream(seed, "r", "reel-0")),
  );
});
test("mode changes only the independent axis, never the main board", () => {
  for (let i = 0; i < 100; i++) {
    const normal = draw(seed, `case-${i}`, "standard");
    const extra = draw(seed, `case-${i}`, "extra");
    assert.deepEqual(normal.grid, extra.grid);
    assert(extra.multiplier >= 2);
  }
});
test("one request performs one atomic debit and payout despite concurrent retries", async () => {
  const store = memory();
  const provider = new LocalProvider(seed, store);
  const quote = provider.quote(10_000_000n, "extra");
  const request = { quoteId: quote.quoteId, requestId: "double-click" };
  const [one, duplicate] = await Promise.all([
    provider.accept(request),
    provider.accept(request),
  ]);
  assert.strictEqual(one, duplicate);
  assert.equal(provider.history.length, 1);
  assert.equal(
    provider.balance,
    1_000_000_000n - 15_000_000n + one.payoutUnits,
  );
  assert.equal(store.data.size, 1);
  await assert.rejects(
    provider.accept({ ...request, quoteId: "different" }),
    /CONFLICT/,
  );
  await assert.rejects(
    provider.accept({ ...request, requestId: "new-request" }),
    /MISSING/,
  );
});
test("money and payout are frozen before presentation; quote changes cannot affect a result", async () => {
  const provider = new LocalProvider(seed);
  const q = provider.quote(200_000n, "standard");
  const result = await provider.accept({
    quoteId: q.quoteId,
    requestId: "frozen",
  });
  provider.quote(50_000_000n, "extra");
  assert.equal(result.baseStakeUnits, 200_000n);
  assert.equal(result.mode, "standard");
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.grid));
  assert(Object.isFrozen(result.grid[0]));
  assert(Object.isFrozen(result.lineWins));
});
test("refresh replays the event ledger without accepting or charging again", async () => {
  const store = memory();
  const before = new LocalProvider(seed, store);
  for (let i = 0; i < 8; i++) {
    const quote = before.quote(BASE_STAKES[i]!, i % 2 ? "extra" : "standard");
    await before.accept({ quoteId: quote.quoteId, requestId: `restore-${i}` });
  }
  const raw = store.getItem("mercado.session.v1");
  const after = new LocalProvider("ffffffffffffffffffffffffffffffff", store);
  assert.equal(after.restored, true);
  assert.equal(after.balance, before.balance);
  assert.deepEqual(after.history, before.history);
  const last = before.history.at(-1)!;
  assert.deepEqual(
    await after.accept({ quoteId: last.quoteId, requestId: last.requestId }),
    last,
  );
  assert.equal(store.getItem("mercado.session.v1"), raw);
});
test("invalid saved session falls back completely, with no partial ledger", async () => {
  const store = memory();
  const original = new LocalProvider(seed, store);
  const quote = original.quote(1_000_000n, "standard");
  await original.accept({ quoteId: quote.quoteId, requestId: "valid" });
  const snapshot = JSON.parse(store.getItem("mercado.session.v1")!) as {
    events: unknown[];
  };
  snapshot.events.push({
    requestId: "bad",
    quoteId: "bad",
    base: "not-a-number",
    mode: "extra",
  });
  store.setItem("mercado.session.v1", JSON.stringify(snapshot));
  const recovered = new LocalProvider(seed, store);
  assert.equal(recovered.restoreRejected, true);
  assert.equal(recovered.history.length, 0);
  assert.equal(recovered.balance, 1_000_000_000n);
});
test("storage failure keeps the completed transaction in memory", async () => {
  const provider = new LocalProvider(seed, {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  });
  const quote = provider.quote(1_000_000n, "standard");
  const result = await provider.accept({
    quoteId: quote.quoteId,
    requestId: "quota-test",
  });
  assert.equal(provider.storageAvailable, false);
  assert.equal(provider.balance, 999_000_000n + result.payoutUnits);
});
test("insufficient credits rejects without creating a ledger event", async () => {
  const provider = new LocalProvider(seed);
  let i = 0;
  for (; i < 2000 && provider.balance >= 75_000_000n; i++) {
    // Pick reproducible, valid requests; all money is still settled by the core.
    let requestId = `insufficient-${i}`;
    while (
      evaluate(
        draw(seed, requestId, "extra").grid,
        50_000_000n,
        draw(seed, requestId, "extra").multiplier,
      ).payoutUnits >= 75_000_000n
    )
      requestId += "-x";
    const q = provider.quote(50_000_000n, "extra");
    await provider.accept({ quoteId: q.quoteId, requestId });
  }
  const balance = provider.balance;
  const length = provider.history.length;
  const q = provider.quote(50_000_000n, "extra");
  await assert.rejects(
    provider.accept({ quoteId: q.quoteId, requestId: "too-much" }),
    /INSUFFICIENT/,
  );
  assert.equal(provider.balance, balance);
  assert.equal(provider.history.length, length);
});
test("English and Spanish cover every UI string and symbol", () => {
  assert.deepEqual(
    Object.keys(messages["en-US"]).sort(),
    Object.keys(messages["es-MX"]).sort(),
  );
  for (const locale of ["en-US", "es-MX"] as const) {
    assert(
      Object.values(messages[locale]).every(
        (s) => s.length > 0 && !/[\u4e00-\u9fff]/.test(s),
      ),
    );
    assert.equal(symbolNames[locale].length, 8);
  }
  assert.deepEqual(MULTIPLIERS, [1, 2, 3, 5, 10, 15]);
});
test("reset starts a fresh session and a refresh cannot restore old events", async () => {
  const store = memory();
  const provider = new LocalProvider(seed, store);
  const q = provider.quote(1_000_000n, "extra");
  await provider.accept({ quoteId: q.quoteId, requestId: "old-order" });
  const nextSeed = "ffffffffffffffffffffffffffffffff";
  provider.reset(nextSeed);
  assert.equal(provider.balance, 1_000_000_000n);
  assert.equal(provider.history.length, 0);
  assert.equal(provider.seed, nextSeed);
  const restored = new LocalProvider(seed, store);
  assert.equal(restored.seed, nextSeed);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.balance, 1_000_000_000n);
  await assert.rejects(
    provider.accept({ quoteId: q.quoteId, requestId: "old-order" }),
    /MISSING/,
  );
});
test("reset remains effective in memory when storage is unavailable", async () => {
  const provider = new LocalProvider(seed, {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  });
  const q = provider.quote(1_000_000n, "standard");
  await provider.accept({ quoteId: q.quoteId, requestId: "before-reset" });
  provider.reset("ffffffffffffffffffffffffffffffff");
  assert.equal(provider.history.length, 0);
  assert.equal(provider.balance, 1_000_000_000n);
  assert.equal(provider.storageAvailable, false);
});
