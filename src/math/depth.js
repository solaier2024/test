import { PHASE, REGULAR_ROUNDS } from "./rules.js";

// Parameters are public, finite and shared by the quote, engine and verifier.
export const PLAYERS = Object.freeze([
  {
    id: "luna",
    name: "卢纳",
    number: 9,
    trait: "marksman",
    role: "神射手",
    desc: "推射成功率 +5.5 个百分点，仍受压力与门将记忆影响。",
  },
  {
    id: "vega",
    name: "维加",
    number: 11,
    trait: "marksman",
    role: "神射手",
    desc: "推射成功率 +5.5 个百分点，适合稳定执行。",
  },
  {
    id: "torres",
    name: "托雷斯",
    number: 7,
    trait: "power",
    role: "重炮",
    desc: "抽射成功率 +7 个百分点，抽射的返还波动仍较大。",
  },
  {
    id: "rios",
    name: "里奥斯",
    number: 10,
    trait: "artist",
    role: "艺术家",
    desc: "仅中路独立吊射成功率 +7.5 个百分点；推射与抽射不获得特质加成。",
  },
  {
    id: "silva",
    name: "席尔瓦",
    number: 4,
    trait: "ice",
    role: "冰血",
    desc: "本人射门免除规定的压力扣减，门将记忆照常生效。",
  },
  {
    id: "rojas",
    name: "罗哈斯",
    number: 8,
    trait: "power",
    role: "重炮",
    desc: "抽射成功率 +7 个百分点，可替换阵容中的球员。",
  },
]);
export const DEFAULT_LINEUP = Object.freeze([
  "luna",
  "vega",
  "torres",
  "rios",
  "silva",
]);
export const PRESSURE_NAMES = Object.freeze(["低", "中", "高"]);
export const PRESSURE_PENALTIES = Object.freeze({
  placed: [0, 0.035, 0.075],
  driven: [0, 0.055, 0.11],
  chip: [0, 0.04, 0.09],
  defend: [0, 0.025, 0.055],
});
export const QUICK_POLICY = Object.freeze({
  id: "public-max-save-v1",
  information: "本球公开扑救概率",
  tieOrder: ["L", "C", "R"],
  desc: "自动选择公开扑救概率最高的方向；相同时按左、中、右排序。逐球显示对手结果，轮末仍由你决定继续或收取。",
});
export const CUP_STAGES = Object.freeze([
  {
    id: "quarter",
    name: "八强赛",
    rival: "边路先锋",
    archetype: "stubborn",
    keeper: { L: 0.42, C: 0.22, R: 0.36 },
    shooter: { L: 0.44, C: 0.2, R: 0.36 },
    desc: "左右路威胁较多，门将记忆衰减慢。",
  },
  {
    id: "semi",
    name: "半决赛",
    rival: "反应猎手",
    archetype: "reactor",
    keeper: { L: 0.28, C: 0.32, R: 0.4 },
    shooter: { L: 0.22, C: 0.46, R: 0.32 },
    desc: "射手中路威胁较高，门将较少提前押方向。",
  },
  {
    id: "final",
    name: "决赛",
    rival: "预判大师",
    archetype: "anticipator",
    keeper: { L: 0.36, C: 0.28, R: 0.36 },
    shooter: { L: 0.36, C: 0.22, R: 0.42 },
    desc: "门将快速学习重复球路，需要观察本场变化。",
  },
]);

export function validateLineup(ids = DEFAULT_LINEUP) {
  if (
    !Array.isArray(ids) ||
    ids.length !== 5 ||
    new Set(ids).size !== 5 ||
    ids.some((id) => !PLAYERS.some((p) => p.id === id))
  )
    throw new Error("阵容必须包含五名不同球员");
  return [...ids];
}
export function currentPlayer(match, lineup = DEFAULT_LINEUP) {
  // All five take a regular kick. Sudden death starts the same frozen order again.
  return PLAYERS.find(
    (p) => p.id === lineup[match.playerTaken % REGULAR_ROUNDS],
  );
}
export function pressureAt(match, strain = 0) {
  const sources = [];
  let floor = 0;
  if (match.oppGoals > match.playerGoals) {
    floor = 1;
    sources.push("比分落后");
  }
  if (match.suddenDeath) {
    floor = 2;
    sources.push("骤死赛");
  } else if (match.round >= REGULAR_ROUNDS) {
    floor = 2;
    sources.push("常规末轮");
  }
  if (strain) sources.push("近期失误或失球");
  const level = Math.max(floor, strain);
  return {
    level,
    name: PRESSURE_NAMES[level],
    strain,
    sources,
    recovery:
      "进球或扑救使近期压力降低一级；比分落后、末轮与骤死的情境压力仍保留。",
  };
}
export function advanceStrain(strain, success) {
  return Math.max(0, Math.min(2, strain + (success ? -1 : 1)));
}
export function shotModifiers(player, shot, pressure = { level: 0 }) {
  const traitBonus =
    player?.trait === "marksman" && shot === "placed"
      ? 0.055
      : player?.trait === "power" && shot === "driven"
        ? 0.07
        : player?.trait === "artist" && shot === "chip"
          ? 0.075
          : 0;
  const pressurePenalty =
    player?.trait === "ice" ? 0 : PRESSURE_PENALTIES[shot][pressure.level];
  return {
    traitBonus,
    pressurePenalty,
    pressureImmune: player?.trait === "ice",
  };
}
export function canAdjust(match, adjustmentsUsed = 0) {
  return (
    !match.ended &&
    !match.suddenDeath &&
    match.phase === PHASE.ATTACK &&
    match.playerTaken > 0 &&
    match.playerTaken === match.oppTaken &&
    match.playerTaken <= 3 &&
    adjustmentsUsed === 0
  );
}
export function adjustLineup(match, lineup, used, first, second) {
  if (
    !canAdjust(match, used) ||
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < match.playerTaken ||
    second < match.playerTaken ||
    first >= 5 ||
    second >= 5 ||
    first === second
  )
    throw new Error("仅可在轮末，用一次调整交换两名未出场球员");
  const next = [...lineup];
  [next[first], next[second]] = [next[second], next[first]];
  return next;
}
export function autoDefense(quote, available = ["L", "C", "R"]) {
  if (quote?.phase !== PHASE.DEFEND) throw new Error("自动防守仅用于防守阶段");
  const options = quote.options.filter((o) => available.includes(o.dir));
  return (
    options.sort(
      (a, b) =>
        b.p - a.p ||
        QUICK_POLICY.tieOrder.indexOf(a.dir) -
          QUICK_POLICY.tieOrder.indexOf(b.dir),
    )[0] ?? null
  );
}
