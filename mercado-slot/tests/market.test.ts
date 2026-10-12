import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_HASH, type Grid } from "../src/core/config.ts";
import { evaluate } from "../src/core/math.ts";
import { RoundController } from "../src/shell/round-controller.ts";
import {
  LocalProvider,
  type Result,
  type Store,
} from "../src/core/provider.ts";
import {
  basket,
  basketFit,
  canPrepare,
  canServe,
  freshMarket,
  MARKET_KEY,
  MarketJourney,
  marketTransition,
  mastery,
  offers,
  RECIPES,
  unlocked,
} from "../src/core/market.ts";
import {
  marketMessages,
  marketText,
  recipeNames,
  stallNames,
} from "../src/market-i18n.ts";

const seed = "1da396fbbc787a9d986f643279530e62";
const grid: Grid = [
  [0, 2, 7],
  [1, 3, 7],
  [6, 4, 5],
];
const wild: Grid = [
  [7, 7, 7],
  [7, 7, 7],
  [7, 7, 7],
];
function fixture(version: number, board: Grid = grid): Result {
  return Object.freeze({
    ...evaluate(board, 200_000n, 2),
    grid: board,
    spinId: `MD-${version}`,
    requestId: `fixture-${version}`,
    quoteId: `q-${version}`,
    configHash: CONFIG_HASH,
    mode: "standard",
    baseStakeUnits: 200_000n,
    totalCostUnits: 200_000n,
    multiplier: 2,
    reelStops: [0, 0, 0],
    ledgerVersion: version,
    balanceAfterUnits: 1_000_000_000n,
  });
}
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
test("one basket takes exactly one displayed column; Wild is a chef substitute", () => {
  const result = fixture(1),
    map = new Map([[1, result]]);
  const arrived = marketTransition(
    freshMarket(0),
    { type: "arrival", version: 1, request: result.requestId },
    map,
  );
  const picked = marketTransition(
    arrived,
    { type: "pick", version: 1, column: 2 },
    map,
  );
  assert.equal(picked.chef, 3);
  assert.deepEqual(picked.pantry, [2, 1, 1, 1, 1, 2, 1]);
  assert.equal(picked.pending.length, 0);
  assert.equal(result.balanceAfterUnits, 1_000_000_000n);
  assert.throws(
    () =>
      marketTransition(picked, { type: "pick", version: 1, column: 0 }, map),
    /CLAIMED/,
  );
  assert.equal(arrived.chef, 1);
  assert.equal(arrived.pending.length, 1);
});
test("basket planning follows the chosen order, independent of stake, payout and multiplier", () => {
  const initial = freshMarket(0),
    empty = { ...initial, pantry: [0, 0, 0, 0, 0, 0, 0] };
  const ordered = marketTransition(
    empty,
    { type: "order", id: offers(empty)[0]!.id },
    new Map(),
  );
  assert(basketFit(ordered, fixture(1), 0) > basketFit(ordered, fixture(1), 1));
  assert.deepEqual(
    basket(fixture(1), 0),
    basket(
      {
        ...fixture(1),
        baseStakeUnits: 50_000_000n,
        mode: "extra",
        totalCostUnits: 75_000_000n,
        multiplier: 15,
        payoutUnits: 0n,
      },
      0,
    ),
  );
});
test("preparing spends ingredients and only the missing chef substitutes, then discovers a recipe", () => {
  const initial = freshMarket(0),
    state = { ...initial, pantry: [1, 0, 1, 1, 1, 1, 1] };
  assert(canPrepare(state, 0));
  const prepared = marketTransition(
    state,
    { type: "prepare", recipe: 0 },
    new Map(),
  );
  assert.equal(prepared.chef, 0);
  assert.equal(prepared.pantry[0], 0);
  assert.equal(prepared.pantry[6], 0);
  assert.equal(prepared.plates[0], 1);
  assert.equal(prepared.cooked[0], 1);
  assert.equal(prepared.stars, 0);
  assert.throws(
    () => marketTransition(prepared, { type: "prepare", recipe: 0 }, new Map()),
    /CANNOT/,
  );
  assert.throws(
    () => marketTransition(initial, { type: "prepare", recipe: 3 }, new Map()),
    /CANNOT/,
  );
  assert.equal(mastery(prepared.cooked[0]!), 1);
});
test("serving requires every plate, consumes them once and advances the offer board", () => {
  const initial = freshMarket(0),
    ticket = offers(initial)[1]!;
  let state = marketTransition(
    initial,
    { type: "order", id: ticket.id },
    new Map(),
  );
  assert.equal(canServe(state), false);
  assert.throws(
    () => marketTransition(state, { type: "serve", id: ticket.id }, new Map()),
    /NOT_READY/,
  );
  for (const id of [0, 1])
    state = marketTransition(state, { type: "prepare", recipe: id }, new Map());
  assert(canServe(state));
  const served = marketTransition(
    state,
    { type: "serve", id: ticket.id },
    new Map(),
  );
  assert.equal(served.stars, 4);
  assert.equal(served.served, 1);
  assert.deepEqual(served.plates, Array(9).fill(0));
  assert.deepEqual(served.cooked.slice(0, 2), [1, 1]);
  assert.notEqual(offers(served)[0]!.id, ticket.id);
  assert.throws(
    () => marketTransition(served, { type: "serve", id: ticket.id }, new Map()),
    /NOT_READY/,
  );
});
test("putting an order aside preserves every ingredient and plate; stale tickets cannot be reused", () => {
  const initial = freshMarket(0),
    ticket = offers(initial)[0]!;
  let state = marketTransition(
    initial,
    { type: "order", id: ticket.id },
    new Map(),
  );
  state = marketTransition(state, { type: "prepare", recipe: 0 }, new Map());
  const cancelled = marketTransition(
    state,
    { type: "cancel", id: ticket.id },
    new Map(),
  );
  assert.equal(cancelled.ticket, null);
  assert.deepEqual(cancelled.pantry, state.pantry);
  assert.deepEqual(cancelled.plates, state.plates);
  assert.equal(cancelled.stars, 0);
  assert.throws(
    () =>
      marketTransition(
        cancelled,
        { type: "order", id: "99:taco:0" },
        new Map(),
      ),
    /EXPIRED/,
  );
});
test("exchange is an atomic two-for-one choice, rejects unavailable stock and does not create stars", () => {
  const initial = freshMarket(0),
    traded = marketTransition(
      initial,
      { type: "trade", give: 0, take: 2 },
      new Map(),
    );
  assert.equal(traded.pantry[0], 0);
  assert.equal(traded.pantry[2], 2);
  assert.equal(traded.stars, 0);
  for (const action of [
    { type: "trade", give: 1, take: 0 },
    { type: "trade", give: 0, take: 0 },
    { type: "trade", give: 0, take: -1 },
  ] as const)
    assert.throws(
      () => marketTransition(initial, action, new Map()),
      /INVALID/,
    );
  assert.equal(initial.pantry[0], 2);
});
test("stalls open at earned milestones and cannot replace an active order", () => {
  const initial = freshMarket(0);
  assert.equal(unlocked(initial, "corn"), false);
  assert.throws(
    () => marketTransition(initial, { type: "stall", id: "corn" }, new Map()),
    /UNAVAILABLE/,
  );
  const earned = { ...initial, stars: 6 };
  const corn = marketTransition(
    earned,
    { type: "stall", id: "corn" },
    new Map(),
  );
  assert.equal(corn.stall, "corn");
  assert(offers(corn).every((offer) => offer.stall === "corn"));
  assert(canPrepare(corn, 3));
  const ordered = marketTransition(
    corn,
    { type: "order", id: offers(corn)[0]!.id },
    new Map(),
  );
  assert.throws(
    () => marketTransition(ordered, { type: "stall", id: "taco" }, new Map()),
    /UNAVAILABLE/,
  );
  assert(unlocked({ ...initial, stars: 14 }, "comal"));
  assert.deepEqual([0, 1, 2, 3, 5, 6, 20].map(mastery), [0, 1, 1, 2, 2, 3, 3]);
});
test("invalid arrivals, columns, recipe ids and over-capacity inventory are bounded", () => {
  const initial = freshMarket(0),
    result = fixture(1),
    map = new Map([[1, result]]);
  assert.throws(
    () =>
      marketTransition(
        initial,
        { type: "arrival", version: 1, request: "wrong" },
        map,
      ),
    /ARRIVAL/,
  );
  assert.throws(
    () => marketTransition(initial, { type: "prepare", recipe: NaN }, map),
    /CANNOT/,
  );
  const arrived = marketTransition(
    { ...initial, pantry: Array(7).fill(99), chef: 99 },
    { type: "arrival", version: 1, request: result.requestId },
    map,
  );
  assert.throws(
    () =>
      marketTransition(arrived, { type: "pick", version: 1, column: 3 }, map),
    /BASKET/,
  );
  const picked = marketTransition(
    arrived,
    { type: "pick", version: 1, column: 2 },
    map,
  );
  assert(picked.pantry.every((n) => n === 99));
  assert.equal(picked.chef, 99);
});
test("a welcome order survives refresh before any spin, with the same wallet identity and full credits", () => {
  const store = memory(),
    wallet = new LocalProvider(seed, store);
  const journey = new MarketJourney(wallet.seed, wallet.history, store);
  const ticket = offers(journey.state)[0]!;
  journey.dispatch({ type: "order", id: ticket.id });
  journey.dispatch({ type: "prepare", recipe: 0 });
  journey.dispatch({ type: "serve", id: ticket.id });
  const restoredWallet = new LocalProvider(
    "ffffffffffffffffffffffffffffffff",
    store,
  );
  const restoredMarket = new MarketJourney(
    restoredWallet.seed,
    restoredWallet.history,
    store,
  );
  assert.equal(restoredWallet.seed, wallet.seed);
  assert.equal(restoredWallet.history.length, 0);
  assert.equal(restoredWallet.balance, 1_000_000_000n);
  assert.deepEqual(restoredMarket.state, journey.state);
  assert.equal(restoredMarket.state.stars, 2);
  assert.equal(restoredMarket.state.cooked[0], 1);
});
test("legacy wallet history remains settled and is not retroactively harvested", async () => {
  const store = memory(),
    provider = new LocalProvider(seed, store);
  for (let i = 0; i < 3; i++) {
    const q = provider.quote(200_000n, "standard");
    await provider.accept({ quoteId: q.quoteId, requestId: `old-${i}` });
  }
  const balance = provider.balance,
    ledger = store.getItem("mercado.session.v1");
  const journey = new MarketJourney(provider.seed, provider.history, store);
  assert.equal(journey.state.start, 3);
  assert.equal(journey.pendingResult, null);
  assert.equal(provider.balance, balance);
  assert.equal(store.getItem("mercado.session.v1"), ledger);
});
test("a crash after wallet acceptance restores the unclaimed basket exactly once", async () => {
  const store = memory(),
    provider = new LocalProvider(seed, store);
  const journey = new MarketJourney(provider.seed, provider.history, store);
  const q = provider.quote(200_000n, "extra");
  const result = await provider.accept({
    quoteId: q.quoteId,
    requestId: "crash",
  });
  // Deliberately omit reconcile: the wallet write succeeded before the UI stopped.
  assert.equal(journey.pendingResult, null);
  const restoredWallet = new LocalProvider(
    "ffffffffffffffffffffffffffffffff",
    store,
  );
  const recovered = new MarketJourney(
    restoredWallet.seed,
    restoredWallet.history,
    store,
  );
  assert.equal(recovered.pendingResult?.requestId, result.requestId);
  recovered.dispatch({ type: "pick", version: 1, column: 0 });
  const state = recovered.state;
  recovered.reconcile(restoredWallet.history);
  const refreshed = new MarketJourney(
    restoredWallet.seed,
    restoredWallet.history,
    store,
  );
  assert.deepEqual(refreshed.state, state);
  assert.equal(refreshed.pendingResult, null);
  assert.equal(restoredWallet.balance, provider.balance);
  assert.throws(
    () => refreshed.dispatch({ type: "pick", version: 1, column: 1 }),
    /CLAIMED/,
  );
});
test("the journal reconstructs orders, kitchen and stars; replay never awards a second basket", () => {
  const store = memory(),
    journey = new MarketJourney(seed, [], store);
  const ticket = offers(journey.state)[0]!;
  journey.dispatch({ type: "order", id: ticket.id });
  journey.dispatch({ type: "prepare", recipe: 0 });
  journey.dispatch({ type: "serve", id: ticket.id });
  const history = [fixture(1)];
  journey.reconcile(history);
  journey.dispatch({ type: "pick", version: 1, column: 1 });
  const before = JSON.stringify(journey.state),
    raw = store.getItem(MARKET_KEY);
  journey.reconcile(history);
  assert.equal(JSON.stringify(journey.state), before);
  assert.equal(store.getItem(MARKET_KEY), raw);
  const restored = new MarketJourney(seed, history, store);
  assert.deepEqual(restored.state, journey.state);
  assert.equal(restored.state.stars, 2);
  assert.equal(restored.state.cooked[0], 1);
});
test("a corrupted campaign resets only that campaign and preserves the wallet ledger", async () => {
  const store = memory(),
    provider = new LocalProvider(seed, store);
  const q = provider.quote(200_000n, "standard");
  await provider.accept({ quoteId: q.quoteId, requestId: "valid-wallet" });
  new MarketJourney(provider.seed, provider.history, store);
  const ledger = store.getItem("mercado.session.v1"),
    balance = provider.balance;
  const saved = JSON.parse(store.getItem(MARKET_KEY)!);
  saved.actions.push({ type: "prepare", recipe: 8 });
  store.setItem(MARKET_KEY, JSON.stringify(saved));
  const restored = new MarketJourney(provider.seed, provider.history, store);
  assert(restored.recovered);
  assert.equal(restored.state.stars, 0);
  assert.equal(restored.pendingResult, null);
  assert.equal(provider.balance, balance);
  assert.equal(store.getItem("mercado.session.v1"), ledger);
});
test("an unavailable store keeps decisions in memory; stale tabs cannot overwrite newer decisions", () => {
  const ephemeral = new MarketJourney(seed, [], {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  });
  const ticket = offers(ephemeral.state)[0]!;
  ephemeral.dispatch({ type: "order", id: ticket.id });
  assert.equal(ephemeral.storageAvailable, false);
  assert.equal(ephemeral.state.ticket?.id, ticket.id);
  const store = memory(),
    first = new MarketJourney(seed, [], store),
    second = new MarketJourney(seed, [], store);
  second.dispatch({ type: "order", id: offers(second.state)[1]!.id });
  const raw = store.getItem(MARKET_KEY);
  assert.throws(
    () => first.dispatch({ type: "order", id: offers(first.state)[0]!.id }),
    /SESSION_CHANGED/,
  );
  assert.equal(store.getItem(MARKET_KEY), raw);
  assert.equal(first.state.ticket, null);
});
test("a new wallet seed starts a fresh pantry and cannot inherit old chef stars", () => {
  const store = memory(),
    before = new MarketJourney(seed, [], store),
    ticket = offers(before.state)[0]!;
  before.dispatch({ type: "order", id: ticket.id });
  before.dispatch({ type: "prepare", recipe: 0 });
  before.dispatch({ type: "serve", id: ticket.id });
  const fresh = new MarketJourney(
    "ffffffffffffffffffffffffffffffff",
    [],
    store,
  );
  assert.deepEqual(fresh.state, freshMarket(0));
});
test("a complete market visit can unlock all stalls, discover all recipes and earn nine signatures", () => {
  const journey = new MarketJourney(seed, [], memory()),
    history: Result[] = [];
  const supply = () => {
    const result = fixture(history.length + 1, wild);
    history.push(result);
    journey.reconcile(history);
    journey.dispatch({
      type: "pick",
      version: result.ledgerVersion,
      column: 0,
    });
  };
  for (let i = 0; i < 7; i++) {
    const ticket = offers(journey.state)[0]!;
    journey.dispatch({ type: "order", id: ticket.id });
    const recipe = ticket.plates.findIndex((n) => n > 0);
    while (!canPrepare(journey.state, recipe)) supply();
    journey.dispatch({ type: "prepare", recipe });
    journey.dispatch({ type: "serve", id: ticket.id });
  }
  assert.equal(journey.state.stars, 14);
  assert(unlocked(journey.state, "comal"));
  for (const stall of ["taco", "corn", "comal"] as const) {
    journey.dispatch({ type: "stall", id: stall });
    for (const [i, recipe] of RECIPES.entries())
      if (recipe.stall === stall)
        while (journey.state.cooked[i]! < 6) {
          while (!canPrepare(journey.state, i)) supply();
          journey.dispatch({ type: "prepare", recipe: i });
        }
  }
  assert(journey.state.cooked.every((n) => mastery(n) === 3));
  assert.equal(journey.state.pending.length, 0);
});
test("accepted supplies survive a failed presentation and an older receipt replay cannot advance them", async () => {
  const store = memory(),
    provider = new LocalProvider(seed, store);
  const journey = new MarketJourney(provider.seed, provider.history, store);
  const flow = new RoundController(
    provider,
    async (_result, _emit, replay) => {
      if (!replay) journey.reconcile(provider.history);
      throw new Error("renderer lost");
    },
    () => {},
  );
  await flow.spin(provider.quote(200_000n, "extra"), "display-loss");
  assert.equal(flow.presentationRecovered, true);
  assert.equal(flow.phase, "ready");
  assert.equal(journey.pendingResult?.requestId, "display-loss");
  const result = provider.history[0]!,
    balance = provider.balance;
  journey.dispatch({ type: "pick", version: 1, column: 0 });
  const before = JSON.stringify(journey.state);
  await flow.replay(result);
  assert.equal(provider.balance, balance);
  assert.equal(JSON.stringify(journey.state), before);
  assert.equal(journey.pendingResult, null);
});
test("a rejected request creates neither supplies nor a new order event", async () => {
  const provider = new LocalProvider(seed),
    journey = new MarketJourney(seed, []);
  const flow = new RoundController(
    provider,
    async () => {
      journey.reconcile(provider.history);
    },
    () => {},
  );
  const before = JSON.stringify(journey.state),
    quote = provider.quote(200_000n, "standard");
  await assert.rejects(
    flow.spin({ ...quote, quoteId: "missing" }, "rejected"),
    /MISSING/,
  );
  assert.equal(provider.history.length, 0);
  assert.equal(provider.balance, 1_000_000_000n);
  assert.equal(JSON.stringify(journey.state), before);
});
test("every new market string, recipe and stall is covered in English and Spanish", () => {
  assert.deepEqual(
    Object.keys(marketMessages["en-US"]).sort(),
    Object.keys(marketMessages["es-MX"]).sort(),
  );
  for (const locale of ["en-US", "es-MX"] as const) {
    assert(
      Object.values(marketMessages[locale]).every(
        (s) => s.length > 0 && !/[\u4e00-\u9fff]/.test(s),
      ),
    );
    assert.equal(recipeNames[locale].length, RECIPES.length);
    assert.deepEqual(Object.keys(stallNames[locale]).sort(), [
      "comal",
      "corn",
      "taco",
    ]);
    assert(
      marketText(locale, "nextUnlock", { n: 6, name: "Corn" }).includes("6"),
    );
  }
});
