// 比赛引擎：轮次状态机 + 报价 + 权威结算
//
// 职责边界：
//  - 本模块产出 DecisionQuote 与 RoundResolution，是唯一的权威来源
//  - 表现层只呈现结果，不计算任何权威数值
//  - 同一动作重复提交只产生一次有效结果（幂等）
//  - 收钱与继续竞争时只接受一个合法状态转换

import { prf, makeLocalSeed, commitment } from "./prf.js";
import {
  PHASE,
  END,
  initialMatch,
  applyAttack,
  applyDefend,
  keyBall,
  remainingShots,
} from "./rules.js";
import {
  ARCHETYPES,
  initialMemory,
  rememberShot,
  makePreMatchTendency,
  makeShooterTendency,
  keeperDiveDistribution,
  keeperHint,
} from "./keeper.js";
import { legalOptions, assertMartingale } from "./actions.js";
import {
  makeConfig,
  roundAmount,
  snapshotState,
  freezeData,
} from "./contract.js";
import {
  validateLineup,
  currentPlayer,
  pressureAt,
  advanceStrain,
  canAdjust,
  adjustLineup,
  CUP_STAGES,
  QUICK_POLICY,
} from "./depth.js";
import { actionOutcome } from "./action-outcome.js";

const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

export class ShootoutEngine {
  /**
   * @param {object} opts
   * @param {number} opts.stake 下注额
   * @param {string} [opts.seed] 阶段一本地生成；服务端接入后由服务端生成
   * @param {object} [opts.config]
   */
  constructor({ stake, seed, config, lineup } = {}) {
    if (!Number.isFinite(stake) || stake <= 0 || stake > 1_000_000)
      throw new Error("模拟投入无效");
    this.config = makeConfig(config);
    this.initialLineup = freezeData(validateLineup(lineup));
    this.lineup = [...this.initialLineup];
    this.adjustmentsUsed = 0;
    this.strain = 0;
    this.accepted = new Map();
    this.startedAt = Date.now();
    this.stake = stake;
    this.seed = seed ?? makeLocalSeed();
    this.commitment = commitment(this.seed);
    this.sessionId = `m-${commitment(`${this.seed}|${this.config.configVersion}:${this.config.mode}:${this.config.cupStage}:${this.config.enableChip}:${this.initialLineup.join(",")}`)}`;
    this.match = initialMatch();

    // 初始现金价值 = W × r。鞅条件保证任何策略的期望返还都等于这个数。
    this.cash = stake * this.config.targetRtp;

    // 对手由 seed 决定，所以同一个 seed 永远得到同一个对手
    let n = 0;
    const r = () => prf(this.seed, `setup:${n++}`);
    this.archetype = ARCHETYPE_IDS[Math.floor(r() * ARCHETYPE_IDS.length)];
    this.preMatchTendency = makePreMatchTendency(r);
    this.shooterTendency = makeShooterTendency(r);
    const stage = CUP_STAGES.find((s) => s.id === this.config.cupStage);
    if (stage) {
      this.archetype = stage.archetype;
      this.preMatchTendency = { ...stage.keeper };
      this.shooterTendency = { ...stage.shooter };
    }

    this.memory = initialMemory();
    this.stateVersion = 0;
    this.quote = null;
    this.log = [];
    this.settlement = null;
    this.events = [];

    this.#issueQuote();
  }

