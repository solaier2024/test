import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./style.css";
import {
  BASE_STAKES,
  LINES,
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
import { assetUrl } from "./presentation/assets.ts";
import { MarketMedia } from "./presentation/media.ts";
import { winTier, type Quality } from "./presentation/motion.ts";
import { RoundController } from "./shell/round-controller.ts";
import type { ReelView } from "./presentation/view.ts";

type Preferences = {
  locale: Locale;
  baseIndex: number;
  mode: Mode;
  turbo: boolean;
  sound: boolean;
  guide: boolean;
  guideV2: boolean;
  entranceSeen: boolean;
  music: boolean;
  ambient: boolean;
  volume: number;
  quality: Quality | "auto";
  haptics: boolean;
};
const defaults: Preferences = {
  locale: "es-MX",
  baseIndex: 5,
  mode: "standard",
  turbo: false,
  sound: true,
  guide: false,
  guideV2: false,
  entranceSeen: false,
  music: true,
  ambient: true,
  volume: 0.65,
  quality: "auto",
  haptics: true,
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
  if (
    saved.quality === "lite" ||
    saved.quality === "full" ||
    saved.quality === "auto"
  )
    prefs.quality = saved.quality;
  if (typeof saved.volume === "number" && Number.isFinite(saved.volume))
    prefs.volume = Math.max(0, Math.min(1, saved.volume));
  for (const key of [
    "turbo",
    "sound",
    "guide",
    "guideV2",
    "entranceSeen",
    "music",
    "ambient",
    "haptics",
  ] as const)
    if (typeof saved[key] === "boolean") prefs[key] = saved[key];
} catch {
  /* A private browser can still play with default preferences. */
}
const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const freshSeed = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16).padStart(8, "0"),
  ).join("");
const provider = new LocalProvider(freshSeed(), storage);
const text = (key: MessageKey) => t(prefs.locale, key);
const money = (amount: bigint, signed = false) =>
  formatMoney(amount, prefs.locale, signed);
const msg = (key: MessageKey) => `<span data-i18n="${key}">${text(key)}</span>`;
let quote: Quote = provider.quote(BASE_STAKES[prefs.baseIndex]!, prefs.mode);
let view: ReelView | null = null;
let entered = false,
  bootReady = false,
  graphicsReady = true,
  opening = false;
let notice: MessageKey | null = null;
let selectedReceipt: Result | null = null;
let selectedLine = 0;
let tutorialStep = 0,
  tutorialLine = 1,
  tutorialMultiplier = 3,
  tutorialExtra = false;
