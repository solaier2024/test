// 单元测试（零依赖，node tools/test.js）
// 覆盖 S0-2 决定性、S0-3 动作模型、S0-4 现金模型、S0-6 赛制与终局、SV-3 幂等与竞态

import { prf, commitment } from '../src/math/prf.js';
import {
  initialMatch,
  applyAttack,
  applyDefend,
  evaluateEnd,
  keyBall,
  END,
  PHASE,
  REGULAR_ROUNDS,
} from '../src/math/rules.js';
import { cashBranches, attackOptions, P_MIN, P_MAX } from '../src/math/actions.js';
import { initialMemory, rememberShot, keeperDiveDistribution, ARCHETYPES, DIRS } from '../src/math/keeper.js';
import { ShootoutEngine } from '../src/math/engine.js';

let pass = 0;
let fail = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (e) {
    fail += 1;
    failures.push(`${name}: ${e.message}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} 期望 ${b}，实际 ${a}`);
}
function near(a, b, tol = 1e-9, msg = '') {
  if (Math.abs(a - b) > tol) throw new Error(`${msg} 期望 ≈${b}，实际 ${a}`);
}
function ok(c, msg = '断言失败') {
  if (!c) throw new Error(msg);
}

// ---------- S0-2 PRF 决定性 ----------
t('PRF 同 seed 同路径完全一致（1000 次）', () => {
  for (let i = 0; i < 1000; i++) {
    const p = `r${i % 5}:attack:L-placed>C-driven`;
    eq(prf('seed-a', p), prf('seed-a', p), 'PRF 不确定');
  }
});

t('PRF 不同路径产生不同值', () => {
  const a = prf('s', 'r1:attack:');
  const b = prf('s', 'r1:attack:L-placed');
  ok(a !== b, '不同路径返回了相同值');
});

t('PRF 落在 [0,1) 且分布大致均匀', () => {
  const buckets = new Array(10).fill(0);
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const v = prf('uniform', `k${i}`);
    ok(v >= 0 && v < 1, `越界 ${v}`);
    buckets[Math.floor(v * 10)] += 1;
  }
  for (const b of buckets) {
    const dev = Math.abs(b - N / 10) / (N / 10);
    ok(dev < 0.05, `分桶偏差过大 ${dev}`);
  }
});

t('承诺值确定且不等于 seed', () => {
  eq(commitment('abc'), commitment('abc'));
  ok(commitment('abc') !== 'abc');
});

// ---------- S0-4 现金模型（鞅） ----------
t('cashBranches 构成公平投注', () => {
  for (const p of [0.2, 0.35, 0.5, 0.71, 0.93]) {
    for (const risk of [0.1, 0.3, 0.55, 0.9]) {
      const b = cashBranches(100, p, risk, false);
      near(p * b.onSuccess + (1 - p) * b.onFailure, 100, 1e-9, `p=${p} risk=${risk}`);
      ok(b.onFailure < 100, '失败分支未使现金下降');
    }
  }
});

t('失败即落败时强制全押且现金归零', () => {
  const b = cashBranches(100, 0.4, 0.3, true);
  eq(b.lossFraction, 1);
  near(b.onFailure, 0, 1e-12);
  near(0.4 * b.onSuccess, 100, 1e-9, '全押分支期望不守恒');
});

t('概率被夹在 [P_MIN, P_MAX]', () => {
  const m = initialMatch();
  const dist = { L: 0.99, C: 0.005, R: 0.005 };
  const opts = attackOptions(m, 100, dist);
  for (const o of opts) ok(o.p >= P_MIN - 1e-12 && o.p <= P_MAX + 1e-12, `p 越界 ${o.p}`);
});

// ---------- S0-6 赛制与终局 ----------
t('提前锁胜：3-0 且双方各罚 3 次后对手只剩 2 次', () => {
  let m = initialMatch();
  // 玩家连进 3 球、对手连失 3 球。此时对手剩 2 次，追不平 3 球差。
  for (let i = 0; i < 3; i++) {
    m = applyAttack(m, true);
    if (m.ended) break;
    m = applyDefend(m, true);
    if (m.ended) break;
  }
  eq(m.ended, END.WIN, '应提前锁胜');
});

t('3-0 但对手仍剩 3 次时不得提前判胜', () => {
  let m = initialMatch();
  m = applyAttack(m, true);
  m = applyDefend(m, true);
  m = applyAttack(m, true);
  m = applyDefend(m, true);
  m = applyAttack(m, true); // 玩家已罚 3 次、对手只罚 2 次
  eq(m.ended, null, '对手还能追平时不应终局');
});

