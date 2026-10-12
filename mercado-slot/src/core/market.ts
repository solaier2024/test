import type { SymbolId } from "./config.ts";
import type { Result, Store } from "./provider.ts";

export type StallId = "taco" | "corn" | "comal";
export const MARKET_KEY = "mercado.market.v1";
export const MARKET_VERSION = "night-market-1";
const CAPACITY = 99;
const EVENT_LIMIT = 40_000;
export const STALLS = [
  { id: "taco" as const, stars: 0, color: "#ca7757", symbol: 6 },
  { id: "corn" as const, stars: 6, color: "#77b697", symbol: 4 },
  { id: "comal" as const, stars: 14, color: "#d2b176", symbol: 5 },
];
export const RECIPES = [
  { stall: "taco", symbol: 6, needs: [1, 1, 0, 0, 0, 0, 1] },
  { stall: "taco", symbol: 3, needs: [1, 0, 1, 1, 0, 0, 0] },
  { stall: "taco", symbol: 6, needs: [1, 1, 1, 0, 0, 0, 2] },
  { stall: "corn", symbol: 4, needs: [0, 1, 1, 0, 1, 0, 0] },
  { stall: "corn", symbol: 4, needs: [0, 0, 1, 1, 1, 0, 0] },
  { stall: "corn", symbol: 4, needs: [1, 1, 0, 0, 2, 0, 0] },
  { stall: "comal", symbol: 5, needs: [1, 1, 0, 0, 0, 1, 0] },
  { stall: "comal", symbol: 5, needs: [0, 0, 1, 1, 0, 1, 0] },
  { stall: "comal", symbol: 5, needs: [1, 0, 0, 0, 1, 2, 0] },
] as const;
export type Ticket = Readonly<{
  id: string;
  stall: StallId;
  kind: number;
  plates: readonly number[];
  stars: number;
}>;
export type MarketState = Readonly<{
  start: number;
  last: number;
  pending: readonly number[];
  pantry: readonly number[];
  chef: number;
  plates: readonly number[];
  cooked: readonly number[];
  stars: number;
  served: number;
  stall: StallId;
  ticket: Ticket | null;
}>;
export type MarketAction =
  | { type: "arrival"; version: number; request: string }
  | { type: "pick"; version: number; column: number }
  | { type: "order"; id: string }
  | { type: "prepare"; recipe: number }
  | { type: "serve"; id: string }
  | { type: "cancel"; id: string }
  | { type: "stall"; id: StallId }
  | { type: "trade"; give: number; take: number };
export type PlayerAction = Exclude<MarketAction, { type: "arrival" }>;

