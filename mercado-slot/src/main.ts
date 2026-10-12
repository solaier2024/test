import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./style.css";
import {
  BASE_STAKES,
  MAX_SESSION_SPINS,
  PAY_TENTHS,
  type Mode,
} from "./core/config.ts";
import { formatMoney } from "./core/math.ts";
import {
  LocalProvider,
  type Quote,
  type Result,
  type Store,
} from "./core/provider.ts";
import { symbolNames, t, type Locale, type MessageKey } from "./i18n.ts";
import { MarketAudio } from "./presentation/audio.ts";
import type { ReelView } from "./presentation/view.ts";

type Preferences = {
  locale: Locale;
  baseIndex: number;
  mode: Mode;
  turbo: boolean;
  sound: boolean;
  guide: boolean;
};
const defaults: Preferences = {
  locale: "es-MX",
  baseIndex: 5,
  mode: "standard",
  turbo: false,
  sound: true,
  guide: false,
};
const storage: Store = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
let prefs = { ...defaults };
try {
  const saved = JSON.parse(
    storage.getItem("mercado.preferences.v1") ?? "{}",
  ) as Partial<Preferences>;
  if (saved.locale === "es-MX" || saved.locale === "en-US")
    prefs.locale = saved.locale;
  if (
    Number.isInteger(saved.baseIndex) &&
    saved.baseIndex! >= 0 &&
    saved.baseIndex! < BASE_STAKES.length
  )
    prefs.baseIndex = saved.baseIndex!;
  if (saved.mode === "standard" || saved.mode === "extra")
    prefs.mode = saved.mode;
  for (const key of ["turbo", "sound", "guide"] as const)
    if (typeof saved[key] === "boolean") prefs[key] = saved[key];
} catch {
  /* Defaults work when storage is disabled or malformed. */
}
const freshSeed = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16).padStart(8, "0"),
  ).join("");
const provider = new LocalProvider(freshSeed(), storage);
let phase: "loading" | "ready" | "confirming" | "presenting" | "failed" =
  "loading";
let view: ReelView | null = null;
let lastResult: Result | null = provider.history.at(-1) ?? null;
let quote: Quote = provider.quote(BASE_STAKES[prefs.baseIndex]!, prefs.mode);
let replaying = false;
let graphicsReady = true;
let notice: MessageKey | null = null;
let selectedReceipt: Result | null = null;
const audio = new MarketAudio();
audio.enabled = prefs.sound;
const money = (amount: bigint, signed = false) =>
  formatMoney(amount, prefs.locale, signed);