t('提前锁负：对手 3-0 领先且玩家只剩 2 次', () => {
  let m = initialMatch();
  m = applyAttack(m, false);
  m = applyDefend(m, false);
  m = applyAttack(m, false);
  m = applyDefend(m, false);
  m = applyAttack(m, false);
  m = applyDefend(m, false);
  eq(m.ended, END.LOSS, '应提前锁负');
});

t('五轮全平进入骤死赛', () => {
  let m = initialMatch();
  for (let i = 0; i < REGULAR_ROUNDS; i++) {
    m = applyAttack(m, true);
    if (m.ended) break;
    m = applyDefend(m, false); // 双方都进
  }
  ok(!m.ended, `不应终局，实际 ${m.ended}`);
  ok(m.suddenDeath, '应进入骤死赛');
  eq(m.phase, PHASE.ATTACK);
});

t('骤死赛结果不同即分出胜负', () => {
  let m = { ...initialMatch(), suddenDeath: true, sdSet: 1, playerTaken: 5, oppTaken: 5, playerGoals: 3, oppGoals: 3 };
  m = applyAttack(m, true); // 玩家进
  ok(!m.ended, '玩家罚进后不应立刻终局');
  m = applyDefend(m, true); // 扑出 -> 对手失
  eq(m.ended, END.WIN, '应判玩家胜');
});

t('骤死三组仍平判定为平局', () => {
  let m = { ...initialMatch(), suddenDeath: true, sdSet: 1, playerTaken: 5, oppTaken: 5, playerGoals: 3, oppGoals: 3 };
  for (let s = 0; s < 3; s++) {
    m = applyAttack(m, true);
    if (m.ended) break;
    m = applyDefend(m, false);
    if (m.ended) break;
  }
  eq(m.ended, END.DRAW, '应判平局');
});

t('关键球不把普通进球误标为必胜', () => {
  const m = initialMatch();
  const k = keyBall(m);
  ok(k === null || k.kind !== 'winChance', '首轮不应出现「这一球进就赢」');
});

t('关键球能识别必须罚进', () => {
  // 玩家 0-2 落后，已各罚 3 次：玩家剩 2 次，对手剩 2 次
  // 再失一球则对手 3 > 0 + 1，锁负
  const m = { ...initialMatch(), round: 4, playerTaken: 3, oppTaken: 3, playerGoals: 0, oppGoals: 3 };
  const k = keyBall(m);
  ok(k && k.kind === 'mustScore', `应提示必须罚进，实际 ${JSON.stringify(k)}`);
});

// ---------- 记忆 ----------
t('记忆：重复同方向提高该方向猜中概率', () => {
  let mem = initialMemory();
  const a = 'anticipator';
  const before = keeperDiveDistribution({ L: 1 / 3, C: 1 / 3, R: 1 / 3 }, mem, a);
  for (let i = 0; i < 3; i++) mem = rememberShot(mem, a, 'L');
  const after = keeperDiveDistribution({ L: 1 / 3, C: 1 / 3, R: 1 / 3 }, mem, a);
  ok(after.L > before.L + 0.05, `左侧猜中概率未上升：${before.L} -> ${after.L}`);
});

t('记忆有上限，重复不会让方向永久不可用', () => {
  let mem = initialMemory();
  const a = 'anticipator';
  for (let i = 0; i < 30; i++) mem = rememberShot(mem, a, 'L');
  const d = keeperDiveDistribution({ L: 1 / 3, C: 1 / 3, R: 1 / 3 }, mem, a);
  ok(d.L <= ARCHETYPES[a].cap + 1e-9, `超出上限 ${d.L}`);
  ok(d.L < 0.95, '左侧被永久封死');
});

t('记忆会衰减：早期记录权重低于最近记录', () => {
  const a = 'anticipator';
  let m1 = initialMemory();
  m1 = rememberShot(m1, a, 'L');
  for (let i = 0; i < 4; i++) m1 = rememberShot(m1, a, 'R');
  const d = keeperDiveDistribution({ L: 1 / 3, C: 1 / 3, R: 1 / 3 }, m1, a);
  ok(d.R > d.L, '最近的右侧未获得更高权重');
});

