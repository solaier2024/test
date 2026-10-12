import type { OutcomeProvider, Quote, Result } from "../core/provider.ts";
import { awardAt } from "../presentation/motion.ts";

export type RoundEvent = {
  stage: "reels" | "base" | "multiplier" | "award";
  progress?: number;
  line?: number;
};
export type Presenter = (
  result: Result,
  emit: (event: RoundEvent) => void,
  replay: boolean,
) => Promise<void>;
export class RoundController {
  phase: "ready" | "confirming" | "presenting" = "ready";
  displayBalance: bigint;
  displayedPayout = 0n;
  stage: RoundEvent["stage"] = "reels";
  accepted: Result | null;
  lastResult: Result | null;
  replaying = false;
  presentationRecovered = false;
  private provider: OutcomeProvider;
  private presenter: Presenter;
  private changed: () => void;
  constructor(
    provider: OutcomeProvider,
    presenter: Presenter,
    changed: () => void,
  ) {
    this.provider = provider;
    this.presenter = presenter;
    this.changed = changed;
    this.displayBalance = provider.balance;
    this.lastResult = provider.history.at(-1) ?? null;
    this.accepted = this.lastResult;
    this.displayedPayout = this.lastResult?.payoutUnits ?? 0n;
  }
  async spin(quote: Quote, requestId: string) {
    if (this.phase !== "ready") return false;
    this.phase = "confirming";
    this.replaying = false;
    this.presentationRecovered = false;
    this.changed();
    try {
      const result = await this.provider.accept({
        quoteId: quote.quoteId,
        requestId,
      });
      this.accepted = result;
      await this.play(result, false);
      return true;
    } catch (error) {
      this.phase = "ready";
      this.displayBalance = this.provider.balance;
      this.changed();
      throw error;
    }
  }
  async replay(result: Result) {
    if (this.phase !== "ready") return false;
    await this.play(result, true);
    return true;
  }
  private async play(result: Result, replay: boolean) {
    this.phase = "presenting";
    this.replaying = replay;
    this.stage = "reels";
    this.accepted = result;
    this.displayedPayout = 0n;
    this.displayBalance = replay
      ? this.provider.balance
      : result.balanceAfterUnits - result.payoutUnits;
    this.changed();
    try {
      await this.presenter(
        result,
        (event) => {
          this.stage = event.stage;
          if (event.stage === "base")
            this.displayedPayout = result.baseWinUnits;
          if (event.stage === "award") {
            this.displayedPayout = awardAt(
              result.payoutUnits,
              event.progress ?? 1,
            );
            if (!replay)
              this.displayBalance =
                result.balanceAfterUnits -
                result.payoutUnits +
                this.displayedPayout;
          }
          this.changed();
        },
        replay,
      );
    } catch {
      this.presentationRecovered = true;
    }
    // Accepted money is already authoritative even when the renderer fails.
    this.phase = "ready";
    this.lastResult = result;
    this.displayedPayout = result.payoutUnits;
    this.displayBalance = this.provider.balance;
    this.changed();
  }
  reset() {
    if (this.phase !== "ready") return;
    this.lastResult = null;
    this.accepted = null;
    this.replaying = false;
    this.displayedPayout = 0n;
    this.displayBalance = this.provider.balance;
    this.changed();
  }
  refresh() {
    if (this.phase !== "ready") return;
    this.lastResult = this.provider.history.at(-1) ?? null;
    this.accepted = this.lastResult;
    this.displayedPayout = this.lastResult?.payoutUnits ?? 0n;
    this.displayBalance = this.provider.balance;
    this.changed();
  }
}
