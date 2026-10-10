import { ShootoutEngine } from "./engine.js";
import { commitment } from "./prf.js";

export function verifySettlement(settlement) {
  try {
    if (commitment(settlement.seedRevealed) !== settlement.commitment)
      return false;
    const engine = new ShootoutEngine({
      stake: settlement.stake,
      seed: settlement.seedRevealed,
      config: settlement.config,
      lineup: settlement.initialLineup,
    });
    for (const action of settlement.actionLog) {
      const q = engine.getQuote();
      if (!q) return false;
      if (action.startsWith("swap-")) {
        const [, a, b] = action.split("-");
        engine.adjust(Number(a), Number(b), q.quoteId);
      } else engine.submit(action, q.quoteId);
    }
    if (settlement.reason === "cashed")
      engine.cashOut(engine.getQuote()?.quoteId);
    const replayed = engine.getSettlement();
    if (
      !replayed ||
      !Number.isFinite(settlement.elapsedMs) ||
      settlement.elapsedMs < 0
    )
      return false;
    const stable = (value) =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, stable(value[key])]),
            )
          : value;
    const semantic = (record) => {
      // Wall-clock duration is observational; all rule and result data are replayed.
      const { elapsedMs: _elapsedMs, ...data } = record;
      data.events = data.events.map((e) =>
        e.kind === "coach"
          ? { ...e, slots: [...e.slots].sort((a, b) => a - b) }
          : e,
      );
      return JSON.stringify(stable(data));
    };
    return semantic(replayed) === semantic(settlement);
  } catch {
    return false;
  }
}
