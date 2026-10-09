// 动作、条件概率与现金分支（S0-3 / S0-4 / S0-5）
//
// ============================================================
// 这是整个项目的承重墙，改动前请先读懂。
// ============================================================
//
// 现金价值 C 必须是鞅：对每个可达决策状态 s 与每个合法继续动作 a，
//
//     C(s) = Σ P(s' | s, a) × C(s')
//
// 本实现不靠「调参后再用蒙特卡洛检验」，而是让每一步在构造上就是一次公平投注：
//
//     成功 -> C × (1 + u)        失败 -> C × (1 - d)
//     要求 p·u = (1 - p)·d       =>    u = d · (1 - p) / p
//
// 代入即得   p(1+u) + (1-p)(1-d) = 1   恒等成立。
//
// 于是：
//  - 任何策略的期望返还都等于初始现金 C(s₀) = W × r，所以 Vmax = Vmin = W × r
//  - 现金可以下降（d > 0 恒成立），不存在「继续严格优于收钱」的无损区间
//  - 玩家选择改变的是 p 与波动形态，不是期望值
//
// 关键不变量：报价里的 p 必须与结算时使用的 p 完全一致。
// 因此 engine 先生成 quote，再用同一个 quote 对象去判定结果。

import { DIRS, keeperDiveDistribution } from './keeper.js';
import { PHASE, END, previewOutcomes } from './rules.js';

// 概率被夹在该区间内。下限保证全押分支的赔付上界有限：
// d = 1 时 u = (1-p)/p，p ≥ 0.20 则 u ≤ 4。
export const P_MIN = 0.20;
export const P_MAX = 0.93;

export const SHOT_TYPES = {
  placed: { id: 'placed', name: '推射', accOther: 0.94, beatSame: 0.22, risk: 0.30 },
  driven: { id: 'driven', name: '抽射', accOther: 0.78, beatSame: 0.46, risk: 0.55 },
};

export const DEFENSE = { saveMatch: 0.78, saveMiss: 0.07, risk: 0.32 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 公平投注的现金分支。
 * @param {number} cash 当前现金价值
 * @param {number} p 本动作的成功概率（已夹紧）
 * @param {number} risk 失败时损失的现金比例；若失败分支即为落败终局则强制为 1
 * @param {boolean} failureIsLoss 失败分支是否直接导致常规落败
 */
export function cashBranches(cash, p, risk, failureIsLoss) {
  const d = failureIsLoss ? 1 : risk;
  const u = (d * (1 - p)) / p;
  return {
    p,
    lossFraction: d,
    gainFraction: u,
    onSuccess: cash * (1 + u),
    onFailure: cash * (1 - d),
  };
}

/** 进攻：6 种组合（3 方向 × 2 射法） */
export function attackOptions(match, cash, keeperDist) {
  const pv = previewOutcomes(match);
  const failureIsLoss = pv.failure.ended === END.LOSS;
  const successEnds = pv.success.ended;
  const options = [];
  for (const dir of DIRS) {
    const guess = keeperDist[dir];
    for (const t of Object.values(SHOT_TYPES)) {
      const raw = (1 - guess) * t.accOther + guess * t.beatSame;
      const p = clamp(raw, P_MIN, P_MAX);
      options.push({
        kind: PHASE.ATTACK,
        dir,
        shot: t.id,
        id: `${dir}-${t.id}`,
        keeperGuessProb: guess,
        ...cashBranches(cash, p, t.risk, failureIsLoss),
        failureIsLoss,
        successEnds,
      });
    }
  }
  return options;
}

/** 防守：3 个扑救方向 */
export function defenseOptions(match, cash, shooterTendency) {
  const pv = previewOutcomes(match);
  const failureIsLoss = pv.failure.ended === END.LOSS;
  const successEnds = pv.success.ended;
  return DIRS.map((dive) => {
    const raw = DIRS.reduce(
      (acc, d) => acc + shooterTendency[d] * (d === dive ? DEFENSE.saveMatch : DEFENSE.saveMiss),
      0
    );
    const p = clamp(raw, P_MIN, P_MAX);
    return {
      kind: PHASE.DEFEND,
      dir: dive,
      id: `dive-${dive}`,
      shooterProb: shooterTendency[dive],
      ...cashBranches(cash, p, DEFENSE.risk, failureIsLoss),
      failureIsLoss,
      successEnds,
    };
  });
}

/** 当前阶段的全部合法动作 */
export function legalOptions(match, cash, ctx) {
  if (match.phase === PHASE.ATTACK) {
    const dist = keeperDiveDistribution(ctx.preMatchTendency, ctx.memory, ctx.archetype);
    return { options: attackOptions(match, cash, dist), keeperDist: dist };
  }
  return { options: defenseOptions(match, cash, ctx.shooterTendency), keeperDist: null };
}

/**
 * 自检：任一动作的期望现金必须等于当前现金。
 * 这是 S0-8「无损继续区间」门禁的逐动作版本，engine 每次生成报价时都会调用。
 */
export function assertMartingale(cash, options, tolerance = 1e-9) {
  for (const o of options) {
    const ev = o.p * o.onSuccess + (1 - o.p) * o.onFailure;
    if (Math.abs(ev - cash) > tolerance * Math.max(1, Math.abs(cash))) {
      throw new Error(
        `鞅条件被破坏：动作 ${o.id} 的期望现金 ${ev} != 当前现金 ${cash}（差 ${ev - cash}）`
      );
    }
  }
  return true;
}
