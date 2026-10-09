// S0-7：完整状态求解的 Vmax / Vmin 边界
//
// 为什么这是真正的证明而不是抽样：
//
// 现金价值在每一步都按「乘性因子」推进，而因子只取决于（比赛状态, 记忆, 动作），
// 与当前现金的绝对值无关。所以现金价值具有标度不变性：
//
//     V(s) = cash(s) × Φ(非现金部分)
//
// 于是可以在把现金归一化为 1 的前提下，对有限的「比赛状态 × 记忆状态」做
// 反向归纳，求出每个状态的最优 Φmax 与最差 Φmin：
//
//     Φmax(s) = max_a Σ P(s'|s,a) × factor(a,s') × Φmax(s')
//     Φmin(s) = min_a Σ P(s'|s,a) × factor(a,s') × Φmin(s')
//     终局：Φ = 1（WIN/CASHED/DRAW 按现金返还）或 0（LOSS，现金已归零）
//
// 若鞅条件精确成立，则对任意动作 Σ P × factor = 1，因此 Φ ≡ 1，
// 从而 Vmax(s₀) = Vmin(s₀) = C(s₀) = W × r。
//
// 本工具穷举实现中真实可达的状态空间并断言这一点。

import { pathToFileURL } from 'node:url';
import { PHASE, END, initialMatch, applyAttack, applyDefend, evaluateEnd } from '../src/math/rules.js';
import {
  ARCHETYPES,
  DIRS,
  initialMemory,
  rememberShot,
  keeperDiveDistribution,
  makePreMatchTendency,
  makeShooterTendency,
} from '../src/math/keeper.js';
import { attackOptions, defenseOptions } from '../src/math/actions.js';
import { prf } from '../src/math/prf.js';

/** 记忆状态需要进入状态键，因为它改变条件概率 */
function memKey(mem) {
  return `${mem.history.join('')}`;
}

function matchKey(m) {
  return [
    m.suddenDeath ? `sd${m.sdSet}` : `r${m.round}`,
    m.phase,
    m.playerGoals,
    m.oppGoals,
    m.playerTaken,
    m.oppTaken,
  ].join('|');
}

/**
 * 对单个对手配置做完整反向归纳。
 * 返回 { phiMax, phiMin, states, violations }
 */
export function solveOpponent({ archetype, preMatchTendency, shooterTendency }) {
  const cacheMax = new Map();
  const cacheMin = new Map();
  let states = 0;
  const violations = [];

  function visit(match, memory, pick) {
    const end = match.ended ?? evaluateEnd(match);
    if (end) {
      // LOSS 时现金已归零，Φ 乘到 0 的现金上仍是 0；其余按现金返还 Φ=1
      return end === END.LOSS ? 0 : 1;
    }
    const key = `${matchKey(match)}#${memKey(memory)}`;
    const cache = pick === 'max' ? cacheMax : cacheMin;
    if (cache.has(key)) return cache.get(key);
    states += 1;

    // 用归一化现金 1 取得动作集合，factor 即为 (1+u) / (1-d)
    let options;
    if (match.phase === PHASE.ATTACK) {
      const dist = keeperDiveDistribution(preMatchTendency, memory, archetype);
      options = attackOptions(match, 1, dist);
    } else {
      options = defenseOptions(match, 1, shooterTendency);
    }

    let best = pick === 'max' ? -Infinity : Infinity;
    for (const o of options) {
      let sMatch, fMatch, sMem, fMem;
      if (match.phase === PHASE.ATTACK) {
        sMem = rememberShot(memory, archetype, o.dir);
        fMem = sMem;
        sMatch = applyAttack(match, true);
        fMatch = applyAttack(match, false);
      } else {
        sMem = memory;
        fMem = memory;
        sMatch = applyDefend(match, true);
        fMatch = applyDefend(match, false);
      }
      const vs = visit(sMatch, sMem, pick);
      const vf = visit(fMatch, fMem, pick);
      const ev = o.p * o.onSuccess * vs + (1 - o.p) * o.onFailure * vf;

      // 顺带检查单步鞅：Σ P × factor 必须为 1
      const step = o.p * o.onSuccess + (1 - o.p) * o.onFailure;
      if (Math.abs(step - 1) > 1e-9) {
        violations.push({ key, action: o.id, step });
      }
      best = pick === 'max' ? Math.max(best, ev) : Math.min(best, ev);
    }
    cache.set(key, best);
    return best;
  }

  const m0 = initialMatch();
  const mem0 = initialMemory();
  const phiMax = visit(m0, mem0, 'max');
  const phiMin = visit(m0, mem0, 'min');
  return { phiMax, phiMin, states, violations };
}

function run() {
  const config = { targetRtp: 0.96 };
  const stake = 10;
  const tol = 1e-7;
  let worst = 0;
  let totalStates = 0;
  let totalViolations = 0;
  const rows = [];

  // 覆盖三种原型 × 多组由 seed 决定的倾向
  for (const archetype of Object.keys(ARCHETYPES)) {
    for (let k = 0; k < 6; k++) {
      let n = 0;
      const seed = `solve-${archetype}-${k}`;
      const r = () => prf(seed, `setup:${n++}`);
      const preMatchTendency = makePreMatchTendency(r);
      const shooterTendency = makeShooterTendency(r);
      const res = solveOpponent({ archetype, preMatchTendency, shooterTendency });
      totalStates += res.states;
      totalViolations += res.violations.length;
      const vmax = stake * config.targetRtp * res.phiMax;
      const vmin = stake * config.targetRtp * res.phiMin;
      const target = stake * config.targetRtp;
      worst = Math.max(worst, Math.abs(vmax - target), Math.abs(vmin - target));
      rows.push({ archetype, k, states: res.states, phiMax: res.phiMax, phiMin: res.phiMin, vmax, vmin });
    }
  }

  const target = stake * config.targetRtp;
  console.log('=== S0-7 完整状态求解 Vmax / Vmin ===');
  console.log(`下注 W = ${stake}，目标 RTP r = ${config.targetRtp}，目标值 W×r = ${target}\n`);
  console.log('原型            #  状态数      Φmax            Φmin            Vmax        Vmin');
  for (const r of rows) {
    console.log(
      `${r.archetype.padEnd(13)} ${String(r.k).padStart(2)}  ${String(r.states).padStart(7)}  ` +
        `${r.phiMax.toFixed(12)}  ${r.phiMin.toFixed(12)}  ${r.vmax.toFixed(6)}  ${r.vmin.toFixed(6)}`
    );
  }
  console.log(`\n穷举状态总数：${totalStates}`);
  console.log(`单步鞅条件违例：${totalViolations}`);
  console.log(`|V - W×r| 最大偏差：${worst.toExponential(3)}（容差 ${tol.toExponential(1)}）`);

  const pass = worst <= tol && totalViolations === 0;
  console.log(`\n${pass ? 'PASS' : 'FAIL'} —— Vmax = Vmin = W×r ${pass ? '成立' : '不成立'}`);
  if (!pass) process.exitCode = 1;
  return pass;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
