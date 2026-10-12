import {
  basket,
  basketFit,
  canPrepare,
  canServe,
  mastery,
  missing,
  offers,
  RECIPES,
  STALLS,
  unlocked,
  type MarketJourney,
  type PlayerAction,
  type Ticket,
} from "../core/market.ts";
import { symbolNames, type Locale } from "../i18n.ts";
import {
  marketText,
  recipeNames,
  stallNames,
  type MarketKey,
} from "../market-i18n.ts";

type Tab = "orders" | "kitchen" | "book" | "stalls";
type Hooks = {
  locale: () => Locale;
  changed: () => void;
  feedback: (kind: "collect" | "prepare" | "serve") => void;
  sessionChanged: () => void;
};
export class MarketView {
  private tab: Tab = "orders";
  private disabled = true;
  private key = "";
  private renderedJourney: MarketJourney | null = null;
  private notice: {
    key: MarketKey;
    fields?: Record<string, string | number>;
    stall?: "taco" | "corn" | "comal";
  } | null = null;
  constructor(
    private root: HTMLElement,
    private dialog: HTMLDialogElement,
    private journey: () => MarketJourney,
    private hooks: Hooks,
  ) {
    this.dialog.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || button.disabled) return;
      const d = button.dataset;
      if (d["close"] !== undefined) this.dialog.close();
      else if (d["tab"]) {
        this.tab = d["tab"] as Tab;
        this.renderDialog();
        this.dialog.scrollTop = 0;
      } else if (d["order"]) this.act({ type: "order", id: d["order"] });
      else if (d["prepare"] !== undefined)
        this.act({ type: "prepare", recipe: Number(d["prepare"]) });
      else if (d["serve"]) this.act({ type: "serve", id: d["serve"] });
      else if (d["cancel"]) this.act({ type: "cancel", id: d["cancel"] });
      else if (d["stall"])
        this.act({
          type: "stall",
          id: d["stall"] as "taco" | "corn" | "comal",
        });
      else if (d["basket"] !== undefined) this.pick(Number(d["basket"]));
      else if (d["exchange"] !== undefined) {
        const give =
          this.dialog.querySelector<HTMLSelectElement>("#market-give")!;
        const take =
          this.dialog.querySelector<HTMLSelectElement>("#market-take")!;
        this.act({
          type: "trade",
          give: Number(give.value),
          take: Number(take.value),
        });
      }
    });
    this.root.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || button.disabled) return;
      if (button.dataset["basket"] !== undefined)
        this.pick(Number(button.dataset["basket"]));
      else this.open();
    });
    this.dialog.addEventListener("change", () => this.updateExchange());
  }
  private text(key: MarketKey, fields?: Record<string, string | number>) {
    return marketText(this.hooks.locale(), key, fields);
  }
  private food(symbol: number, extra = "") {
    return `<span class="food-thumb food-${symbol} ${extra}" role="img" aria-label="${symbolNames[this.hooks.locale()][symbol]}"></span>`;
  }
  private recipeName(id: number) {
    return recipeNames[this.hooks.locale()][id]!;
  }
  private stallName(id: "taco" | "corn" | "comal") {
    return stallNames[this.hooks.locale()][id];
  }
  private rank() {
    const stars = this.journey().state.stars;
    return this.text(
      stars >= 32
        ? "rank3"
        : stars >= 14
          ? "rank2"
          : stars >= 6
            ? "rank1"
            : "rank0",
    );
  }
  private pick(column: number) {
    const result = this.journey().pendingResult;
    if (result)
      this.act({ type: "pick", version: result.ledgerVersion, column });
  }
  private act(action: PlayerAction) {
    if (this.disabled) return;
    const before = this.journey().state;
    try {
      this.journey().dispatch(action);
      const after = this.journey().state;
      const opened = STALLS.find(
        (s) => before.stars < s.stars && after.stars >= s.stars,
      );
      this.notice = opened
        ? { key: "opened", stall: opened.id }
        : action.type === "pick"
          ? { key: "picked" }
          : action.type === "prepare"
            ? {
                key:
                  before.cooked[action.recipe] === 0
                    ? "newRecipe"
                    : mastery(after.cooked[action.recipe]!) >
                        mastery(before.cooked[action.recipe]!)
                      ? "badge"
                      : "cooked",
              }
            : action.type === "serve"
              ? { key: "served", fields: { n: after.stars - before.stars } }
              : action.type === "trade"
                ? { key: "traded" }
                : action.type === "order"
                  ? { key: "orderChosen" }
                  : action.type === "cancel"
                    ? { key: "orderCancelled" }
                    : null;
      if (action.type === "order") this.tab = "kitchen";
      if (action.type === "serve" || action.type === "stall")
        this.tab = "orders";
      if (["pick", "prepare", "serve"].includes(action.type))
        this.hooks.feedback(
          action.type === "pick"
            ? "collect"
            : action.type === "prepare"
              ? "prepare"
              : "serve",
        );
      this.hooks.changed();
      this.update(this.disabled);
      if (this.dialog.open) {
        this.renderDialog();
        if (["order", "serve", "stall"].includes(action.type))
          this.dialog.scrollTop = 0;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "MARKET_SESSION_CHANGED"
      ) {
        this.hooks.sessionChanged();
        this.dialog.close();
      } else {
        this.notice = { key: "actionFailed" };
        this.renderDialog();
      }
    }
  }
  update(disabled: boolean) {
    this.disabled = disabled;
    const journey = this.journey(),
      state = journey.state;
    const key = `${journey.revision}:${this.hooks.locale()}:${disabled}:${journey.storageAvailable}`;
    if (key === this.key && journey === this.renderedJourney) return;
    this.key = key;
    this.renderedJourney = journey;
    const next = STALLS.find((s) => s.stars > state.stars);
    const progress = next
      ? this.text("nextUnlock", {
          name: this.stallName(next.id),
          n: next.stars,
        })
      : state.stars < 32
        ? this.text("legendGoal")
        : this.text("allOpen");
    // The accepted result stays hidden until reels and multiplier have finished.
    const pending = disabled ? null : journey.pendingResult;
    this.root.style.setProperty(
      "--stall-accent",
      STALLS.find((s) => s.id === state.stall)!.color,
    );
    this.root.innerHTML = `<div class="market-dock-head"><span class="market-rank">★ ${state.stars} <small>${this.rank()}</small></span>
      <button class="market-open" ${disabled ? "disabled" : ""}>${this.text("market")} <span>↗</span></button></div>
      ${
        pending
          ? `<div class="market-pick-inline"><span>${this.text("pickTitle")}</span>${this.baskets(true)}</div>`
          : `<div class="market-dock-body"><span>${state.ticket ? this.orderName(state.ticket) : this.text(state.served ? "chooseOrder" : "firstOrder")}<small>${progress}</small></span>
        <span class="market-recipe-count">${state.cooked.filter((n) => n > 0).length}/9 <small>${this.text("discovered")}</small></span></div>`
      }`;
    this.root.setAttribute("aria-label", this.text("market"));
    if (this.dialog.open) this.renderDialog();
  }
  private orderName(ticket: Ticket) {
    return this.text((["quick", "tasting", "fiesta"] as const)[ticket.kind]!);
  }
  private baskets(inline = false): string {
    const journey = this.journey(),
      result = journey.pendingResult;
    if (!result) return "";
    const fit = [0, 1, 2].map((c) => basketFit(journey.state, result, c));
    const best = Math.max(...fit);
    return `<div class="basket-options ${inline ? "inline" : ""}">${[0, 1, 2]
      .map((column) => {
        const content = basket(result, column);
        return `<button class="basket-card" data-basket="${column}" aria-label="${this.text("basket", { n: column + 1 })}" ${this.disabled ? "disabled" : ""}>
        <span class="basket-foods">${content.symbols.map((s) => this.food(s)).join("")}</span>
        <strong>${this.text("basket", { n: column + 1 })}</strong>${!inline && journey.state.ticket && fit[column] === best && best > 0 ? `<small>${this.text("best")}</small>` : ""}</button>`;
      })
      .join("")}</div>`;
  }
  open(tab: Tab = "orders") {
    if (this.disabled) return;
    this.tab = tab;
    this.renderDialog();
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.scrollTop = 0;
  }
  private plateList(ticket: Ticket): string {
    const state = this.journey().state;
    return `<ul class="market-plate-list">${ticket.plates
      .map((count, i) =>
        count
          ? `<li>${this.food(RECIPES[i]!.symbol)}<span>${this.recipeName(i)}<small>${this.text("needed")}: ${Math.min(count, state.plates[i]!)}/${count}</small></span><strong>×${count}</strong></li>`
          : "",
      )
      .join("")}</ul>`;
  }
  private orders(): string {
    const state = this.journey().state;
    if (state.ticket)
      return `<article class="active-ticket"><div class="market-card-title"><span>${this.text("activeOrder")}</span><strong>+${state.ticket.stars} ★</strong></div>
      <h3>${this.orderName(state.ticket)}</h3>${this.plateList(state.ticket)}
      <div class="market-ticket-actions"><button class="primary" data-serve="${state.ticket.id}" ${canServe(state) ? "" : "disabled"}>${this.text("serve")}</button>
      <button data-tab="kitchen">${this.text("kitchen")} →</button></div><button class="text-button" data-cancel="${state.ticket.id}">${this.text("cancelOrder")}</button><p class="market-help">${this.text("cancelHint")}</p></article>`;
    return `<p class="market-help">${this.text("chooseHint")}</p><div class="order-grid">${offers(
      state,
    )
      .map(
        (ticket) =>
          `<article class="order-card"><div class="market-card-title"><span>${this.stallName(ticket.stall)}</span><strong>+${ticket.stars} ★</strong></div>
        <h3>${this.orderName(ticket)}</h3>${this.plateList(ticket)}<button class="primary" data-order="${ticket.id}">${this.text("chooseOrder")}</button></article>`,
      )
      .join("")}</div>`;
  }
  private kitchen(): string {
    const state = this.journey().state;
    return `${state.ticket ? `<div class="kitchen-ticket"><span>${this.orderName(state.ticket)} · +${state.ticket.stars} ★</span>${canServe(state) ? `<button class="primary" data-serve="${state.ticket.id}">${this.text("serve")}</button>` : `<button data-tab="orders">${this.text("orders")} →</button>`}</div>` : ""}
      <div class="recipe-grid">${RECIPES.map((recipe, i) =>
        recipe.stall === state.stall
          ? `<article class="recipe-card ${state.ticket?.plates[i] ? "for-order" : ""}">${state.ticket?.plates[i] ? `<span class="recipe-target">${this.text("forOrder")} · ${Math.min(state.plates[i]!, state.ticket.plates[i]!)}/${state.ticket.plates[i]}</span>` : ""}${this.food(recipe.symbol, "recipe-photo")}<h3>${this.recipeName(i)}</h3>
          <span class="recipe-owned">${this.text("prepared")}: ${state.plates[i]}</span>
          <div class="ingredient-list">${recipe.needs.map((count, j) => (count ? `<span class="${state.pantry[j]! >= count ? "has-stock" : "missing-stock"}" title="${symbolNames[this.hooks.locale()][j]}">${this.food(j)}<strong>${Math.min(count, state.pantry[j]!)}/${count}</strong></span>` : "")).join("")}</div>
          <button class="primary" data-prepare="${i}" ${canPrepare(state, i) ? "" : "disabled"}>${!canPrepare(state, i) ? this.text("needStock") : missing(state, i) ? this.text("useChef", { n: missing(state, i) }) : this.text("prepare")}</button></article>`
          : "",
      ).join("")}</div>
      <section class="market-trade"><h3>${this.text("trade")}</h3><p class="market-help">${this.text("tradeHint")}</p>
        <div class="trade-controls"><label>${this.text("give")}<select id="market-give">${symbolNames[
          this.hooks.locale()
        ]
          .slice(0, 7)
          .map(
            (name, i) =>
              `<option value="${i}" ${state.pantry[i]! < 2 ? "disabled" : ""}>${name} (${state.pantry[i]})</option>`,
          )
          .join("")}</select></label>
        <span aria-hidden="true">→</span><label>${this.text("take")}<select id="market-take">${symbolNames[
          this.hooks.locale()
        ]
          .slice(0, 7)
          .map((name, i) => `<option value="${i}">${name}</option>`)
          .join(
            "",
          )}</select></label><button class="primary" data-exchange>${this.text("exchange")}</button></div></section>`;
  }
  private book(): string {
    const state = this.journey().state;
    return `<p class="market-help">${this.text("recipeHint")}</p><div class="recipe-book-grid">${RECIPES.map(
      (r, i) => {
        const count = state.cooked[i]!,
          level = mastery(count),
          available = unlocked(state, r.stall);
        return `<article class="book-card ${count ? "discovered" : "undiscovered"}">${this.food(r.symbol, "recipe-photo")}<h3>${this.recipeName(i)}</h3><small>${this.stallName(r.stall)}</small>
        <span class="mastery-badge">${"★".repeat(level)}${"☆".repeat(3 - level)} ${this.text((["fresh", "novice", "regular", "signature"] as const)[level]!)}</span>
        <progress value="${Math.min(count, 6)}" max="6" aria-label="${this.recipeName(i)}"></progress><small>${available ? this.text("mastery", { n: Math.min(count, 6) }) : this.text("locked", { n: STALLS.find((s) => s.id === r.stall)!.stars })}</small></article>`;
      },
    ).join("")}</div>`;
  }
  private stalls(): string {
    const state = this.journey().state;
    return `<p class="market-help">${this.text("stallHint")}</p><div class="stall-grid">${STALLS.map(
      (stall) => {
        const open = unlocked(state, stall.id),
          current = state.stall === stall.id;
        return `<article class="stall-card ${open ? "open" : "locked"}" style="--stall-accent:${stall.color}"><div class="stall-awning"></div>${this.food(stall.symbol, "recipe-photo")}
        <h3>${this.stallName(stall.id)}</h3><p>${open ? `${stall.stars} ★` : this.text("locked", { n: stall.stars })}</p>
        <button class="primary" data-stall="${stall.id}" ${!open || current || !!state.ticket ? "disabled" : ""}>${current ? this.text("current") : this.text("visit")}</button></article>`;
      },
    ).join(
      "",
    )}</div>${state.ticket ? `<p class="market-help">${this.text("finishFirst")}</p>` : ""}`;
  }
  private renderDialog() {
    const journey = this.journey(),
      state = journey.state;
    const defaultNotice =
      state.served ||
      state.last > state.start ||
      state.cooked.some((n) => n > 0)
        ? "chooseHint"
        : "starter";
    const focused = this.dialog.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset
      : null;
    const scroll = this.dialog.scrollTop;
    this.dialog.setAttribute("aria-label", this.text("market"));
    this.dialog.innerHTML = `<div class="dialog-header"><div><p class="eyebrow">${this.stallName(state.stall)} · ${this.rank()}</p><h2>${this.text("market")}</h2></div><button class="dialog-close" data-close aria-label="${this.hooks.locale() === "es-MX" ? "Cerrar" : "Close"}">×</button></div>
      <div class="market-summary"><strong>★ ${state.stars}<small>${this.text("stars")}</small></strong><span>${state.served}<small>${this.text("orders")}</small></span><span>${state.cooked.filter((n) => n > 0).length}/9<small>${this.text("discovered")}</small></span></div>
      <div class="market-notice" role="status" aria-live="polite">${this.notice ? this.text(this.notice.key, this.notice.stall ? { name: this.stallName(this.notice.stall) } : this.notice.fields) : journey.recovered ? this.text("recovered") : this.text(defaultNotice)}</div>
      ${journey.pendingResult && !this.disabled ? `<section class="market-harvest"><h3>${this.text("pickTitle")} · ${journey.pendingResult.spinId}</h3><p class="market-help">${this.text("pickHint")}</p>${this.baskets()}</section>` : ""}
      <div class="pantry-strip" aria-label="${this.text("provisions")}">${state.pantry.map((n, i) => `<span>${this.food(i)}<b>${n}</b></span>`).join("")}<span class="chef-token">${this.food(7)}<b>${state.chef}</b><small>${this.text("chef")}</small></span></div>
      <nav class="dialog-tabs market-tabs" aria-label="${this.text("market")}">${(["orders", "kitchen", "book", "stalls"] as const).map((tab) => `<button data-tab="${tab}" aria-pressed="${this.tab === tab}">${this.text(tab)}</button>`).join("")}</nav>
      <div class="market-tab-content">${this.tab === "orders" ? this.orders() : this.tab === "kitchen" ? this.kitchen() : this.tab === "book" ? this.book() : this.stalls()}</div>
      <p class="market-help market-separation">${this.text("pantryHint")} ${this.text("classicHint")}</p><p class="market-help">${this.text("progressOnly")}</p>${!journey.storageAvailable ? `<p class="market-warning">${this.text("storageFailed")}</p>` : ""}`;
    this.updateExchange();
    this.dialog.scrollTop = scroll;
    if (focused) {
      const pair = Object.entries(focused).find(([key]) =>
        [
          "tab",
          "order",
          "prepare",
          "serve",
          "cancel",
          "stall",
          "basket",
          "close",
          "exchange",
        ].includes(key),
      );
      const button = pair
        ? Array.from(
            this.dialog.querySelectorAll<HTMLButtonElement>("button"),
          ).find((b) => b.dataset[pair[0]] === pair[1] && !b.disabled)
        : null;
      (
        button ??
        this.dialog.querySelector<HTMLButtonElement>(`[data-tab="${this.tab}"]`)
      )?.focus({ preventScroll: true });
    }
  }
  private updateExchange() {
    const give = this.dialog.querySelector<HTMLSelectElement>("#market-give"),
      take = this.dialog.querySelector<HTMLSelectElement>("#market-take"),
      button = this.dialog.querySelector<HTMLButtonElement>("[data-exchange]");
    if (give && take && button)
      button.disabled =
        this.disabled ||
        give.value === take.value ||
        this.journey().state.pantry[Number(give.value)]! < 2 ||
        this.journey().state.pantry[Number(take.value)]! >= 99;
  }
}
