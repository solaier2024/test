// S0-8：无损继续区间检查（S0 出口门禁）
//
// 要证明的命题：不存在任何可达状态，使「继续」严格优于「收钱」。
//
// 做法：在每一个允许收钱的状态上，比较
//     收钱价值 = C(s)
//     继续的最优价值 = max_a Σ P(s'|s,a) × C(s')      （即 C(s) × Φmax(s)）
// 两者必须相等（容差内）。若继续的最优值 > 收钱值，则存在可被套利的无损区间。
//
// 同时检查每个动作的失败分支都确实让现金下降（d > 0），
// 这是 v1 方案的那个硬 bug：失败不扣现金 + 五轮内不会被淘汰 = 无损增值。

import { pathToFileURL } from 'node:url';
import { PHASE, END, initialMatch, applyAttack, applyDefend, evaluateEnd } from '../src/math/rules.js';
import {
  ARCHETYPES,
  initialMemory,
  rememberShot,
  keeperDiveDistribution,
  makePreMatchTendency,
  makeShooterTendency,
} from '../src/math/keeper.js';
import { attackOptions, defenseOptions } from '../src/math/actions.js';
import { prf } from '../src/math/prf.js';

const TOL = 1e-9;

function run() {
  let cashWindows = 0;
  let freerolls = 0;
  let noDownside = 0;
  let checkedActions = 0;
  let maxContinueEdge = 0;
  let minLossFraction = Infinity;

  for (const archetype of Object.keys(ARCHETYPES)) {
    for (let k = 0; k < 4; k++) {
      let n = 0;
      const seed = `freeroll-${archetype}-${k}`;
      const r = () => prf(seed, `setup:${n++}`);
      const preMatchTendency = makePreMatchTendency(r);
      const shooterTendency = makeShooterTendency(r);

      const phiCache = new Map();

      // Φmax：以归一化现金计算「继续」的最优乘性价值
      function phiMax(match, memory) {
        const end = match.ended ?? evaluateEnd(match);
        if (end) return end === END.LOSS ? 0 : 1;
        const key = `${match.suddenDeath ? 'sd' + match.sdSet : 'r' + match.round}|${match.phase}|${match.playerGoals}|${match.oppGoals}|${match.playerTaken}|${match.oppTaken}#${memory.history.join('')}`;
        if (phiCache.has(key)) return phiCache.get(key);

        const options =
          match.phase === PHASE.ATTACK
            ? attackOptions(match, 1, keeperDiveDistribution(preMatchTendency, memory, archetype))
            : defenseOptions(match, 1, shooterTendency);

        let best = -Infinity;
        for (const o of options) {
          checkedActions += 1;
          // 失败分支必须让现金下降
          if (!(o.lossFraction > 0)) noDownside += 1;
          minLossFraction = Math.min(minLossFraction, o.lossFraction);

          let sM, fM, sMem, fMem;
          if (match.phase === PHASE.ATTACK) {
            sMem = rememberShot(memory, archetype, o.dir);
            fMem = sMem;
            sM = applyAttack(match, true);
            fM = applyAttack(match, false);
          } else {
            sMem = memory;
            fMem = memory;
            sM = applyDefend(match, true);
            fM = applyDefend(match, false);
          }
          const ev = o.p * o.onSuccess * phiMax(sM, sMem) + (1 - o.p) * o.onFailure * phiMax(fM, fMem);
          best = Math.max(best, ev);
        }
        phiCache.set(key, best);
        return best;
      }

      // 遍历所有可达状态，在收钱窗口上做比较
      const seen = new Set();
      function walk(match, memory) {
        const end = match.ended ?? evaluateEnd(match);
        if (end) return;
        const key = `${match.suddenDeath ? 'sd' + match.sdSet : 'r' + match.round}|${match.phase}|${match.playerGoals}|${match.oppGoals}|${match.playerTaken}|${match.oppTaken}#${memory.history.join('')}`;
        if (seen.has(key)) return;
        seen.add(key);

        // 收钱窗口：进攻阶段开始前且双方已罚同样次数且非第一轮之前
        const canCash =
          match.phase === PHASE.ATTACK && match.playerTaken > 0 && match.playerTaken === match.oppTaken;
        if (canCash) {
          cashWindows += 1;
          const continueValue = phiMax(match, memory); // 归一化：收钱价值为 1
          const edge = continueValue - 1;
          maxContinueEdge = Math.max(maxContinueEdge, edge);
          if (edge > TOL) freerolls += 1;
        }

        const options =
          match.phase === PHASE.ATTACK
            ? attackOptions(match, 1, keeperDiveDistribution(preMatchTendency, memory, archetype))
            : defenseOptions(match, 1, shooterTendency);
        for (const o of options) {
          if (match.phase === PHASE.ATTACK) {
            const mem2 = rememberShot(memory, archetype, o.dir);
            walk(applyAttack(match, true), mem2);
            walk(applyAttack(match, false), mem2);
          } else {
            walk(applyDefend(match, true), memory);
            walk(applyDefend(match, false), memory);
          }
        }
      }
      walk(initialMatch(), initialMemory());
    }
  }

  console.log('=== S0-8 无损继续区间检查 ===\n');
  console.log(`检查的收钱窗口状态数：${cashWindows}`);
  console.log(`检查的动作数：${checkedActions}`);
  console.log(`「继续」严格优于「收钱」的状态数：${freerolls}`);
  console.log(`max(继续最优值 − 收钱值)：${maxContinueEdge.toExponential(3)}（容差 ${TOL.toExponential(1)}）`);
  console.log(`失败分支不扣现金的动作数：${noDownside}`);
  console.log(`最小失败损失比例 d：${minLossFraction.toFixed(4)}`);

  const pass = freerolls === 0 && noDownside === 0 && maxContinueEdge <= TOL;
  console.log(`\n${pass ? 'PASS' : 'FAIL'} —— ${pass ? '不存在无损继续区间' : '发现无损继续区间'}`);
  if (!pass) process.exitCode = 1;
  return pass;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