  /** 决策路径：玩家的选择决定读取随机性的哪一条分支 */
  #decisionPath() {
    const prior = this.log.map((e) => e.actionId).join(">");
    const m = this.match;
    const tag = m.suddenDeath ? `sd${m.sdSet}` : `r${m.round}`;
    return `${this.config.configVersion}:${this.config.mode}:${this.config.cupStage ?? "single"}:${this.config.enableChip ? "chip" : "two-shot"}:${this.initialLineup.join(",")}|${tag}:${m.phase}:${prior}`;
  }

  /** 生成当前阶段的报价。每次生成都做一次鞅自检。 */
  #issueQuote() {
    if (this.match.ended) {
      this.quote = null;
      return;
    }
    const ctx = {
      preMatchTendency: this.preMatchTendency,
      shooterTendency: this.shooterTendency,
      memory: this.memory,
      archetype: this.archetype,
      player: currentPlayer(this.match, this.lineup),
      pressure: pressureAt(this.match, this.strain),
      enableChip: this.config.enableChip,
    };
    const { options, keeperDist } = legalOptions(this.match, this.cash, ctx);
    assertMartingale(this.cash, options);
    this.stateVersion += 1;
    this.quote = freezeData({
      quoteId: `q${this.stateVersion}-${this.#decisionPath()}`,
      stateVersion: this.stateVersion,
      configVersion: this.config.configVersion,
      phase: this.match.phase,
      cashValue: this.cash,
      options,
      keeperDist,
      keeperHint:
        this.match.phase === PHASE.ATTACK
          ? keeperHint(keeperDist, this.memory)
          : null,
      keyBall: keyBall(this.match),
      canCashOut: this.#canCashOut(),
      canAdjust: canAdjust(this.match, this.adjustmentsUsed),
      player: { ...ctx.player },
      pressure: ctx.pressure,
      mode: this.config.mode,
      autoDefensePolicy: this.config.mode === "quick" ? QUICK_POLICY.id : null,
    });
  }

  /** 收钱窗口：非终局的完整攻防轮结束后。首版的轮末即进攻阶段开始前。 */
  #canCashOut() {
    const m = this.match;
    if (m.ended) return false;
    if (m.phase !== PHASE.ATTACK) return false;
    // 第一轮还没打，不允许立刻兑现
    return m.playerTaken > 0 && m.playerTaken === m.oppTaken;
  }

  /** 对外状态快照 */
  getState() {
    return snapshotState(this);
  }

  getQuote() {
    return this.quote;
  }

  getPublicInfo() {
    const a = ARCHETYPES[this.archetype];
    return freezeData({
      archetype: a.id,
      archetypeName: a.name,
      archetypeDesc: a.desc,
      preMatchTendency: { ...this.preMatchTendency },
      shooterTendency: { ...this.shooterTendency },
      memory: {
        L: this.memory.L,
        C: this.memory.C,
        R: this.memory.R,
        samples: this.memory.samples,
        history: [...this.memory.history],
      },
      remaining: remainingShots(this.match),
      commitment: this.commitment,
      lineup: [...this.lineup],
      pressure: pressureAt(this.match, this.strain),
      adjustmentsUsed: this.adjustmentsUsed,
      opponentHistory: this.events
        .filter((e) => e.kind === PHASE.DEFEND)
        .map((e) => ({
          ballDir: e.ballDir,
          diveDir: e.diveDir,
          saved: e.success,
          round: e.round,
          suddenDeath: e.suddenDeath,
        })),
      opponent:
        CUP_STAGES.find((s) => s.id === this.config.cupStage)?.rival ?? a.name,
      autoDefensePolicy:
        this.config.mode === "quick"
          ? { ...QUICK_POLICY, tieOrder: [...QUICK_POLICY.tieOrder] }
          : null,
    });
  }

  /**
   * 提交一个动作。必须带上报价 ID —— 这保证结算使用的 p 与玩家看到的 p 完全一致。
   * 幂等：同一个报价 ID 只能成功提交一次。
   */
  submit(actionId, quoteId) {
    const accepted = this.accepted.get(quoteId);
    if (accepted) {
      if (accepted.actionId !== actionId || accepted.kind !== "shot")
        throw new Error("本报价已经用于其他动作");
      return accepted.result;
    }
    if (this.settlement) throw new Error("已结算，不接受新动作");
    if (!this.quote) throw new Error("当前无可提交的报价");
    if (quoteId !== this.quote.quoteId) {
      // 幂等保护：重复提交旧报价不产生第二次效果
      throw new Error("报价已过期，请使用当前报价");
    }
    const option = this.quote.options.find((o) => o.id === actionId);
    if (!option) throw new Error(`非法动作：${actionId}`);

    const path = `${this.#decisionPath()}|${actionId}`;
    const draw = prf(this.seed, path);
    const success = draw < option.p;

    const before = {
      cash: this.cash,
      playerGoals: this.match.playerGoals,
      oppGoals: this.match.oppGoals,
      round: this.match.suddenDeath ? this.match.sdSet : this.match.round,
      suddenDeath: this.match.suddenDeath,
      pressure: this.quote.pressure,
      player: this.quote.player,
      keeperDist: this.quote.keeperDist,
      keyBall: this.quote.keyBall,
    };

    // 现金按报价里的分支推进 —— 不重新计算概率
    this.cash = success ? option.onSuccess : option.onFailure;

    let newHint = null;
    if (this.match.phase === PHASE.ATTACK) {
      // 门将记住这次射门方向（进球、被扑、打偏均留下记录）
      this.memory = rememberShot(this.memory, this.archetype, option.dir);
      this.match = applyAttack(this.match, success);
      const dist = keeperDiveDistribution(
        this.preMatchTendency,
        this.memory,
        this.archetype,
      );
      newHint = keeperHint(dist, this.memory);
    } else {
      this.match = applyDefend(this.match, success);
    }

    if (this.match.ended === END.LOSS) this.cash = 0;
    this.strain = advanceStrain(this.strain, success);

    const resolution = {
      stateVersion: this.stateVersion,
      quoteId,
      phase: option.kind,
      actionId,
      dir: option.dir,
      shot: option.shot ?? null,
      ...actionOutcome({
        phase: option.kind,
        dir: option.dir,
        shot: option.shot,
        success,
      }),
      round: before.round,
      suddenDeath: before.suddenDeath,
      player: option.kind === PHASE.ATTACK ? before.player : null,
      pressureBefore: before.pressure,
      pressureAfter: pressureAt(this.match, this.strain),
      modifiers: option.modifiers,
      keeperDistBefore: before.keeperDist,
      keyBallBefore: before.keyBall,
      probability: option.p,
      success,
      cashBefore: roundAmount(before.cash, this.config),
      cashAfter: roundAmount(this.cash, this.config),
      score: { player: this.match.playerGoals, opp: this.match.oppGoals },
      scoreChanged:
        this.match.playerGoals !== before.playerGoals ||
        this.match.oppGoals !== before.oppGoals,
      newHint,
      keyBall: this.match.ended ? null : keyBall(this.match),
      nextPhase: this.match.ended ? null : this.match.phase,
      endType: this.match.ended,
    };
    freezeData(resolution);
    this.accepted.set(quoteId, { kind: "shot", actionId, result: resolution });

    this.log.push({ quoteId, actionId, resolution });
    this.events.push({
      ...resolution,
      sessionId: this.sessionId,
      seq: this.events.length + 1,
      configVersion: this.config.configVersion,
      kind: option.kind,
      dir: option.dir,
      shot: option.shot ?? null,
      success,
      probability: option.p,
      score: { ...resolution.score },
      cashAfter: resolution.cashAfter,
      keeperSamples: this.memory.samples,
    });

    if (this.match.ended) {
      this.#settle(this.match.ended);
    } else {
      this.#issueQuote();
    }
    return resolution;
  }

  adjust(first, second, quoteId) {
    const actionId = `swap-${Math.min(first, second)}-${Math.max(first, second)}`;
    const accepted = this.accepted.get(quoteId);
    if (accepted) {
      if (accepted.kind !== "coach" || accepted.actionId !== actionId)
        throw new Error("本报价已经用于其他动作");
      return accepted.result;
    }
    if (this.settlement || !this.quote || this.quote.quoteId !== quoteId)
      throw new Error("报价已过期");
    const before = [...this.lineup];
    this.lineup = adjustLineup(
      this.match,
      this.lineup,
      this.adjustmentsUsed,
      first,
      second,
    );
    this.adjustmentsUsed += 1;
    const event = freezeData({
      kind: "coach",
      seq: this.events.length + 1,
      sessionId: this.sessionId,
      quoteId,
      actionId,
      configVersion: this.config.configVersion,
      round: this.match.round,
      slots: [first, second],
      before,
      after: [...this.lineup],
      cashAfter: roundAmount(this.cash, this.config),
    });
    this.events.push(event);
    this.log.push({ quoteId, actionId, event });
    this.accepted.set(quoteId, { kind: "coach", actionId, result: event });
    this.#issueQuote();
    return event;
  }

  /** 主动收钱。与继续竞争时只接受一个合法状态转换。 */
  cashOut(quoteId) {
    if (this.settlement) return this.settlement;
    if (!this.quote || quoteId !== this.quote.quoteId)
      throw new Error("报价已过期");
    if (!this.quote.canCashOut) throw new Error("当前不在收钱窗口");
    this.match = { ...this.match, ended: END.CASHED };
    return this.#settle(END.CASHED);
  }

  #settle(reason) {
    if (this.settlement) return this.settlement;
    let payout;
    switch (reason) {
      case END.LOSS:
        payout = 0;
        break;
      case END.DRAW:
        payout = this.cash * this.config.drawReturnFactor;
        break;
      case END.WIN:
      case END.CASHED:
      default:
        payout = this.cash;
        break;
    }
    this.quote = null;
    this.settlement = freezeData({
      settlementId: `s-${this.sessionId}-${this.log.length}`,
      reason,
      stake: this.stake,
      payout: roundAmount(payout, this.config),
      amountUnit: "MXN",
      settled: true,
      seedRevealed: this.seed,
      commitment: this.commitment,
      configVersion: this.config.configVersion,
      config: this.config,
      sessionId: this.sessionId,
      initialLineup: [...this.initialLineup],
      finalLineup: [...this.lineup],
      match: { ...this.match },
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      actionLog: this.log.map((e) => e.actionId),
      events: [...this.events],
    });
    return this.settlement;
  }

  getSettlement() {
    return this.settlement;
  }
}