t('分布恒为合法概率', () => {
  for (const a of Object.keys(ARCHETYPES)) {
    let mem = initialMemory();
    for (let i = 0; i < 12; i++) {
      mem = rememberShot(mem, a, DIRS[i % 3]);
      const d = keeperDiveDistribution({ L: 0.5, C: 0.2, R: 0.3 }, mem, a);
      near(d.L + d.C + d.R, 1, 1e-9, '分布未归一化');
      for (const k of DIRS) ok(d[k] > 0, '出现非正概率');
    }
  }
});

// ---------- 引擎：幂等、竞态、报价一致性 ----------
t('引擎初始现金 = W × r', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'eng-1' });
  near(e.cash, 9.6, 1e-12);
});

t('同一 seed 产出完全相同的一场比赛', () => {
  const play = () => {
    const e = new ShootoutEngine({ stake: 10, seed: 'repeat-me' });
    const trace = [];
    while (!e.getSettlement()) {
      const q = e.getQuote();
      if (!q) break;
      const r = e.submit(q.options[0].id, q.quoteId);
      trace.push(`${r.actionId}:${r.success}:${r.cashAfter}`);
    }
    return trace.join('|') + '#' + e.getSettlement().payout;
  };
  eq(play(), play(), '同 seed 重放结果不一致');
});

t('幂等：重复提交同一报价只生效一次', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'idem' });
  const q = e.getQuote();
  const r1 = e.submit(q.options[0].id, q.quoteId);
  const r2 = e.submit(q.options[0].id, q.quoteId);
  eq(r2.cashAfter, r1.cashAfter, '重复提交产生了第二次效果');
  eq(e.log.length, 1, '日志出现重复条目');
});

t('过期报价被拒绝', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'stale' });
  const q = e.getQuote();
  e.submit(q.options[0].id, q.quoteId);
  let threw = false;
  try {
    e.submit('L-placed', 'q-bogus');
  } catch {
    threw = true;
  }
  ok(threw, '未拒绝过期/伪造报价');
});

t('竞态：收钱后不再接受动作', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'race' });
  // 打到第一个收钱窗口
  while (!e.getSettlement()) {
    const q = e.getQuote();
    if (!q) break;
    if (q.canCashOut) {
      e.cashOut(q.quoteId);
      break;
    }
    e.submit(q.options[0].id, q.quoteId);
  }
  ok(e.getSettlement(), '未能收钱');
  let threw = false;
  try {
    e.submit('L-placed', 'anything');
  } catch {
    threw = true;
  }
  ok(threw, '结算后仍接受动作');
});

t('首轮不允许立刻收钱', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'nocash' });
  eq(e.getQuote().canCashOut, false, '第一轮开局就能兑现');
});

t('结算包含唯一标识、seed 揭示与动作日志', () => {
  const e = new ShootoutEngine({ stake: 10, seed: 'settle' });
  while (!e.getSettlement()) {
    const q = e.getQuote();
    if (!q) break;
    e.submit(q.options[0].id, q.quoteId);
  }
  const s = e.getSettlement();
  ok(s.settlementId, '缺少结算标识');
  eq(s.seedRevealed, 'settle', 'seed 未揭示');
  eq(s.commitment, commitment('settle'), '承诺值不匹配');
  ok(Array.isArray(s.actionLog) && s.actionLog.length > 0, '缺少动作日志');
  eq(s.settled, true);
});

t('落败返还为零', () => {
  let found = false;
  for (let i = 0; i < 400 && !found; i++) {
    const e = new ShootoutEngine({ stake: 10, seed: `loss-${i}` });
    while (!e.getSettlement()) {
      const q = e.getQuote();
      if (!q) break;
      // 永远选命中率最低的，尽快输
      e.submit(q.options.reduce((b, o) => (o.p < b.p ? o : b), q.options[0]).id, q.quoteId);
    }
    const s = e.getSettlement();
    if (s.reason === END.LOSS) {
      eq(s.payout, 0, '落败未归零');
      found = true;
    }
  }
  ok(found, '400 局内未出现落败样本');
});

t('每一步报价的期望现金都等于当前现金（1000 局全程）', () => {
  for (let i = 0; i < 1000; i++) {
    const e = new ShootoutEngine({ stake: 10, seed: `mart-${i}` });
    while (!e.getSettlement()) {
      const q = e.getQuote();
      if (!q) break;
      for (const o of q.options) {
        near(o.p * o.onSuccess + (1 - o.p) * o.onFailure, q.cashValue, 1e-9, `局 ${i} 动作 ${o.id}`);
      }
      e.submit(q.options[i % q.options.length].id, q.quoteId);
    }
  }
});

console.log(`\n单元测试：${pass} 通过，${fail} 失败`);
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
