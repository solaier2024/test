import {
  BASE_STAKES,
  CONFIG_HASH,
  INITIAL_BALANCE,
  MAX_SESSION_SPINS,
  type Grid,
  type Mode,
  type Multiplier,
} from "./config.ts";
import { evaluate, totalCost, type LineWin } from "./math.ts";
import { draw } from "./rng.ts";

export type Quote = Readonly<{
  quoteId: string;
  configHash: string;
  baseStakeUnits: bigint;
  totalCostUnits: bigint;
  mode: Mode;
}>;
export type SpinRequest = Readonly<{ requestId: string; quoteId: string }>;
export type Result = Readonly<{
  spinId: string;
  requestId: string;
  quoteId: string;
  configHash: string;
  mode: Mode;
  baseStakeUnits: bigint;
  totalCostUnits: bigint;
  grid: Grid;
  reelStops: readonly number[];
  lineWins: readonly LineWin[];
  sumPayTenths: number;
  baseWinUnits: bigint;
  multiplier: Multiplier;
  payoutUnits: bigint;
  balanceAfterUnits: bigint;
  ledgerVersion: number;
}>;
type Event = { requestId: string; quoteId: string; base: string; mode: Mode };
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type OutcomeProvider = Pick<
  LocalProvider,
  "quote" | "accept" | "balance" | "history"
>;
const STORAGE_KEY = "mercado.session.v1";

export class LocalProvider {
  private quotes = new Map<string, Quote>();
  private accepted = new Map<string, Result>();
  private usedQuotes = new Set<string>();
  private events: Event[] = [];
  private quoteSequence = 0;
  private currentBalance = INITIAL_BALANCE;
  private results: Result[] = [];
  private currentSeed: string;
  get seed() {
    return this.currentSeed;
  }
  storageAvailable = true;
  restored = false;
  restoreRejected = false;
  private storage?: Store;

  constructor(seed: string, storage?: Store) {
    if (!/^[a-f0-9]{32}$/.test(seed)) throw new Error("INVALID_SEED");
    this.storage = storage;
    this.currentSeed = seed;
    let raw: string | null | undefined;
    try {
      raw = storage?.getItem(STORAGE_KEY);
    } catch {
      this.storageAvailable = false;
      return;
    }
    try {
      if (!raw) {
        // Keep the identity stable even when the welcome market is played
        // before a first spin. No debit, draw or ledger event is created here.
        this.save();
        return;
      }
      const snapshot = JSON.parse(raw) as Record<string, unknown>;
      if (
        snapshot["config"] !== CONFIG_HASH ||
        typeof snapshot["seed"] !== "string" ||
        !/^[a-f0-9]{32}$/.test(snapshot["seed"]) ||
        !Array.isArray(snapshot["events"]) ||
        snapshot["events"].length > MAX_SESSION_SPINS
      )
        throw new Error("Invalid saved session");
      this.currentSeed = snapshot["seed"];
      for (const item of snapshot["events"]) {
        if (!item || typeof item !== "object") throw new Error("Invalid event");
        const event = item as Event;
        if (
          typeof event.requestId !== "string" ||
          event.requestId.length > 80 ||
          !event.requestId ||
          typeof event.quoteId !== "string" ||
          event.quoteId.length > 80 ||
          !event.quoteId ||
          typeof event.base !== "string" ||
          !/^\d{1,9}$/.test(event.base) ||
          !["standard", "extra"].includes(event.mode)
        )
          throw new Error("Invalid event");
        const quote = Object.freeze({
          quoteId: event.quoteId,
          configHash: CONFIG_HASH,
          baseStakeUnits: BigInt(event.base),
          mode: event.mode,
          totalCostUnits: totalCost(BigInt(event.base), event.mode),
        });
        this.commit(
          { requestId: event.requestId, quoteId: event.quoteId },
          quote,
        );
      }
      this.restored = this.results.length > 0;
    } catch {
      this.currentSeed = seed;
      this.currentBalance = INITIAL_BALANCE;
      this.events = [];
      this.results = [];
      this.accepted.clear();
      this.usedQuotes.clear();
      this.restoreRejected = true;
      this.save();
    }
  }
  get balance() {
    return this.currentBalance;
  }
  get history(): readonly Result[] {
    return this.results;
  }

  quote(baseStakeUnits: bigint, mode: Mode): Quote {
    if (
      !BASE_STAKES.includes(baseStakeUnits as (typeof BASE_STAKES)[number]) ||
      !["standard", "extra"].includes(mode)
    )
      throw new Error("INVALID_QUOTE");
    const quote = Object.freeze({
      quoteId: `q-${this.events.length}-${++this.quoteSequence}`,
      configHash: CONFIG_HASH,
      baseStakeUnits,
      mode,
      totalCostUnits: totalCost(baseStakeUnits, mode),
    });
    if (this.quotes.size >= 64)
      this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }
  async accept(request: SpinRequest): Promise<Result> {
    const prior = this.accepted.get(request.requestId);
    if (prior) {
      if (prior.quoteId !== request.quoteId)
        throw new Error("REQUEST_CONFLICT");
      return prior;
    }
    const quote = this.quotes.get(request.quoteId);
    if (!quote) throw new Error("QUOTE_MISSING");
    const result = this.commit(request, quote);
    this.quotes.delete(request.quoteId);
    this.save();
    return result;
  }
  private commit(request: SpinRequest, quote: Quote): Result {
    if (
      typeof request.requestId !== "string" ||
      !request.requestId ||
      request.requestId.length > 80 ||
      this.accepted.has(request.requestId) ||
      this.usedQuotes.has(quote.quoteId)
    )
      throw new Error("INVALID_REQUEST");
    if (this.events.length >= MAX_SESSION_SPINS)
      throw new Error("SESSION_FULL");
    if (
      !BASE_STAKES.includes(
        quote.baseStakeUnits as (typeof BASE_STAKES)[number],
      )
    )
      throw new Error("INVALID_QUOTE");
    if (this.currentBalance < quote.totalCostUnits)
      throw new Error("INSUFFICIENT_CREDITS");
    const outcome = draw(this.seed, request.requestId, quote.mode);
    const evaluated = evaluate(
      outcome.grid,
      quote.baseStakeUnits,
      outcome.multiplier,
    );
    const balanceAfterUnits =
      this.currentBalance - quote.totalCostUnits + evaluated.payoutUnits;
    const result = Object.freeze({
      ...quote,
      ...outcome,
      ...evaluated,
      spinId: `MD-${String(this.events.length + 1).padStart(4, "0")}`,
      requestId: request.requestId,
      balanceAfterUnits,
      ledgerVersion: this.events.length + 1,
    });
    // One synchronous transaction, before any animation or async suspension.
    this.currentBalance = balanceAfterUnits;
    this.accepted.set(request.requestId, result);
    this.usedQuotes.add(quote.quoteId);
    this.results.push(result);
    this.events.push({
      ...request,
      base: quote.baseStakeUnits.toString(),
      mode: quote.mode,
    });
    return result;
  }
  private save() {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          config: CONFIG_HASH,
          seed: this.seed,
          events: this.events,
        }),
      );
    } catch {
      this.storageAvailable = false;
    }
  }
  reset(seed: string) {
    if (!/^[a-f0-9]{32}$/.test(seed)) throw new Error("INVALID_SEED");
    this.currentSeed = seed;
    this.currentBalance = INITIAL_BALANCE;
    this.events = [];
    this.results = [];
    this.quoteSequence = 0;
    this.quotes.clear();
    this.accepted.clear();
    this.usedQuotes.clear();
    this.restored = false;
    this.restoreRejected = false;
    this.save();
  }
}