function frozen(state: MarketState): MarketState {
  for (const array of [state.pantry, state.plates, state.cooked, state.pending])
    Object.freeze(array);
  return Object.freeze(state);
}
export function freshMarket(start: number): MarketState {
  return frozen({
    start,
    last: start,
    pending: [],
    pantry: [2, 1, 1, 1, 1, 1, 1],
    chef: 1,
    plates: Array(9).fill(0),
    cooked: Array(9).fill(0),
    stars: 0,
    served: 0,
    stall: "taco",
    ticket: null,
  });
}
export function unlocked(state: MarketState, stall: StallId): boolean {
  const definition = STALLS.find((s) => s.id === stall);
  return !!definition && state.stars >= definition.stars;
}
export function offers(state: MarketState): readonly Ticket[] {
  const ids = RECIPES.map((r, i) => (r.stall === state.stall ? i : -1)).filter(
    (i) => i >= 0,
  );
  const first = state.served % 3;
  return [0, 1, 2].map((kind) => {
    const plates: number[] = Array(9).fill(0);
    plates[ids[first]!] = kind === 2 ? 2 : 1;
    if (kind > 0) plates[ids[(first + kind) % 3]!] = 1;
    return Object.freeze({
      id: `${state.served}:${state.stall}:${kind}`,
      stall: state.stall,
      kind,
      plates: Object.freeze(plates),
      stars: [2, 4, 6][kind]!,
    });
  });
}
export function missing(state: MarketState, recipe: number): number {
  const definition = RECIPES[recipe];
  if (!definition) return Infinity;
  return definition.needs.reduce<number>(
    (sum, n, i) => sum + Math.max(0, n - state.pantry[i]!),
    0,
  );
}
export function canPrepare(state: MarketState, recipe: number): boolean {
  const definition = RECIPES[recipe];
  return (
    !!definition &&
    unlocked(state, definition.stall) &&
    state.plates[recipe]! < CAPACITY &&
    missing(state, recipe) <= state.chef
  );
}
export function canServe(state: MarketState): boolean {
  return (
    !!state.ticket && state.ticket.plates.every((n, i) => state.plates[i]! >= n)
  );
}
export function mastery(count: number): number {
  return count >= 6 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
}
export function basket(result: Result, column: number) {
  if (!Number.isInteger(column) || column < 0 || column > 2)
    throw new Error("INVALID_BASKET");
  const ingredients: number[] = Array(7).fill(0);
  const symbols = result.grid.map((row) => row[column]!) as SymbolId[];
  let chef = 0;
  for (const symbol of symbols) {
    if (symbol === 7) chef++;
    else ingredients[symbol]!++;
  }
  return { ingredients, chef, symbols };
}
export function basketFit(
  state: MarketState,
  result: Result,
  column: number,
): number {
  const stock = basket(result, column);
  if (!state.ticket)
    return stock.ingredients.filter((n) => n > 0).length + stock.chef;
  const needs: number[] = Array(7).fill(0);
  for (const [i, count] of state.ticket.plates.entries())
    for (const [j, quantity] of RECIPES[i]!.needs.entries())
      needs[j]! += Math.max(0, count - state.plates[i]!) * quantity;
  return (
    stock.chef +
    stock.ingredients.reduce(
      (sum, n, i) =>
        sum + Math.min(n, Math.max(0, needs[i]! - state.pantry[i]!)),
      0,
    )
  );
}

// Decisions consume provisions and award chef stars only. No money, odds or
// random stream enters this reducer. An invalid action leaves the old state intact.
export function marketTransition(
  previous: MarketState,
  action: MarketAction,
  results: ReadonlyMap<number, Result>,
): MarketState {
  const state = {
    ...previous,
    pending: [...previous.pending],
    pantry: [...previous.pantry],
    plates: [...previous.plates],
    cooked: [...previous.cooked],
  };
  const integer = (n: number, bound: number) =>
    Number.isInteger(n) && n >= 0 && n < bound;
  switch (action.type) {
    case "arrival": {
      const result = results.get(action.version);
      if (
        !result ||
        result.requestId !== action.request ||
        action.version !== state.last + 1
      )
        throw new Error("INVALID_ARRIVAL");
      state.last = action.version;
      state.pending.push(action.version);
      break;
    }
    case "pick": {
      if (state.pending[0] !== action.version)
        throw new Error("BASKET_ALREADY_CLAIMED");
      const result = results.get(action.version);
      if (!result) throw new Error("RESULT_MISSING");
      const stock = basket(result, action.column);
      state.pantry = state.pantry.map((n, i) =>
        Math.min(CAPACITY, n + stock.ingredients[i]!),
      );
      state.chef = Math.min(CAPACITY, state.chef + stock.chef);
      state.pending.shift();
      break;
    }
    case "order": {
      if (state.ticket) throw new Error("ORDER_ACTIVE");
      const ticket = offers(state).find((o) => o.id === action.id);
      if (!ticket) throw new Error("ORDER_EXPIRED");
      state.ticket = ticket;
      break;
    }
    case "prepare": {
      if (
        !integer(action.recipe, RECIPES.length) ||
        !canPrepare(state, action.recipe)
      )
        throw new Error("CANNOT_PREPARE");
      const definition = RECIPES[action.recipe]!;
      const requiredChef = missing(state, action.recipe);
      state.pantry = state.pantry.map((n, i) =>
        Math.max(0, n - definition.needs[i]!),
      );
      state.chef -= requiredChef;
      state.plates[action.recipe]!++;
      state.cooked[action.recipe]!++;
      break;
    }
    case "serve": {
      if (state.ticket?.id !== action.id || !canServe(state))
        throw new Error("ORDER_NOT_READY");
      state.plates = state.plates.map((n, i) => n - state.ticket!.plates[i]!);
      state.stars += state.ticket.stars;
      state.served++;
      state.ticket = null;
      break;
    }
    case "cancel":
      if (state.ticket?.id !== action.id) throw new Error("ORDER_EXPIRED");
      state.ticket = null;
      break;
    case "stall":
      if (!unlocked(state, action.id) || state.ticket)
        throw new Error("STALL_UNAVAILABLE");
      state.stall = action.id;
      break;
    case "trade":
      if (
        !integer(action.give, 7) ||
        !integer(action.take, 7) ||
        action.give === action.take ||
        state.pantry[action.give]! < 2 ||
        state.pantry[action.take]! >= CAPACITY
      )
        throw new Error("INVALID_TRADE");
      state.pantry[action.give]! -= 2;
      state.pantry[action.take]!++;
      break;
    default:
      throw new Error("INVALID_MARKET_ACTION");
  }
  return frozen(state);
}

