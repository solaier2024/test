// Development-only entry. Vite's production input is ../index.html, so this
// fixture runner and its controls never enter the shipped game or export.
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "../src/style.css";
import { CONFIG_HASH, type Multiplier, type Mode } from "../src/core/config.ts";
import { evaluate, formatMoney, totalCost } from "../src/core/math.ts";
import { gridAt } from "../src/core/rng.ts";
import type { Result } from "../src/core/provider.ts";
import { assetUrl } from "../src/presentation/assets.ts";
import { ReelView } from "../src/presentation/view.ts";
import { winTier } from "../src/presentation/motion.ts";

let quick = false;
const cases = [
  {
    name: "No line ×15",
    stops: [12, 24, 38],
    multiplier: 15 as Multiplier,
    mode: "standard" as Mode,
  },
  {
    name: "Partial return",
    stops: [0, 0, 0],
    multiplier: 1 as Multiplier,
    mode: "standard" as Mode,
  },
  {
    name: "Maximum five Wild lines",
    stops: [1, 56, 42],
    multiplier: 15 as Multiplier,
    mode: "standard" as Mode,
  },
  {
    name: "Maximum Extra",
    stops: [1, 56, 42],
    multiplier: 15 as Multiplier,
    mode: "extra" as Mode,
  },
];
// Find real strip windows for the two neutral cases without mocking symbols.
for (
  let a = 0, foundNone = false, foundPartial = false;
  a < 64 && !(foundNone && foundPartial);
  a++
)
  for (let b = 0; b < 64; b++)
    for (let c = 0; c < 64; c++) {
      const award = evaluate(gridAt([a, b, c]), 10_000_000n, 1);
      if (!foundNone && award.payoutUnits === 0n) {
        cases[0]!.stops = [a, b, c];
        foundNone = true;
      }
      if (
        !foundPartial &&
        award.payoutUnits > 0n &&
        award.payoutUnits < 10_000_000n
      ) {
        cases[1]!.stops = [a, b, c];
        foundPartial = true;
      }
    }
document.querySelector("#app")!.innerHTML =
  `<header class="topbar"><b>INTERNAL QA · FIXTURE RESULTS · NO RANDOM DRAW</b></header><main class="game"><div class="wordmark"><img class="brand-sign" alt="Mercado de Oro" src="${assetUrl("brand-sign-v2.webp")}"></div><section class="machine"><div class="awning"></div><div class="machine-top"><span>5 ACTIVE PAYLINES</span><span>FIXTURE</span><span class="salsa-title">SALSA</span></div><div class="reel-shell"><div id="reels"></div></div><div class="machine-bottom"><span id="stage">Loading</span><span></span><span id="tier"></span></div></section><section class="result-ribbon"><span id="fixture-name"></span><strong id="award"></strong><span></span></section><section class="controls" style="display:flex;flex-wrap:wrap;justify-content:center">${cases.map((c, i) => `<button class="primary" data-case="${i}" disabled>${c.name}</button>`).join("")}<button id="skip" class="primary" disabled>Skip animation</button><button id="lite" class="primary" disabled>Lite atlas</button><label>Quick mode <input id="quick" type="checkbox"/></label></section><p class="note" id="timing"></p><p class="note" id="inspection"></p></main>`;
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
const view = new ReelView(
  $("#reels"),
  () => {},
  () => {},
);
await view.init();
view.setLocale("en-US");
document
  .querySelectorAll<HTMLButtonElement>("button")
  .forEach((button) => (button.disabled = false));
let busy = false;
document.querySelectorAll<HTMLButtonElement>("[data-case]").forEach((button) =>
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const f = cases[Number(button.dataset["case"])]!,
      base = 10_000_000n,
      grid = gridAt(f.stops),
      award = evaluate(grid, base, f.multiplier),
      cost = totalCost(base, f.mode);
    const result: Result = {
      ...award,
      grid,
      reelStops: f.stops,
      multiplier: f.multiplier,
      configHash: CONFIG_HASH,
      spinId: "QA-ONLY",
      requestId: "QA-ONLY",
      quoteId: "QA-ONLY",
      baseStakeUnits: base,
      totalCostUnits: cost,
      mode: f.mode,
      balanceAfterUnits: 1_000_000_000n - cost + award.payoutUnits,
      ledgerVersion: 1,
    };
    $("#fixture-name").textContent = f.name;
    $("#tier").textContent = winTier(result.payoutUnits, cost);
    await view.present(result, quick, (event) => {
      $("#stage").textContent = event.stage;
      $("#award").textContent = formatMoney(
        event.stage === "base"
          ? result.baseWinUnits
          : event.stage === "award"
            ? (result.payoutUnits *
                BigInt(Math.round((event.progress ?? 1) * 10_000))) /
              10_000n
            : 0n,
        "en-US",
      );
    });
    $("#timing").textContent = JSON.stringify({
      pace: $("#reels").dataset["spinPace"],
      reelStopsMs: JSON.parse(
        $("#reels").dataset["reelStopMs"] ?? "[]",
      ) as number[],
      activeMs: Number($("#reels").dataset["activeMs"]),
      frameCount: Number($("#reels").dataset["frameCount"]),
    });
    $("#inspection").innerHTML = result.lineWins
      .map(
        (line) =>
          `<button class="primary" data-line="${line.line}">Line ${line.line}</button>`,
      )
      .join("");
    document
      .querySelectorAll<HTMLButtonElement>("[data-line]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          view.inspectLine(Number(b.dataset["line"])),
        ),
      );
    busy = false;
  }),
);
$("#skip").addEventListener("click", () => view.skip());
$("#lite").addEventListener("click", () => void view.setQuality("lite"));
$("#quick").addEventListener("change", () => {
  if (!busy)
    quick = (document.querySelector("#quick") as HTMLInputElement).checked;
});
document.addEventListener("visibilitychange", () =>
  view.setHidden(document.hidden),
);
