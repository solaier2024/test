// 赛制与终局判定
//
// 常规赛最多 5 轮，每轮玩家先攻后守。平局进入限定骤死赛（最多 3 组）。
// 全场最多 16 个罚球阶段：常规 10 个 + 骤死 6 个。该上限使完整状态求解可行。

export const REGULAR_ROUNDS = 5;
export const SUDDEN_DEATH_SETS = 3;

export const PHASE = { ATTACK: "attack", DEFEND: "defend" };
export const END = {
  WIN: "win", // 赢下大战
  LOSS: "loss", // 常规落败：返还为零
  DRAW: "draw", // 骤死上限后仍平：按平局返还函数结算
  CASHED: "cashed", // 玩家主动收钱
};

/** 创建初始比赛状态（不含现金，现金由 engine 维护） */
export function initialMatch() {
  return {
    round: 1,
    phase: PHASE.ATTACK,
    playerGoals: 0,
    oppGoals: 0,
    playerTaken: 0,
    oppTaken: 0,
    suddenDeath: false,
    sdSet: 0,
    ended: null, // END.* 或 null
  };
}

/** 常规赛剩余罚球数 */
function regularRemaining(m) {
  return {
    player: Math.max(0, REGULAR_ROUNDS - m.playerTaken),
    opp: Math.max(0, REGULAR_ROUNDS - m.oppTaken),
  };
}

/**
 * 常规赛阶段的提前胜负判定。
 * 玩家胜：已进球数 > 对手已进球数 + 对手剩余次数
 * 玩家负：对手已进球数 > 玩家已进球数 + 玩家剩余次数
 */
export function decideRegular(m) {
  const rem = regularRemaining(m);
  if (m.playerGoals > m.oppGoals + rem.opp) return END.WIN;
  if (m.oppGoals > m.playerGoals + rem.player) return END.LOSS;
  if (rem.player === 0 && rem.opp === 0) {
    if (m.playerGoals > m.oppGoals) return END.WIN;
    if (m.playerGoals < m.oppGoals) return END.LOSS;
    return null; // 平局 -> 进入骤死
  }
  return null;
}

/** 骤死赛：每组双方各罚一球，结果不同即分出胜负 */
export function decideSuddenDeath(m) {
  // 只在一组完整结束（双方都罚过）后判定
  if (m.playerTaken !== m.oppTaken || m.playerTaken < REGULAR_ROUNDS + m.sdSet)
    return null;
  if (m.playerGoals > m.oppGoals) return END.WIN;
  if (m.playerGoals < m.oppGoals) return END.LOSS;
  if (m.sdSet >= SUDDEN_DEATH_SETS) return END.DRAW;
  return null;
}

/** 当前状态是否已终局（纯函数，不修改入参） */
export function evaluateEnd(m) {
  if (m.ended) return m.ended;
  return m.suddenDeath ? decideSuddenDeath(m) : decideRegular(m);
}

/** 应用一次进攻结果，返回新的比赛状态 */
export function applyAttack(m, scored) {
  const next = { ...m, playerTaken: m.playerTaken + 1 };
  if (scored) next.playerGoals = m.playerGoals + 1;
  const end = evaluateEnd(next);
  if (end) {
    next.ended = end;
    return next;
  }
  next.phase = PHASE.DEFEND;
  return next;
}

/** 应用一次防守结果（saved=true 表示扑出，对手未进） */
export function applyDefend(m, saved) {
  const next = { ...m, oppTaken: m.oppTaken + 1 };
  if (!saved) next.oppGoals = m.oppGoals + 1;
  const end = evaluateEnd(next);
  if (end) {
    next.ended = end;
    return next;
  }
  // 本轮结束，推进到下一轮
  if (next.suddenDeath) {
    next.sdSet = next.sdSet + 1;
    next.phase = PHASE.ATTACK;
    return next;
  }
  if (next.playerTaken >= REGULAR_ROUNDS && next.oppTaken >= REGULAR_ROUNDS) {
    // 常规赛打完且平局 -> 骤死
    next.suddenDeath = true;
    next.sdSet = 1;
    next.phase = PHASE.ATTACK;
    return next;
  }
  next.round = next.round + 1;
  next.phase = PHASE.ATTACK;
  return next;
}

/**
 * 预判某个动作结果会把比赛带向哪里。
 * 这是现金模型的关键输入：若失败分支即为常规落败，该分支必须让现金归零。
 */
export function previewOutcomes(m) {
  if (m.phase === PHASE.ATTACK) {
    return {
      success: applyAttack(m, true),
      failure: applyAttack(m, false),
    };
  }
  return {
    success: applyDefend(m, true),
    failure: applyDefend(m, false),
  };
}

/** 剩余罚球数（含骤死显示） */
export function remainingShots(m) {
  if (m.suddenDeath) {
    const target = REGULAR_ROUNDS + m.sdSet;
    return {
      player: Math.max(0, target - m.playerTaken),
      opp: Math.max(0, target - m.oppTaken),
    };
  }
  return regularRemaining(m);
}

/**
 * 关键球情境（D4）。按剩余次数计算，普通进球不得误标为必胜。
 * 情境本身不添加任何隐藏概率或额外奖金。
 */
export function keyBall(m) {
  const pv = previewOutcomes(m);
  if (m.phase === PHASE.ATTACK) {
    if (pv.success.ended === END.WIN)
      return { kind: "winChance", text: "这一球进，就赢下大战" };
    if (pv.failure.ended === END.LOSS)
      return { kind: "mustScore", text: "必须罚进，才能继续" };
    if (m.oppGoals - m.playerGoals === 1)
      return { kind: "equalize", text: "罚进可把比分追平" };
    if (m.suddenDeath)
      return { kind: "sudden", text: "骤死赛：本组双方结果不同就分出胜负" };
    return null;
  }
  if (pv.failure.ended === END.LOSS)
    return { kind: "mustSave", text: "必须扑出，才能继续" };
  if (pv.success.ended === END.WIN)
    return { kind: "saveToWin", text: "扑出这球，就赢下大战" };
  if (m.suddenDeath)
    return { kind: "sudden", text: "骤死赛：本组同结果继续，不同结果分胜负" };
  return null;
}