const text = (key: Parameters<typeof t>[1]) => t(prefs.locale, key);
const setNotice = (key: MessageKey | null) => {
  notice = key;
  $("#note").textContent = key ? text(key) : "";
};
const busy = () => phase === "confirming" || phase === "presenting";
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const icon = (name: "sound" | "history" | "menu" | "spin") => {
  const paths = {
    sound:
      '<path d="M11 4 6 8H3v8h3l5 4V4Z"/><path d="M15 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14"/>',
    history: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    spin: '<path d="M19 8a8 8 0 1 0 1 8M19 3v5h-5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};
$("#app").innerHTML = `
  <div class="market-backdrop" aria-hidden="true"></div>
  <header class="topbar">
    <span class="edition">MD / ORO <span>01</span></span>
    <div class="tools">
      <button id="sound" class="icon-button">${icon("sound")}</button>
      <button id="history" class="icon-button">${icon("history")}</button>
      <label class="locale-label"><span class="sr-only" data-i18n="language"></span><select id="locale"><option value="es-MX">ES</option><option value="en-US">EN</option></select></label>
      <button id="menu" class="icon-button">${icon("menu")}</button>
    </div>
  </header>
  <main class="game">
    <div class="wordmark"><span class="brand-top">MERCADO</span><h1>de <strong>ORO</strong></h1><p data-i18n="tagline"></p></div>
    <section class="machine" aria-label="Mercado de Oro">
      <div class="machine-top"><span class="paylines" data-i18n="fiveLines"></span><span class="market-mark">M / O</span><span class="salsa-title" data-i18n="salsa"></span></div>
      <div class="reel-shell"><div id="reels"><div class="loader"><span class="loading-ring"></span><p data-i18n="loading"></p></div></div></div>
      <div class="machine-bottom"><button id="rules"><span data-i18n="rules"></span><span class="info-symbol">i</span></button><span class="axis-caption" data-i18n="independent"></span></div>
    </section>
    <section class="result-strip" aria-live="polite" aria-atomic="true">
      <div class="result-copy"><span id="result-title" class="eyebrow"></span><p id="result-message"></p></div>
      <button id="receipt-button" class="last-payout"><span data-i18n="payout"></span><strong id="last-payout">$0.00</strong><span class="receipt-arrow">↗</span></button>
    </section>
    <section class="controls">
      <div class="bet-row"><label class="bet-field"><span data-i18n="base"></span><select id="base"></select></label>
        <label class="extra-switch"><input type="checkbox" id="extra"/><span class="switch-track"></span><span class="extra-copy"><strong data-i18n="extra"></strong><small id="extra-hint"></small></span></label>
      </div>
      <div class="spin-row"><div class="cost"><span data-i18n="cost"></span><strong id="cost"></strong><small data-i18n="creditUnit"></small></div>
        <button id="spin" class="spin-button">${icon("spin")}<span></span></button>
        <label class="turbo-control"><input type="checkbox" id="turbo"/><span>ϟ</span><small data-i18n="turbo"></small></label>
      </div>
    </section>
    <footer class="game-footer"><div class="balance"><span data-i18n="balance"></span><strong id="balance"></strong></div><span class="demo-label" data-i18n="demo"></span></footer>
    <p id="note" class="note" role="status"></p>
    <div id="accessible-grid" class="sr-only"></div>
  </main>
  <dialog id="guide-dialog" class="guide-dialog"></dialog>
  <dialog id="history-dialog"></dialog>
  <dialog id="receipt-dialog"></dialog>
  <dialog id="menu-dialog" class="compact-dialog"></dialog>
  <dialog id="reset-dialog" class="compact-dialog"></dialog>`;

const savePreferences = () => {
  try {
    storage.setItem("mercado.preferences.v1", JSON.stringify(prefs));
  } catch {
    /* Optional preferences. */
  }
};
function newQuote() {
  quote = provider.quote(BASE_STAKES[prefs.baseIndex]!, prefs.mode);
}
function update() {
  document.documentElement.lang = prefs.locale;
  $("#note").textContent = notice ? text(notice) : "";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    node.textContent = text(node.dataset["i18n"] as Parameters<typeof t>[1]);
  });
  $("#locale").setAttribute("aria-label", text("language"));
  $<HTMLSelectElement>("#locale").value = prefs.locale;
  const base = $<HTMLSelectElement>("#base");
  base.innerHTML = BASE_STAKES.map(
    (amount, i) => `<option value="${i}">${money(amount)}</option>`,
  ).join("");
  base.value = String(prefs.baseIndex);
  base.disabled =
    busy() || phase === "loading" || phase === "failed" || !graphicsReady;
  $<HTMLInputElement>("#extra").checked = prefs.mode === "extra";
  $<HTMLInputElement>("#extra").disabled = base.disabled;
  $<HTMLInputElement>("#turbo").checked = prefs.turbo;
  $<HTMLInputElement>("#turbo").disabled = busy();
  $("#extra-hint").textContent = text(
    prefs.mode === "extra" ? "extraHint" : "extraOff",
  );
  $("#cost").textContent = money(quote.totalCostUnits);
  $("#balance").textContent = money(provider.balance);
  $("#sound").setAttribute(
    "aria-label",
    text(prefs.sound ? "soundOn" : "soundOff"),
  );
  $("#sound").setAttribute("aria-pressed", String(prefs.sound));
  $("#sound").classList.toggle("muted", !prefs.sound);
  $("#history").setAttribute("aria-label", text("history"));
  $("#menu").setAttribute("aria-label", text("menu"));
  const button = $<HTMLButtonElement>("#spin");
  button.disabled =
    phase === "loading" ||
    phase === "failed" ||
    phase === "confirming" ||
    !graphicsReady;
  button.classList.toggle("is-revealing", phase === "presenting");
  button.querySelector("span")!.textContent = text(
    phase === "confirming"
      ? "confirming"
      : phase === "presenting"
        ? "revealing"
        : "spin",
  );
  $("#receipt-button").setAttribute("aria-label", text("receipt"));
  $<HTMLButtonElement>("#receipt-button").disabled = !lastResult || busy();
  $<HTMLButtonElement>("#history").disabled = busy();
  $<HTMLButtonElement>("#menu").disabled = busy();
  $<HTMLButtonElement>("#rules").disabled = busy();
  $(".machine").classList.toggle("extra-active", prefs.mode === "extra");
  $(".game").dataset["phase"] = phase;
  if (busy()) {
    $(".result-strip").classList.remove("profit");
    $("#result-title").textContent = replaying
      ? text("replaying")
      : text("result");
    $("#result-message").textContent = text(
      replaying ? "replayHint" : "spinning",
    );
  } else if (lastResult) {
    const profit = lastResult.payoutUnits > lastResult.totalCostUnits;
    $("#result-title").textContent = replaying
      ? text("replaying")
      : lastResult.payoutUnits === 0n
        ? text("noWin")
        : profit
          ? text("win")
          : text("returned");
    $("#result-message").textContent =
      lastResult.payoutUnits === 0n
        ? text("noWinHint")
        : `${lastResult.lineWins.length} ${text(lastResult.lineWins.length === 1 ? "lineWon" : "linesWon")} · ×${lastResult.multiplier} · ${text("net")} ${money(lastResult.payoutUnits - lastResult.totalCostUnits, true)}`;
    $("#last-payout").textContent = money(lastResult.payoutUnits);
    $(".result-strip").classList.toggle("profit", profit && !replaying);
    $("#accessible-grid").textContent =
      `${text("board")}: ${lastResult.grid.map((row) => row.map((s) => symbolNames[prefs.locale][s]).join(", ")).join("; ")}. ${text("multiplier")}: ${lastResult.multiplier}. ${text("payout")}: ${money(lastResult.payoutUnits)}.`;
  } else {
    $("#result-title").textContent = text("result");
    $("#result-message").textContent = text("ready");
    $("#last-payout").textContent = money(0n);
    $(".result-strip").classList.remove("profit");
  }
  view?.setLocale(prefs.locale);
}
function modalHeader(title: string, eyebrow = "") {
  return `<div class="dialog-header"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h2>${title}</h2></div><button class="dialog-close" aria-label="${text("close")}">×</button></div>`;
}
function showDialog(id: string, html: string) {
  const dialog = $<HTMLDialogElement>(id);
  dialog.innerHTML = html;
  dialog
    .querySelector(".dialog-close")
    ?.addEventListener("click", () => dialog.close());
  dialog.showModal();
}
function guide() {
  const stepLines =
    '<svg viewBox="0 0 120 65" aria-hidden="true"><path d="M9 12H111M9 32H111M9 52H111M9 12 60 32 111 52M9 52 60 32 111 12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="12" r="3"/><circle cx="111" cy="52" r="3"/></svg>';
  showDialog(
    "#guide-dialog",
    `${modalHeader(text("guideTitle"), text("guideEyebrow"))}<div class="guide-steps">
    <article><span class="step-number">01</span><div><h3>${text("step1Title")}</h3><p>${text("step1")}</p></div>${stepLines}</article>
    <article><span class="step-number">02</span><div><h3>${text("step2Title")}</h3><p>${text("step2")}</p></div><span class="sample-multiplier">×15</span></article>
    <article><span class="step-number">03</span><div><h3>${text("step3Title")}</h3><p>${text("step3")}</p></div></article>
    </div><details class="paytable"><summary>${text("paytable")}</summary><p>${text("paytableHint")}</p><div class="paytable-grid">${symbolNames[prefs.locale].map((name, i) => `<div><span class="food-thumb food-${i}" aria-hidden="true"></span><span>${name}</span><strong>×${PAY_TENTHS[i]! / 10}</strong></div>`).join("")}</div></details>
    <p class="rules-footnote">${text("maximum")}<br>${text("noBonus")}</p><button id="guide-start" class="primary">${text("guideStart")}</button>`,
  );
  $("#guide-start").addEventListener("click", () =>
    $<HTMLDialogElement>("#guide-dialog").close(),
  );
}
function showHistory() {
  showDialog(
    "#history-dialog",
    `${modalHeader(text("history"))}<div class="history-list">${
      provider.history.length
        ? provider.history
            .slice(-30)
            .reverse()
            .map(
              (result) =>
                `<button class="history-card" data-version="${result.ledgerVersion}"><span><strong>${result.spinId}</strong><small>${result.mode === "extra" ? text("extra") : text("base")} · ${money(result.totalCostUnits)}</small></span><span><strong>${money(result.payoutUnits)}</strong><small class="${result.payoutUnits > result.totalCostUnits ? "positive" : ""}">${money(result.payoutUnits - result.totalCostUnits, true)} · ×${result.multiplier}</small></span><b>↗</b></button>`,
            )
            .join("")
        : `<p>${text("empty")}</p>`
    }</div>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>(".history-card")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const result = provider.history.find(
          (r) => r.ledgerVersion === Number(button.dataset["version"]),
        );
        if (result) {
          $<HTMLDialogElement>("#history-dialog").close();
          showReceipt(result);
        }
      }),
    );
}
function showReceipt(result: Result) {
  selectedReceipt = result;
  showDialog(
    "#receipt-dialog",
    `${modalHeader(text("receipt"), result.spinId)}
    <div class="receipt-grid">${result.grid
      .flat()
      .map(
        (s) =>
          `<span class="food-thumb food-${s}" role="img" aria-label="${symbolNames[prefs.locale][s]}"></span>`,
      )
      .join(
        "",
      )}<strong class="receipt-multiplier">×${result.multiplier}</strong></div>
    <dl class="receipt-money"><div><dt>${text("base")}</dt><dd>${money(result.baseStakeUnits)}</dd></div><div><dt>${text("cost")}${result.mode === "extra" ? " · Extra Salsa" : ""}</dt><dd>${money(result.totalCostUnits)}</dd></div><div><dt>${text("baseWin")}</dt><dd>${money(result.baseWinUnits)}</dd></div><div><dt>${text("payout")}</dt><dd>${money(result.payoutUnits)}</dd></div><div><dt>${text("net")}</dt><dd>${money(result.payoutUnits - result.totalCostUnits, true)}</dd></div></dl>
    <ul class="line-receipts">${result.lineWins.map((line) => `<li><span>${text("line")} ${line.line} · ${symbolNames[prefs.locale][line.symbol]}</span><strong>${money(line.payoutUnits)}</strong></li>`).join("") || `<li>${text("noWin")}</li>`}</ul>
    <button id="replay" class="primary">${text("replay")}</button><p class="rules-footnote">${text("replayHint")}</p>`,
  );
  $("#replay").addEventListener("click", () => {
    $<HTMLDialogElement>("#receipt-dialog").close();
    if (selectedReceipt && phase === "ready")
      void present(selectedReceipt, true);
  });
}
function menu() {
  showDialog(
    "#menu-dialog",
    `${modalHeader(text("menu"))}<div class="menu-actions"><button id="menu-rules">${text("rules")} ↗</button><button id="menu-history">${text("history")} ↗</button><button id="menu-reset">${text("reset")} ↗</button></div>`,
  );
  $("#menu-rules").addEventListener("click", () => {
    $<HTMLDialogElement>("#menu-dialog").close();
    guide();
  });
  $("#menu-history").addEventListener("click", () => {
    $<HTMLDialogElement>("#menu-dialog").close();
    showHistory();
  });
  $("#menu-reset").addEventListener("click", () => {
    $<HTMLDialogElement>("#menu-dialog").close();
    showDialog(
      "#reset-dialog",
      `${modalHeader(text("resetTitle"))}<p>${text("resetHint")}</p><div class="dialog-actions"><button id="cancel-reset">${text("cancel")}</button><button id="confirm-reset" class="primary">${text("resetConfirm")}</button></div>`,
    );
    $("#cancel-reset").addEventListener("click", () =>
      $<HTMLDialogElement>("#reset-dialog").close(),
    );
    $("#confirm-reset").addEventListener("click", () => {
      const seed = freshSeed();
      provider.reset(seed);
      lastResult = null;
      replaying = false;
      selectedReceipt = null;
      newQuote();
      view?.showIdle(prefs.mode);
      setNotice(provider.storageAvailable ? null : "storageFailed");
      update();
      $<HTMLDialogElement>("#reset-dialog").close();
    });
  });
}
async function present(result: Result, replay: boolean) {
  if (!view) return;
  replaying = replay;
  phase = "presenting";
  update();
  await view.present(result, prefs.turbo);
  lastResult = result;
  phase = "ready";
  if (!replay && result.payoutUnits > result.totalCostUnits)
    audio.cue("profit");
  update();
}
async function spin() {
  if (phase === "presenting") {
    view?.skip();
    return;
  }
  if (phase !== "ready") return;
  if (provider.history.length >= MAX_SESSION_SPINS) {
    setNotice("sessionFull");
    return;
  }
  if (provider.balance < quote.totalCostUnits) {
    setNotice("insufficient");
    return;
  }
  phase = "confirming";
  replaying = false;
  setNotice(null);
  update();
  void audio.unlock();
  try {
    const result = await provider.accept({
      requestId: crypto.randomUUID(),
      quoteId: quote.quoteId,
    });
    audio.cue("spin");
    newQuote();
    await present(result, false);
    if (!provider.storageAvailable) setNotice("storageFailed");
  } catch {
    phase = "ready";
    setNotice("error");
    update();
  }
}
$("#spin").addEventListener("click", () => void spin());
$("#base").addEventListener("change", () => {
  if (busy()) return;
  prefs.baseIndex = Number($<HTMLSelectElement>("#base").value);
  newQuote();
  savePreferences();
  update();
});
$("#extra").addEventListener("change", () => {
  if (busy()) return;
  prefs.mode = $<HTMLInputElement>("#extra").checked ? "extra" : "standard";
  newQuote();
  savePreferences();
  if (!lastResult) view?.showIdle(prefs.mode);
  update();
});
$("#turbo").addEventListener("change", () => {
  prefs.turbo = $<HTMLInputElement>("#turbo").checked;
  savePreferences();
  update();
});
$("#locale").addEventListener("change", () => {
  prefs.locale = $<HTMLSelectElement>("#locale").value as Locale;
  savePreferences();
  update();
});
$("#sound").addEventListener("click", () => {
  prefs.sound = !prefs.sound;
  audio.setEnabled(prefs.sound);
  savePreferences();
  update();
});
$("#rules").addEventListener("click", guide);
$("#history").addEventListener("click", showHistory);
$("#menu").addEventListener("click", menu);
$("#receipt-button").addEventListener("click", () => {
  if (lastResult) showReceipt(lastResult);
});
$("#guide-dialog").addEventListener("close", () => {
  prefs.guide = true;
  savePreferences();
});
document.addEventListener("keydown", (event) => {
  if (
    event.code === "Space" &&
    !event.repeat &&
    (event.target === document.body ||
      event.target === document.documentElement) &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    void spin();
  }
});
document.addEventListener("visibilitychange", () => {
  view?.setHidden(document.hidden);
  audio.setHidden(document.hidden);
});
window.addEventListener("pagehide", () => {
  audio.setHidden(true);
  view?.setHidden(true);
});
window.addEventListener("pageshow", () => {
  audio.setHidden(document.hidden);
  view?.setHidden(document.hidden);
});
update();
async function boot() {
  try {
    const { ReelView } = await import("./presentation/view.ts");
    view = new ReelView(
      $("#reels"),
      (kind) => audio.cue(kind),
      (lost) => {
        graphicsReady = !lost;
        update();
        setNotice(lost ? "graphicsLost" : null);
      },
    );
    await view.init();
    if (lastResult)
      view.setGrid(lastResult.grid, lastResult.multiplier, lastResult.mode);
    else if (prefs.mode === "extra")
      view.setGrid(
        [
          [6, 1, 4],
          [3, 6, 7],
          [0, 2, 5],
        ],
        2,
        "extra",
      );
    phase = "ready";
    update();
    if (!provider.storageAvailable) setNotice("storageFailed");
    else if (provider.restoreRejected) setNotice("restoreRejected");
    else if (provider.restored) setNotice("restored");
    if (!prefs.guide) guide();
  } catch {
    phase = "failed";
    $("#reels").innerHTML =
      `<div class="loader"><p data-i18n="loadFailed"></p><button id="retry" class="primary" data-i18n="retry"></button></div>`;
    $("#retry").addEventListener("click", () => location.reload());
    update();
  }
}
void boot();