type Journal = {
  version: string;
  seed: string;
  start: number;
  actions: MarketAction[];
};
export class MarketJourney {
  private current: MarketState;
  private journal: Journal;
  private results = new Map<number, Result>();
  private savedRaw: string | null = null;
  private store?: Store;
  revision = 0;
  storageAvailable = true;
  recovered = false;
  constructor(seed: string, history: readonly Result[], store?: Store) {
    this.store = store;
    for (const result of history)
      this.results.set(result.ledgerVersion, result);
    this.current = freshMarket(history.length);
    this.journal = {
      version: MARKET_VERSION,
      seed,
      start: history.length,
      actions: [],
    };
    try {
      this.savedRaw = store?.getItem(MARKET_KEY) ?? null;
    } catch {
      this.storageAvailable = false;
    }
    if (this.savedRaw) {
      try {
        const saved = JSON.parse(this.savedRaw) as Journal;
        if (saved.seed === seed) {
          if (
            saved.version !== MARKET_VERSION ||
            !Number.isInteger(saved.start) ||
            saved.start < 0 ||
            saved.start > history.length ||
            !Array.isArray(saved.actions) ||
            saved.actions.length > EVENT_LIMIT
          )
            throw new Error("INVALID_MARKET_JOURNAL");
          let current = freshMarket(saved.start);
          for (const action of saved.actions) {
            if (!action || typeof action !== "object")
              throw new Error("INVALID_ACTION");
            current = marketTransition(current, action, this.results);
          }
          this.current = current;
          this.journal = saved;
        }
      } catch {
        this.recovered = true;
      }
    }
    this.reconcile(history);
    this.save();
  }
  get state(): MarketState {
    return this.current;
  }
  get pendingResult(): Result | null {
    return this.results.get(this.current.pending[0]!) ?? null;
  }
  private checkSession() {
    if (!this.storageAvailable || !this.store) return;
    try {
      if (this.store.getItem(MARKET_KEY) !== this.savedRaw)
        throw new Error("MARKET_SESSION_CHANGED");
    } catch (error) {
      if (error instanceof Error && error.message === "MARKET_SESSION_CHANGED")
        throw error;
      this.storageAvailable = false;
    }
  }
  private append(action: MarketAction) {
    if (this.journal.actions.length >= EVENT_LIMIT)
      throw new Error("MARKET_JOURNAL_FULL");
    this.current = marketTransition(this.current, action, this.results);
    this.journal.actions.push(action);
    this.revision++;
  }
  reconcile(history: readonly Result[]) {
    if (history.length <= this.current.last) return;
    this.checkSession();
    for (const result of history)
      this.results.set(result.ledgerVersion, result);
    for (
      let version = this.current.last + 1;
      version <= history.length;
      version++
    ) {
      const result = this.results.get(version)!;
      this.append({ type: "arrival", version, request: result.requestId });
    }
    this.save();
  }
  dispatch(action: PlayerAction) {
    this.checkSession();
    this.append(action);
    this.save();
  }
  private save() {
    try {
      const raw = JSON.stringify(this.journal);
      this.store?.setItem(MARKET_KEY, raw);
      this.savedRaw = raw;
    } catch {
      this.storageAvailable = false;
    }
  }
}
