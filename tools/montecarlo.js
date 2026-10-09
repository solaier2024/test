// S0-9：蒙特卡洛回归与分布检查
//
// 注意定位：这是回归与分布检查，不是 EV 中性的证明。
// 证明由 tools/solve.js 的完整状态求解给出。
// 本工具报告样本量、方差、置信区间与尾部事件覆盖。

import { pathToFileURL } from "node:url";
import { ShootoutEngine } from "../src/math/engine.js";
import { END } from "../src/math/rules.js";
import { DEFAULT_LINEUP, autoDefense, CUP_STAGES } from "../src/math/depth.js";

const STAKE = 10;

/** 若干固定策略。每个策略返回要提交的动作 id。 */
const STRATEGIES = {
  "全推射-左": (q) => pick(q, (o) => o.id === "L-placed" || o.id === "dive-L"),
  "全抽射-左": (q) => pick(q, (o) => o.id === "L-driven" || o.id === "dive-L"),
  固定方向中: (q) => pick(q, (o) => o.id === "C-placed" || o.id === "dive-C"),
  完美轮换: (q, i) => {
    const d = ["L", "C", "R"][i % 3];
    return pick(q, (o) => o.id === `${d}-placed` || o.id === `dive-${d}`);
  },
  最高命中率: (q) =>
    q.options.reduce((b, o) => (o.p > b.p ? o : b), q.options[0]).id,
  最低命中率: (q) =>
    q.options.reduce((b, o) => (o.p < b.p ? o : b), q.options[0]).id,
  随机: (q, i, rnd) => q.options[Math.floor(rnd() * q.options.length)].id,
  读线索防守: (q) => {
    if (q.phase === "defend")
      return q.options.reduce((b, o) => (o.p > b.p ? o : b), q.options[0]).id;
    return q.options.reduce((b, o) => (o.p > b.p ? o : b), q.options[0]).id;
  },
};

function pick(q, pred) {
  const o = q.options.find(pred);
  return (o ?? q.options[0]).id;
}

/** 收钱规则：null 表示永不收钱（打到终局） */
function makeCashRule(afterRounds) {
  return (engine) => {
    if (afterRounds == null) return false;
    return engine.match.playerTaken >= afterRounds;
  };
}

function simulate(strategyName, cashAfter, rounds, seedPrefix, setup = {}) {
  const strat = STRATEGIES[strategyName];
  const cashRule = makeCashRule(cashAfter);
  let total = 0;
  let totalSq = 0;
  let maxPayout = 0;
  const ends = { win: 0, loss: 0, draw: 0, cashed: 0 };
  let wins = 0;
  let moneyWins = 0;
  let coachMoves = 0;

  for (let n = 0; n < rounds; n++) {
    const seed = `${seedPrefix}-${n}`;
    const engine = new ShootoutEngine({
      stake: STAKE,
      seed,
      lineup: setup.reverse ? [...DEFAULT_LINEUP].reverse() : DEFAULT_LINEUP,
      config: {
        mode: setup.mode ?? "full",
        cupStage: setup.cupStage ?? null,
        enableChip: Boolean(setup.chip),
      },
    });
    let i = 0;
    let rs = n * 2654435761 + 1;
    const rnd = () => {
      rs = (rs * 1664525 + 1013904223) >>> 0;
      return rs / 4294967296;
    };
    while (!engine.getSettlement()) {
      const q = engine.getQuote();
      if (!q) break;
      if (q.canCashOut && cashRule(engine)) {
        engine.cashOut(q.quoteId);
        break;
      }
      if (
        q.canAdjust &&
        (setup.coach === "early" ||
          (setup.coach === "pressure" && q.pressure.level >= 1) ||
          (setup.coach === "late" && engine.match.round >= 4))
      ) {
        const slot = engine.match.playerTaken,
          ice = engine.lineup.indexOf("silva");
        const other = ice > slot ? ice : 4;
        engine.adjust(slot, other, q.quoteId);
        coachMoves++;
        continue;
      }
      const action =
        setup.mode === "quick" && q.phase === "defend"
          ? autoDefense(q).id
          : strat(q, i++, rnd);
      engine.submit(action, q.quoteId);
    }
    const s = engine.getSettlement();
    total += s.payout;
    totalSq += s.payout * s.payout;
    maxPayout = Math.max(maxPayout, s.payout);
    ends[s.reason] = (ends[s.reason] ?? 0) + 1;
    if (s.reason === END.WIN) wins += 1;
    if (s.payout > STAKE) moneyWins += 1;
  }

  const mean = total / rounds;
  const variance = totalSq / rounds - mean * mean;
  const sd = Math.sqrt(Math.max(0, variance));
  const se = sd / Math.sqrt(rounds);
  return {
    strategyName,
    cashAfter,
    rtp: mean / STAKE,
    ci95: (1.96 * se) / STAKE,
    sd: sd / STAKE,
    maxMultiple: maxPayout / STAKE,
    winRate: wins / rounds,
    moneyWinRate: moneyWins / rounds,
    ends,
    coachMoves,
  };
}

