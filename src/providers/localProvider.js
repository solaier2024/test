// LocalProvider —— 阶段一的本地模拟实现
//
// 它守住的是服务端契约，不是便利性：方法签名、返回结构、幂等与竞态语义
// 都与将来的 RemoteProvider 一致。所以接服务端时表现层零改动。
//
// 刻意保留的异步签名：即使本地是同步计算，也返回 Promise，
// 这样表现层从第一版起就按「等待权威结果」的方式写，不会隐含同步假设。

import { ShootoutEngine } from "../math/engine.js";
import { OutcomeProvider } from "./outcomeProvider.js";
import { makeLocalSeed } from "../math/prf.js";

export class LocalProvider extends OutcomeProvider {
  constructor({ seed, storage = null } = {}) {
    super();
    this.seedOverride = seed;
    this.pendingSeed = seed ?? makeLocalSeed();
    this.engine = null;
    this.storage = storage;
    try {
      const saved = JSON.parse(
        storage?.getItem("last-kick-session-v1") ?? "null",
      );
      if (saved) {
        if (
          saved.version !== 1 ||
          typeof saved.seed !== "string" ||
          saved.seed.length > 200 ||
          !Array.isArray(saved.actions) ||
          saved.actions.length > 17 ||
          saved.actions.some((a) => typeof a !== "string" || a.length > 30)
        )
          throw new Error("Invalid session");
        const engine = new ShootoutEngine({
          stake: saved.stake,
          seed: saved.seed,
          config: saved.config,
          lineup: saved.lineup,
        });
        if (
          Number.isFinite(saved.startedAt) &&
          saved.startedAt <= Date.now() &&
          saved.startedAt > Date.now() - 86_400_000
        )
          engine.startedAt = saved.startedAt;
        for (const action of saved.actions) {
          const q = engine.getQuote();
          if (!q) throw new Error("Session exceeds its terminal state");
          if (action.startsWith("swap-")) {
            const [, a, b] = action.split("-");
            engine.adjust(Number(a), Number(b), q.quoteId);
          } else engine.submit(action, q.quoteId);
        }
        if (saved.cashed) engine.cashOut(engine.getQuote()?.quoteId);
        this.engine = engine;
        this.preparationMs =
          Number.isFinite(saved.preparationMs) && saved.preparationMs >= 0
            ? saved.preparationMs
            : null;
      }
    } catch {
      this.restoreError = "上场存档无法校验，已保留成长并准备新比赛";
    }
  }
  saveSession() {
    try {
      this.storage?.setItem(
        "last-kick-session-v1",
        JSON.stringify({
          version: 1,
          seed: this.engine.seed,
          stake: this.engine.stake,
          config: this.engine.config,
          lineup: this.engine.initialLineup,
          actions: this.engine.log.map((e) => e.actionId),
          cashed: this.engine.getSettlement()?.reason === "cashed",
          startedAt: this.engine.startedAt,
          preparationMs: this.preparationMs,
        }),
      );
    } catch {
      /* The in-memory authority remains valid when persistence is denied. */
    }
  }
  resume() {
    if (!this.engine) return null;
    return {
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
      settlement: this.engine.getSettlement(),
      preparationMs: this.preparationMs,
      events: this.engine.log
        .filter((e) => e.resolution)
        .map((e) => e.resolution),
    };
  }
  release() {
    if (this.engine && !this.engine.getSettlement())
      throw new Error("尚未结算的比赛不能重置");
    this.engine = null;
    try {
      this.storage?.removeItem("last-kick-session-v1");
    } catch {
      /* Replaying a settled record is idempotent. */
    }
  }

  async start({
    stake,
    lineup,
    mode = "full",
    cupStage = null,
    enableChip = false,
    preparationMs = null,
  }) {
    if (this.engine && !this.engine.getSettlement())
      throw new Error("当前比赛尚未结算");
    this.engine = new ShootoutEngine({
      stake,
      seed: this.pendingSeed,
      lineup,
      config: { mode, cupStage, enableChip },
    });
    this.preparationMs =
      Number.isFinite(preparationMs) && preparationMs >= 0
        ? preparationMs
        : null;
    this.pendingSeed = this.seedOverride ?? makeLocalSeed();
    this.saveSession();
    return {
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
    };
  }

  async submit(actionId, quoteId) {
    const resolution = this.engine.submit(actionId, quoteId);
    this.saveSession();
    return {
      resolution,
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
      settlement: this.engine.getSettlement(),
    };
  }

  async cashOut(quoteId) {
    const settlement = this.engine.cashOut(quoteId);
    this.saveSession();
    return { settlement, state: this.engine.getState() };
  }

  async adjust(first, second, quoteId) {
    const event = this.engine.adjust(first, second, quoteId);
    this.saveSession();
    return {
      event,
      state: this.engine.getState(),
      quote: this.engine.getQuote(),
      info: this.engine.getPublicInfo(),
    };
  }

  getState() {
    return this.engine ? this.engine.getState() : null;
  }
  preview({ cupStage = null } = {}) {
    return new ShootoutEngine({
      stake: 10,
      seed: this.pendingSeed,
      config: { cupStage },
    }).getPublicInfo();
  }
}
