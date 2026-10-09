// 数据契约（SV-2）
//
// 这些结构就是将来服务端要下发的东西。阶段一由 LocalProvider 在本地产出，
// 但形状必须与服务端一致，否则后期接入要返工。
//
// 客户端只负责「呈现 RoundResolution」，不自行计算权威结果。

export const CONFIG_VERSION = 'psc-0.1.0-s0s1';

/** @typedef {object} ShootoutConfig */
export function makeConfig(overrides = {}) {
  return {
    configVersion: CONFIG_VERSION,
    targetRtp: 0.96,
    regularRounds: 5,
    suddenDeathSets: 3,
    // 返还是否包含本金：本实现的「返还」即为派发给玩家的金额，已含本金部分
    returnIncludesStake: true,
    // 金额舍入：对外展示与结算都用 2 位小数
    amountDecimals: 2,
    drawReturnFactor: 1.0, // 骤死上限后仍平：按当前现金价值全额返还
    ...overrides,
  };
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
    adjustmentsUsed: 0, // 教练调整属 S2，首版恒为 0
    settled: Boolean(engine.settlement),
  };
}
