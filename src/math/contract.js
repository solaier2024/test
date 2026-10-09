// 数据契约（SV-2）
//
// 这些结构就是将来服务端要下发的东西。阶段一由 LocalProvider 在本地产出，
// 但形状必须与服务端一致，否则后期接入要返工。
//
// 客户端只负责「呈现 RoundResolution」，不自行计算权威结果。

import {
  CUP_STAGES,
  currentPlayer,
  pressureAt,
  QUICK_POLICY,
} from "./depth.js";

export const CONFIG_VERSION = "psc-0.3.0-depth-v1";
export function freezeData(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

/** @typedef {object} ShootoutConfig */
export function makeConfig(overrides = {}) {
  const config = {
    configVersion: CONFIG_VERSION,
    targetRtp: 0.96,
    regularRounds: 5,
    suddenDeathSets: 3,
    // 返还是否包含本金：本实现的「返还」即为派发给玩家的金额，已含本金部分
    returnIncludesStake: true,
    // 金额舍入：对外展示与结算都用 2 位小数
    amountDecimals: 2,
    drawReturnFactor: 1.0, // 骤死上限后仍平：按当前现金价值全额返还
    mode: "full",
    autoDefensePolicy: QUICK_POLICY.id,
    cupStage: null,
    enableChip: false,
    ...overrides,
  };
  const supported = [
    "configVersion",
    "targetRtp",
    "regularRounds",
    "suddenDeathSets",
    "returnIncludesStake",
    "amountDecimals",
    "drawReturnFactor",
    "mode",
    "autoDefensePolicy",
    "cupStage",
    "enableChip",
  ];
  if (
    Object.keys(overrides).some((k) => !supported.includes(k)) ||
    config.configVersion !== CONFIG_VERSION ||
    !Number.isFinite(config.targetRtp) ||
    config.targetRtp <= 0 ||
    config.targetRtp > 1 ||
    config.regularRounds !== 5 ||
    config.suddenDeathSets !== 3 ||
    config.drawReturnFactor !== 1 ||
    config.returnIncludesStake !== true ||
    config.amountDecimals !== 2 ||
    !["full", "quick"].includes(config.mode) ||
    config.autoDefensePolicy !== QUICK_POLICY.id ||
    typeof config.enableChip !== "boolean" ||
    (config.cupStage !== null &&
      !CUP_STAGES.some((s) => s.id === config.cupStage))
  )
    throw new Error("比赛配置无效或超出已验证范围");
  return freezeData(config);
}

/** 四舍五入到配置精度 */
export function roundAmount(v, config) {
  const f = 10 ** config.amountDecimals;
  return Math.round(v * f) / f;
}

/**
 * MatchState 对外快照：比分、双方剩余次数、阶段、现金价值、
 * 公开线索、记忆、已用调整次数、终局状态。
 */
export function snapshotState(engine) {
  const m = engine.match;
  return {
    configVersion: engine.config.configVersion,
    stateVersion: engine.stateVersion,
    round: m.round,
    phase: m.phase,
    playerGoals: m.playerGoals,
    oppGoals: m.oppGoals,
    playerTaken: m.playerTaken,
    oppTaken: m.oppTaken,
    suddenDeath: m.suddenDeath,
    sdSet: m.sdSet,
    ended: m.ended,
    cashValue: roundAmount(engine.cash, engine.config),
    stake: engine.stake,
    sessionId: engine.sessionId,
    mode: engine.config.mode,
    cupStage: engine.config.cupStage,
    lineup: [...engine.lineup],
    initialLineup: [...engine.initialLineup],
    currentPlayer: { ...currentPlayer(m, engine.lineup) },
    pressure: pressureAt(m, engine.strain),
    adjustmentsUsed: engine.adjustmentsUsed,
    settled: Boolean(engine.settlement),
  };
}