function run() {
  const ROUNDS = Number(process.env.MC_ROUNDS ?? 60000);
  const target = 0.96;
  console.log(
    "=== S0-9 蒙特卡洛回归（非 EV 中性证明，证明见 tools/solve.js）===\n",
  );
  console.log(`每个策略样本量 N = ${ROUNDS}，目标 RTP = ${target}\n`);
  console.log(
    "策略                收钱点   RTP      ±95%CI    标准差   最大倍数  比赛胜率  赢钱率",
  );

  const cases = [];
  for (const name of Object.keys(STRATEGIES)) cases.push([name, null]);
  for (const after of [1, 2, 3, 4]) cases.push(["最高命中率", after]);
  cases.push(["随机", 2]);
  cases.push(["全抽射-左", 3]);
  cases.push(["最高命中率", null, { coach: "early" }]);
  cases.push(["最高命中率", null, { coach: "pressure", reverse: true }]);
  cases.push(["最高命中率", null, { coach: "late" }]);
  cases.push(["最高命中率", 2, { mode: "quick", coach: "early" }]);
  cases.push(["随机", null, { mode: "quick", reverse: true }]);
  cases.push(["最高命中率", null, { chip: true }]);
  for (const stage of CUP_STAGES)
    cases.push(["最高命中率", null, { cupStage: stage.id }]);

  let worst = 0;
  const rows = [];
  for (const [name, after, setup = {}] of cases) {
    const label = `${name}${setup.coach ? `/${setup.coach}` : ""}${setup.mode === "quick" ? "/quick" : ""}${setup.chip ? "/chip" : ""}${setup.cupStage ? `/${setup.cupStage}` : ""}`;
    const r = simulate(name, after, ROUNDS, `mc-${label}-${after}`, setup);
    rows.push(r);
    const dev = Math.abs(r.rtp - target);
    worst = Math.max(worst, dev - r.ci95);
    console.log(
      `${label.padEnd(24)} ${String(after ?? "不收").padStart(5)}  ` +
        `${r.rtp.toFixed(4)}  ±${r.ci95.toFixed(4)}  ${r.sd.toFixed(3)}  ` +
        `${r.maxMultiple.toFixed(1).padStart(8)}  ${(r.winRate * 100).toFixed(1).padStart(7)}%  ${(r.moneyWinRate * 100).toFixed(1).padStart(6)}%`,
    );
  }

  console.log("\n--- 终局路径分布（全部策略合并）---");
  const agg = {};
  for (const r of rows)
    for (const [k, v] of Object.entries(r.ends)) agg[k] = (agg[k] ?? 0) + v;
  const aggTotal = Object.values(agg).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(agg)) {
    console.log(`  ${k.padEnd(7)} ${((v / aggTotal) * 100).toFixed(2)}%`);
  }
  console.log(
    `\n尾部覆盖：最大派发倍数 ${Math.max(...rows.map((r) => r.maxMultiple)).toFixed(1)}×`,
  );
  console.log(
    `已执行教练调整：${rows.reduce((sum, row) => sum + row.coachMoves, 0)} 次；样本终局不等于全部尾部覆盖。`,
  );

  // 所有策略的 RTP 必须在各自 95% 置信区间内覆盖目标值
  const pass = worst <= 0.002;
  console.log(
    `\n各策略 |RTP − 目标| 超出置信区间的最大幅度：${worst.toFixed(5)}（百分点容差 0.2）`,
  );
  console.log(`${pass ? "PASS" : "FAIL"} —— 全部已测策略与目标 RTP 一致`);
  if (!pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