let receiptTab: "rules" | "pays" = "rules";
let lastPhase = "",
  lastStage = "",
  lastLanguage = "";
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const icon = (
  name: "sound" | "history" | "menu" | "spin" | "full" | "chevron",
) => {
  const paths = {
    sound:
      '<path d="m11 4-5 4H3v8h3l5 4V4Zm4 4c2 2 2 6 0 8m3-11c4 4 4 10 0 14"/>',
    history: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    spin: '<path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6"/>',
    full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};
$("#app").innerHTML = `
  <div class="market-scene" id="market-scene" aria-hidden="true"><video id="market-video" playsinline muted></video><div class="scene-shade"></div><div class="scene-embers"><i></i><i></i><i></i><i></i></div></div>
  <header class="topbar"><span class="demo-badge" data-i18n="demo"></span><div class="tools">
    <button id="sound" class="icon-button">${icon("sound")}</button><button id="history" class="icon-button">${icon("history")}</button>
    <label class="locale-label"><span class="sr-only" data-i18n="language"></span><select id="locale"><option value="es-MX">ES</option><option value="en-US">EN</option></select></label>
    <button id="fullscreen" class="icon-button desktop-tool">${icon("full")}</button><button id="menu" class="icon-button">${icon("menu")}</button>
  </div></header>
  <main class="game" id="game">
    <div class="wordmark"><h1 class="sr-only">Mercado de Oro</h1><img class="brand-sign" src="${assetUrl("brand-sign-v2.webp")}" alt="Mercado de Oro"/><p data-i18n="tagline"></p></div>
    <section class="machine" aria-label="Mercado de Oro"><div class="awning" aria-hidden="true"></div><div class="bulb-strip" aria-hidden="true">${"<i></i>".repeat(12)}</div>
      <div class="machine-top"><span class="paylines" data-i18n="activeLines"></span><span class="maximum"><span data-i18n="upTo"></span> <strong id="max-return">375×</strong></span><span class="salsa-title" data-i18n="salsa"></span></div>
      <div class="reel-shell"><div id="reels"></div><div class="cabinet-glint" aria-hidden="true"></div></div>
      <div class="machine-bottom"><button id="rules">${msg("rules")}<b>i</b></button><div id="winning-lines"></div><span class="axis-caption" data-i18n="independent"></span></div>
    </section>
    <section class="result-ribbon"><div class="balance-field"><span data-i18n="balance"></span><strong id="balance"></strong></div>
      <div class="payout-field" aria-live="off"><span id="result-title"></span><strong id="payout">$0.00</strong><p id="result-message"></p></div>
      <button id="receipt-button" class="receipt-button">${icon("history")}<span class="sr-only" data-i18n="receipt"></span></button>
    </section>
    <section class="controls"><div class="bet-control"><span data-i18n="base"></span><div class="bet-stepper"><button id="bet-minus">−</button><button id="bet-amount"></button><button id="bet-plus">+</button></div></div>
      <label class="extra-switch"><input type="checkbox" id="extra" role="switch"/><span class="bottle-thumb" aria-hidden="true"></span><span class="extra-copy"><strong data-i18n="extra"></strong><small id="extra-hint"></small></span><span class="switch-light" aria-hidden="true"></span></label>
      <div class="cost"><span data-i18n="cost"></span><strong id="cost"></strong><small data-i18n="currencyNote"></small></div>
      <label class="turbo-control"><input type="checkbox" id="turbo"/><span>ϟ</span><small data-i18n="turbo"></small></label>
      <div class="spin-cradle"><button id="spin" class="spin-button">${icon("spin")}<span></span></button></div>
    </section>
    <footer class="game-footer"><span id="footer-mode"></span><span data-i18n="demo"></span></footer>
    <p id="note" class="note" role="status"></p><div id="accessible-grid" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="celebration" id="celebration" aria-live="polite" hidden><span id="celebration-title"></span><strong id="celebration-amount"></strong><div class="celebration-flourish" aria-hidden="true">✦</div></div>
  </main>
  <div class="toast" id="toast" role="status" hidden></div>
  <div class="cinematic-controls" id="cinematic-controls" hidden><button id="skip-cinematic"></button></div>
  <dialog id="entrance-dialog" class="entrance-dialog"><div class="entrance-content"><img src="${assetUrl("brand-sign-v2.webp")}" alt="Mercado de Oro"/><p data-i18n="entranceHint"></p>
    <div class="loader" id="loader"><div class="sauce-load" aria-hidden="true"><i></i></div><span id="loading-label"></span><strong id="loading-percent">0%</strong></div>
    <button id="enter" class="primary" disabled></button><small data-i18n="soundHint"></small><span class="entrance-demo" data-i18n="demo"></span></div></dialog>
  <dialog id="guide-dialog" class="guide-dialog"></dialog><dialog id="rules-dialog"></dialog><dialog id="bet-dialog" class="compact-dialog"></dialog>
  <dialog id="history-dialog"></dialog><dialog id="receipt-dialog"></dialog><dialog id="menu-dialog" class="compact-dialog"></dialog>
  <dialog id="reset-dialog" class="compact-dialog"></dialog><dialog id="settings-dialog" class="compact-dialog"></dialog>`;

const audio = new MarketAudio();
audio.enabled = prefs.sound;
audio.music = prefs.music;
audio.volume = prefs.volume;
const media = new MarketMedia(
  $<HTMLVideoElement>("#market-video"),
  $("#market-scene"),
);
media.setSound(prefs.sound);
media.setVolume(prefs.volume);
if (!prefs.ambient) media.setEnabled(false);
const flow = new RoundController(
  provider,
  async (result, emit, replay) => {
    if (!view) throw new Error("Display not ready");
    await view.present(result, prefs.turbo, emit, replay);
  },
  () => render(),
);
const busy = () => flow.phase !== "ready" || opening;
const savePreferences = () => {
  try {
    storage.setItem("mercado.preferences.v1", JSON.stringify(prefs));
  } catch {}
};
const put = (id: string, value: string) => {
  const element = $(id);
  if (element.textContent !== value) element.textContent = value;
};
function setNotice(key: MessageKey | null) {
  notice = key;
  put("#note", key ? text(key) : "");
}
function toast(key: MessageKey) {
  $("#toast").textContent = text(key);
  $("#toast").hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3500);
}
function haptic() {
  if (
    prefs.haptics &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    typeof navigator.vibrate === "function"
  )
    navigator.vibrate(8);
}
function newQuote() {
  quote = provider.quote(BASE_STAKES[prefs.baseIndex]!, prefs.mode);
}
function chosenQuality(): Quality {
  if (prefs.quality !== "auto") return prefs.quality;
  const device = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return device.connection?.saveData ||
    ["slow-2g", "2g"].includes(device.connection?.effectiveType ?? "") ||
    (device.deviceMemory !== undefined && device.deviceMemory <= 4)
    ? "lite"
    : "full";
}
function renderStatic() {
  document.documentElement.lang = prefs.locale;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    node.textContent = text(node.dataset["i18n"] as MessageKey);
  });
  $<HTMLSelectElement>("#locale").value = prefs.locale;
  $("#locale").setAttribute("aria-label", text("language"));
  put("#cost", money(quote.totalCostUnits));
  put("#bet-amount", money(quote.baseStakeUnits));
  put("#max-return", prefs.mode === "extra" ? "250×" : "375×");
  $("#bet-minus").setAttribute("aria-label", text("decreaseBet"));
  $("#bet-plus").setAttribute("aria-label", text("increaseBet"));
  $("#bet-amount").setAttribute(
    "aria-label",
    `${text("chooseBet")}: ${money(quote.baseStakeUnits)}`,
  );
  $("#sound").setAttribute(
    "aria-label",
    text(prefs.sound ? "soundOn" : "soundOff"),
  );
  $("#sound").setAttribute("aria-pressed", String(prefs.sound));
  $("#sound").classList.toggle("muted", !prefs.sound);
  $("#history").setAttribute("aria-label", text("history"));
  $("#menu").setAttribute("aria-label", text("menu"));
  $("#fullscreen").setAttribute(
    "aria-label",
    text(document.fullscreenElement ? "exitFullscreen" : "fullscreen"),
  );
  $("#receipt-button").setAttribute("aria-label", text("receipt"));
  $<HTMLInputElement>("#extra").checked = prefs.mode === "extra";
  $<HTMLInputElement>("#turbo").checked = prefs.turbo;
  put("#extra-hint", text(prefs.mode === "extra" ? "extraHint" : "extraOff"));
  put(
    "#footer-mode",
    `${text(prefs.mode === "extra" ? "extra" : "standard")} · ${text("fiveLines")}`,
  );
  $(".machine").classList.toggle("extra-active", prefs.mode === "extra");
  put("#enter", text(provider.history.length ? "resume" : "play"));
  put("#skip-cinematic", text("skip"));
  put("#note", notice ? text(notice) : "");
  if (lastLanguage !== prefs.locale) {
    view?.setLocale(prefs.locale);
    lastLanguage = prefs.locale;
  }
}
function render() {
  const phaseKey = `${flow.phase}:${bootReady}:${opening}:${graphicsReady}`;
  if (lastPhase !== phaseKey) {
    lastPhase = phaseKey;
    if (flow.phase !== "ready") put("#accessible-grid", "");
    const disabled = busy() || !bootReady || !graphicsReady;
    for (const id of [
      "bet-minus",
      "bet-plus",
      "bet-amount",
      "history",
      "menu",
      "rules",
    ])
      $<HTMLButtonElement>(`#${id}`).disabled = disabled;
    $<HTMLButtonElement>("#bet-minus").disabled ||= prefs.baseIndex === 0;
    $<HTMLButtonElement>("#bet-plus").disabled ||=
      prefs.baseIndex === BASE_STAKES.length - 1;
    $<HTMLInputElement>("#extra").disabled = disabled;
    $<HTMLInputElement>("#turbo").disabled = disabled;
    $<HTMLButtonElement>("#spin").disabled =
      !bootReady || !graphicsReady || opening || flow.phase === "confirming";
    $<HTMLButtonElement>("#receipt-button").disabled =
      disabled || !flow.lastResult;
    $("#game").dataset["phase"] = flow.phase;
    $("#spin").classList.toggle("is-revealing", flow.phase === "presenting");
    $("#spin span").textContent = text(
      flow.phase === "confirming"
        ? "confirming"
        : flow.phase === "presenting"
          ? "revealing"
          : "spin",
    );
    if (flow.phase === "ready" && entered)
      void view?.setQuality(chosenQuality());
  }
  put("#balance", money(flow.displayBalance));
  const result = flow.phase === "presenting" ? flow.accepted : flow.lastResult;
  const stageKey = `${flow.phase}:${flow.stage}:${result?.spinId}:${flow.replaying}:${prefs.locale}`;
  if (stageKey !== lastStage) {
    lastStage = stageKey;
    if (flow.phase === "presenting") {
      put(
        "#result-title",
        text(
          flow.replaying
            ? "replaying"
            : flow.stage === "base"
              ? "linePay"
              : flow.stage === "multiplier"
                ? "addingSalsa"
                : "payout",
        ),
      );
      put(
        "#result-message",
        flow.replaying
          ? text("replayHint")
          : flow.stage === "reels"
            ? text("spinning")
            : result
              ? `${result.lineWins.length} ${text(result.lineWins.length === 1 ? "lineWon" : "linesWon")} · ×${flow.stage === "base" ? 1 : result.multiplier}`
              : "",
      );
    } else if (result) {
      const tier = winTier(result.payoutUnits, result.totalCostUnits);
      put(
        "#result-title",
        text(
          flow.replaying
            ? "replaying"
            : tier === "none"
              ? "noWin"
              : tier === "return"
                ? "returned"
                : tier === "big"
                  ? "bigWin"
                  : tier === "grand"
                    ? "grandWin"
                    : "win",
        ),
      );
      put(
        "#result-message",
        result.payoutUnits === 0n
          ? text("noWinHint")
          : `${text("net")} ${money(result.payoutUnits - result.totalCostUnits, true)} · ×${result.multiplier}`,
      );
      $("#accessible-grid").textContent =
        `${text("board")}: ${result.grid.map((row) => row.map((s) => symbolNames[prefs.locale][s]).join(", ")).join("; ")}. ${text("multiplier")}: ${result.multiplier}. ${text("payout")}: ${money(result.payoutUnits)}.`;
    } else {
      put("#result-title", text("payout"));
      put("#result-message", text("ready"));
    }
    $("#winning-lines").innerHTML =
      flow.phase === "ready" && result
        ? result.lineWins
            .map(
              (w) =>
                `<button data-line="${w.line}" style="--line-color:${["#f6b32e", "#39ab87", "#549cce", "#df7452", "#a074c2"][w.line - 1]}" aria-label="${text("line")} ${w.line}">${w.line}</button>`,
            )
            .join("")
        : "";
    document
      .querySelectorAll<HTMLButtonElement>("#winning-lines button")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const line = Number(button.dataset["line"]);
          selectedLine = selectedLine === line ? 0 : line;
          view?.inspectLine(line);
          document
            .querySelectorAll<HTMLButtonElement>("#winning-lines button")
            .forEach((chip) =>
              chip.setAttribute(
                "aria-pressed",
                String(Number(chip.dataset["line"]) === selectedLine),
              ),
            );
          haptic();
        }),
      );
  }
  put("#payout", money(flow.displayedPayout));
  const tier = result
    ? winTier(result.payoutUnits, result.totalCostUnits)
    : "none";
  $(".result-ribbon").dataset["tier"] = flow.replaying ? "replay" : tier;
  const celebrating =
    flow.phase === "presenting" &&
    flow.stage === "award" &&
    !flow.replaying &&
    ["big", "grand"].includes(tier);
  $("#celebration").hidden = !celebrating;
  if (celebrating) {
    put("#celebration-title", text(tier === "grand" ? "grandWin" : "bigWin"));
    put("#celebration-amount", money(flow.displayedPayout));
  }
}
function refreshUi() {
  lastPhase = "";
  lastStage = "";
  renderStatic();
  render();
}
function header(title: string, eyebrow = "") {
  return `<div class="dialog-header"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h2>${title}</h2></div><button class="dialog-close" aria-label="${text("close")}">×</button></div>`;
}
function modal(id: string, html: string) {
  const dialog = $<HTMLDialogElement>(id);
  dialog.innerHTML = html;
  dialog.setAttribute(
    "aria-label",
    dialog.querySelector("h2")?.textContent ?? "Mercado de Oro",
  );
  dialog
    .querySelector(".dialog-close")
    ?.addEventListener("click", () => dialog.close());
  dialog.showModal();
}
function lineSvg(line: number, all = false) {
  const paths = LINES.map(
    (rows, i) =>
      `<polyline points="${rows.map((r, c) => `${28 + c * 72},${28 + r * 58}`).join(" ")}" class="${all || i + 1 === line ? "active-line" : ""}"/>`,
  ).join("");
  return `<svg class="line-map" viewBox="0 0 200 172" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<rect x="${7 + (i % 3) * 72}" y="${7 + Math.floor(i / 3) * 58}" width="43" height="43" rx="8"/>`).join("")}${paths}</svg>`;
}
function tutorial() {
  tutorialStep = 0;
  tutorialLine = 1;
  tutorialMultiplier = 3;
  tutorialExtra = false;
  renderTutorial(true);
}
function renderTutorial(first = false) {
  const id = "#guide-dialog";
  const previousFocus = document.activeElement as HTMLElement | null;
  const focusId = previousFocus?.id;
  const focusLine = previousFocus?.dataset["guideLine"];
  const titles: MessageKey[] = [
    "tutorialTitle1",
    "tutorialTitle2",
    "tutorialTitle3",
  ];
  const bodies: MessageKey[] = [
    "tutorialBody1",
    "tutorialBody2",
    "tutorialBody3",
  ];
  const base = 10_000_000n,
    baseWin = 11_200_000n,
    payout = baseWin * BigInt(tutorialMultiplier),
    cost = tutorialExtra ? 15_000_000n : base;
  const visual =
    tutorialStep === 0
      ? `<div class="tutorial-lines">${lineSvg(tutorialLine)}<p>${text("tapLine")}</p><div class="line-buttons">${[1, 2, 3, 4, 5].map((i) => `<button data-guide-line="${i}" aria-pressed="${i === tutorialLine}">${i}</button>`).join("")}</div><div class="wild-lesson"><span class="food-thumb food-7"></span><span>${symbolNames[prefs.locale][7]}<br><strong>${text("allWild")}</strong></span></div></div>`
      : tutorialStep === 1
        ? `<div class="tutorial-salsa"><img src="${assetUrl("salsa-bottle-v2.webp")}" alt=""/><b>×${tutorialMultiplier}</b><span class="lesson-formula">${money(baseWin)} × ${tutorialMultiplier} = <strong>${money(payout)}</strong></span><button id="example-salsa">${text("exampleSalsa")} ↻</button><small>${text("exampleLines")}</small></div>`
        : `<div class="tutorial-price"><span>${text("base")}<strong>${money(base)}</strong></span><span>${text("cost")}<strong>${money(cost)}</strong></span><label><input type="checkbox" id="example-extra" ${tutorialExtra ? "checked" : ""}/>${text("exampleExtra")}</label><p>${text("payout")} ${money(payout)} · ${text("net")} ${money(payout - cost, true)}</p></div>`;
  const html = `${header(text(titles[tutorialStep]!))}<div class="tutorial-dots" aria-label="${tutorialStep + 1}/3">${[0, 1, 2].map((i) => `<i class="${i === tutorialStep ? "active" : ""}"></i>`).join("")}</div><span class="lesson-example">${text("example")}</span>${visual}<p class="tutorial-body">${text(bodies[tutorialStep]!)}</p><div class="tutorial-actions"><button id="guide-back" ${tutorialStep === 0 ? "disabled" : ""}>${text("back")}</button><button id="guide-next" class="primary">${text(tutorialStep === 2 ? "tutorialPlay" : "tutorialNext")}</button></div><button id="guide-skip" class="text-button">${text("tutorialSkip")}</button>`;
  if (first) modal(id, html);
  else {
    $(id).innerHTML = html;
    $(id + " .dialog-close").addEventListener("click", () =>
      $<HTMLDialogElement>(id).close(),
    );
  }
  $(id).setAttribute("aria-label", text(titles[tutorialStep]!));
  $("#guide-next").addEventListener("click", () => {
    if (tutorialStep === 2) $<HTMLDialogElement>(id).close();
    else {
      tutorialStep++;
      renderTutorial();
    }
  });
  $("#guide-back").addEventListener("click", () => {
    tutorialStep--;
    renderTutorial();
  });
  $("#guide-skip").addEventListener("click", () =>
    $<HTMLDialogElement>(id).close(),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-guide-line]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        tutorialLine = Number(button.dataset["guideLine"]);
        renderTutorial();
      }),
    );
  $("#example-salsa")?.addEventListener("click", () => {
    tutorialMultiplier =
      tutorialMultiplier === 3 ? 15 : tutorialMultiplier === 15 ? 1 : 3;
    renderTutorial();
  });
  $("#example-extra")?.addEventListener("change", () => {
    tutorialExtra = $<HTMLInputElement>("#example-extra").checked;
    renderTutorial();
  });
  if (!first) {
    const target = focusLine
      ? $(id).querySelector<HTMLButtonElement>(
          `[data-guide-line="${focusLine}"]`,
        )
      : focusId
        ? $(id).querySelector<HTMLElement>(`#${focusId}`)
        : null;
    (target ?? $("#guide-next")).focus();
  }
}
function rules() {
  const table = `<p class="rules-footnote">${text("paytableHint")}</p><div class="paytable-grid">${symbolNames[prefs.locale].map((name, i) => `<div><span class="food-thumb food-${i}"></span><span>${name}</span><strong>×${PAY_TENTHS[i]! / 10}</strong></div>`).join("")}</div><p class="rules-footnote">${text("maximum")}</p>`;
  const explanation = `${lineSvg(0, true)}<div class="rules-copy"><h3>${text("step1Title")}</h3><p>${text("step1")}</p><h3>${text("step2Title")}</h3><p>${text("step2")}</p><h3>${text("step3Title")}</h3><p>${text("step3")}</p></div><p class="rules-footnote">${text("noBonus")}</p>`;
  modal(
    "#rules-dialog",
    `${header(text("rules"))}<div class="dialog-tabs"><button id="rules-tab" aria-pressed="${receiptTab === "rules"}">${text("rulesTab")}</button><button id="pays-tab" aria-pressed="${receiptTab === "pays"}">${text("awardsTab")}</button></div>${receiptTab === "rules" ? explanation : table}`,
  );
  $("#rules-tab").addEventListener("click", () => {
    $<HTMLDialogElement>("#rules-dialog").close();
    receiptTab = "rules";
    rules();
  });
  $("#pays-tab").addEventListener("click", () => {
    $<HTMLDialogElement>("#rules-dialog").close();
    receiptTab = "pays";
    rules();
  });
}
function changeBet(index: number) {
  if (busy()) return;
  prefs.baseIndex = Math.max(0, Math.min(BASE_STAKES.length - 1, index));
  newQuote();
  savePreferences();
  refreshUi();
  haptic();
}
function chooseBet() {
  modal(
    "#bet-dialog",
    `${header(text("chooseBet"))}<div class="bet-options">${BASE_STAKES.map((b, i) => `<button data-bet="${i}" aria-pressed="${i === prefs.baseIndex}">${money(b)}</button>`).join("")}</div><p class="rules-footnote">${text("cost")} <strong>${money(quote.totalCostUnits)}</strong> · ${text(prefs.mode === "extra" ? "extra" : "standard")}</p>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-bet]").forEach((button) =>
    button.addEventListener("click", () => {
      changeBet(Number(button.dataset["bet"]));
      $<HTMLDialogElement>("#bet-dialog").close();
    }),
  );
}
function history() {
  modal(
    "#history-dialog",
    `${header(text("history"))}<div class="history-list">${
      provider.history.length
        ? provider.history
            .slice(-30)
            .reverse()
            .map(
              (r) =>
                `<button class="history-card" data-version="${r.ledgerVersion}"><span><strong>${r.spinId}</strong><small>${text(r.mode === "extra" ? "extra" : "standard")} · ${money(r.totalCostUnits)}</small></span><span><strong>${money(r.payoutUnits)}</strong><small class="${r.payoutUnits > r.totalCostUnits ? "positive" : ""}">${money(r.payoutUnits - r.totalCostUnits, true)} · ×${r.multiplier}</small></span>${icon("chevron")}</button>`,
            )
            .join("")
        : `<p>${text("empty")}</p>`
    }</div>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>(".history-card")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const r = provider.history.find(
          (r) => r.ledgerVersion === Number(button.dataset["version"]),
        );
        if (r) {
          $<HTMLDialogElement>("#history-dialog").close();
          receipt(r);
        }
      }),
    );
}
function receipt(result: Result) {
  selectedReceipt = result;
  modal(
    "#receipt-dialog",
    `${header(text("receipt"), result.spinId)}<div class="receipt-grid">${result.grid
      .flat()
      .map(
        (s) =>
          `<span class="food-thumb food-${s}" role="img" aria-label="${symbolNames[prefs.locale][s]}"></span>`,
      )
      .join(
        "",
      )}<strong class="receipt-multiplier">×${result.multiplier}</strong></div><dl class="receipt-money"><div><dt>${text("base")}</dt><dd>${money(result.baseStakeUnits)}</dd></div><div><dt>${text("cost")} · ${text(result.mode === "extra" ? "extra" : "standard")}</dt><dd>${money(result.totalCostUnits)}</dd></div><div><dt>${text("baseWin")}</dt><dd>${money(result.baseWinUnits)}</dd></div><div><dt>${text("payout")}</dt><dd>${money(result.payoutUnits)}</dd></div><div><dt>${text("net")}</dt><dd>${money(result.payoutUnits - result.totalCostUnits, true)}</dd></div></dl><ul class="line-receipts">${result.lineWins.map((w) => `<li><span>${text("line")} ${w.line} · ${symbolNames[prefs.locale][w.symbol]}</span><strong>${money(w.payoutUnits)}</strong></li>`).join("") || `<li>${text("noWin")}</li>`}</ul><button id="replay" class="primary">${text("replay")}</button><p class="rules-footnote">${text("replayHint")}</p>`,
  );
  $("#replay").addEventListener("click", () => {
    $<HTMLDialogElement>("#receipt-dialog").close();
    if (selectedReceipt) void flow.replay(selectedReceipt);
  });
}
function menu() {
  modal(
    "#menu-dialog",
    `${header(text("menu"))}<div class="menu-actions"><button id="menu-settings">${text("settings")} ${icon("chevron")}</button><button id="menu-tour">${text("tutorialMenu")} ${icon("chevron")}</button><button id="menu-rules">${text("rules")} ${icon("chevron")}</button><button id="menu-history">${text("history")} ${icon("chevron")}</button><button id="menu-intro">${text("replayIntro")} ${icon("chevron")}</button><button id="menu-reset">${text("reset")} ${icon("chevron")}</button></div>`,
  );
  const close = () => $<HTMLDialogElement>("#menu-dialog").close();
  $("#menu-settings").addEventListener("click", () => {
    close();
    settings();
  });
  $("#menu-rules").addEventListener("click", () => {
    close();
    rules();
  });
  $("#menu-history").addEventListener("click", () => {
    close();
    history();
  });
  $("#menu-tour").addEventListener("click", () => {
    close();
    tutorial();
  });
  $("#menu-intro").addEventListener("click", () => {
    close();
    void playOpening();
  });
  $("#menu-reset").addEventListener("click", () => {
    close();
    modal(
      "#reset-dialog",
      `${header(text("resetTitle"))}<p>${text("resetHint")}</p><div class="dialog-actions"><button id="cancel-reset">${text("cancel")}</button><button id="confirm-reset" class="primary">${text("resetConfirm")}</button></div>`,
    );
    $("#cancel-reset").addEventListener("click", () =>
      $<HTMLDialogElement>("#reset-dialog").close(),
    );
    $("#confirm-reset").addEventListener("click", () => {
      provider.reset(freshSeed());
      selectedReceipt = null;
      selectedLine = 0;
      newQuote();
      view?.showIdle(prefs.mode);
      flow.reset();
      setNotice(provider.storageAvailable ? null : "storageFailed");
      refreshUi();
      $<HTMLDialogElement>("#reset-dialog").close();
    });
  });
}
function settings() {
  modal(
    "#settings-dialog",
    `${header(text("settings"))}<div class="settings-fields"><label>${msg("music")}<input id="setting-music" type="checkbox" ${prefs.music ? "checked" : ""}/></label><label>${msg("ambient")}<input id="setting-ambient" type="checkbox" ${prefs.ambient ? "checked" : ""}/></label><label>${msg("haptics")}<input id="setting-haptics" type="checkbox" ${prefs.haptics ? "checked" : ""}/></label><label>${msg("volume")}<input id="setting-volume" type="range" min="0" max="100" value="${Math.round(prefs.volume * 100)}"/></label><label>${msg("effects")}<select id="setting-quality">${(["auto", "lite", "full"] as const).map((q) => `<option value="${q}" ${prefs.quality === q ? "selected" : ""}>${text(q)}</option>`).join("")}</select></label><label>${msg("language")}<select id="setting-locale"><option value="es-MX" ${prefs.locale === "es-MX" ? "selected" : ""}>Español</option><option value="en-US" ${prefs.locale === "en-US" ? "selected" : ""}>English</option></select></label></div>`,
  );
  $("#setting-music").addEventListener("change", () => {
    prefs.music = $<HTMLInputElement>("#setting-music").checked;
    audio.setMusic(prefs.music);
    savePreferences();
  });
  $("#setting-ambient").addEventListener("change", () => {
    prefs.ambient = $<HTMLInputElement>("#setting-ambient").checked;
    media.setEnabled(prefs.ambient);
    savePreferences();
  });
  $("#setting-haptics").addEventListener("change", () => {
    prefs.haptics = $<HTMLInputElement>("#setting-haptics").checked;
    savePreferences();
  });
  $("#setting-volume").addEventListener("input", () => {
    prefs.volume = Number($<HTMLInputElement>("#setting-volume").value) / 100;
    audio.setVolume(prefs.volume);
    media.setVolume(prefs.volume);
    savePreferences();
  });
  $("#setting-quality").addEventListener("change", () => {
    prefs.quality = $<HTMLSelectElement>("#setting-quality")
      .value as Preferences["quality"];
    void view?.setQuality(chosenQuality());
    savePreferences();
  });
  $("#setting-locale").addEventListener("change", () => {
    prefs.locale = $<HTMLSelectElement>("#setting-locale").value as Locale;
    savePreferences();
    refreshUi();
    $<HTMLDialogElement>("#settings-dialog").close();
    settings();
  });
}
async function spin() {
  if (!entered || opening) return;
  if (flow.phase === "presenting") {
    view?.skip();
    return;
  }
  if (flow.phase !== "ready" || !graphicsReady || !bootReady) return;
  if (provider.history.length >= MAX_SESSION_SPINS) {
    toast("sessionFull");
    return;
  }
  if (provider.balance < quote.totalCostUnits) {
    toast("insufficient");
    return;
  }
  setNotice(null);
  selectedLine = 0;
  haptic();
  void audio.unlock();
  try {
    await flow.spin(quote, crypto.randomUUID());
    newQuote();
    refreshUi();
    if (flow.presentationRecovered) setNotice("presentationRecovered");
    if (!provider.storageAvailable) setNotice("storageFailed");
  } catch {
    setNotice("error");
    refreshUi();
  }
}
async function playOpening() {
  if (busy()) return;
  opening = true;
  audio.setCinematic(true);
  $("#cinematic-controls").hidden = false;
  $(".topbar").inert = true;
  $("#game").inert = true;
  refreshUi();
  $("#skip-cinematic").focus();
  await media.opening();
  opening = false;
  audio.setCinematic(false);
  $("#cinematic-controls").hidden = true;
  $(".topbar").inert = false;
  $("#game").inert = false;
  refreshUi();
  $("#spin").focus();
}
async function enter() {
  if (!bootReady || entered) return;
  entered = true;
  $<HTMLDialogElement>("#entrance-dialog").close();
  $("#app").classList.add("entered");
  void audio.unlock();
  if (!prefs.entranceSeen) {
    await playOpening();
    prefs.entranceSeen = true;
    savePreferences();
  }
  if (!prefs.guideV2) tutorial();
  else $("#spin").focus();
  void view?.setQuality(chosenQuality());
}
$("#enter").addEventListener("click", () => void enter());
$("#skip-cinematic").addEventListener("click", () => media.skip());
$("#spin").addEventListener("click", () => void spin());
$("#bet-minus").addEventListener("click", () => changeBet(prefs.baseIndex - 1));
$("#bet-plus").addEventListener("click", () => changeBet(prefs.baseIndex + 1));
$("#bet-amount").addEventListener("click", chooseBet);
$("#extra").addEventListener("change", () => {
  if (busy()) return;
  prefs.mode = $<HTMLInputElement>("#extra").checked ? "extra" : "standard";
  newQuote();
  savePreferences();
  if (!flow.lastResult) view?.showIdle(prefs.mode);
  refreshUi();
  haptic();
});
$("#turbo").addEventListener("change", () => {
  prefs.turbo = $<HTMLInputElement>("#turbo").checked;
  savePreferences();
  refreshUi();
});
$("#locale").addEventListener("change", () => {
  prefs.locale = $<HTMLSelectElement>("#locale").value as Locale;
  savePreferences();
  refreshUi();
});
$("#sound").addEventListener("click", () => {
  prefs.sound = !prefs.sound;
  audio.setEnabled(prefs.sound);
  media.setSound(prefs.sound);
  savePreferences();
  refreshUi();
});
$("#rules").addEventListener("click", rules);
$("#history").addEventListener("click", history);
$("#menu").addEventListener("click", menu);
$("#receipt-button").addEventListener("click", () => {
  if (flow.lastResult) receipt(flow.lastResult);
});
$("#guide-dialog").addEventListener("close", () => {
  prefs.guideV2 = true;
  prefs.guide = true;
  savePreferences();
  $("#spin").focus();
});
$("#entrance-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  if (bootReady) void enter();
});
$("#fullscreen").addEventListener("click", () => {
  const operation = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen?.();
  void operation?.catch(() => {});
});
document.addEventListener("fullscreenchange", () => refreshUi());
document.addEventListener("keydown", (event) => {
  if (
    event.code === "Space" &&
    !event.repeat &&
    (event.target === document.body ||
      event.target === document.documentElement) &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    if (opening) media.skip();
    else void spin();
  }
});
const visibility = () => {
  view?.setHidden(document.hidden);
  media.setHidden(document.hidden);
  audio.setHidden(document.hidden);
};
document.addEventListener("visibilitychange", visibility);
window.addEventListener("pagehide", () => {
  view?.setHidden(true);
  media.setHidden(true);
  audio.setHidden(true);
});
window.addEventListener("pageshow", visibility);
renderStatic();
render();
$<HTMLDialogElement>("#entrance-dialog").showModal();
function progress(value: number) {
  $("#loading-percent").textContent = `${Math.round(value * 100)}%`;
  $("#loader").style.setProperty("--load", String(value));
  put("#loading-label", text(value < 0.58 ? "loadingArt" : "loadingFood"));
}
async function boot() {
  const mediaReady = media.init();
  try {
    const { ReelView } = await import("./presentation/view.ts");
    view = new ReelView(
      $("#reels"),
      (kind) => audio.cue(kind),
      (lost) => {
        graphicsReady = !lost;
        setNotice(lost ? "graphicsLost" : null);
        refreshUi();
      },
      progress,
    );
    await Promise.all([
      view.init(),
      mediaReady,
      $<HTMLImageElement>(".brand-sign").decode(),
      document.fonts.ready,
    ]);
    view.setLocale(prefs.locale);
    if (flow.lastResult) view.restore(flow.lastResult);
    else view.showIdle(prefs.mode);
    bootReady = true;
    $("#loader").hidden = true;
    $<HTMLButtonElement>("#enter").disabled = false;
    refreshUi();
    if (!provider.storageAvailable) setNotice("storageFailed");
    else if (provider.restoreRejected) setNotice("restoreRejected");
    else if (provider.restored) setNotice("restored");
  } catch {
    put("#loading-label", text("loadFailed"));
    $("#loader").classList.add("failed");
    put("#enter", text("retry"));
    $<HTMLButtonElement>("#enter").disabled = false;
    $("#enter").addEventListener("click", () => location.reload(), {
      once: true,
    });
  }
}
void boot();
