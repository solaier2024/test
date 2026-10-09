import { DEFAULT_LINEUP, validateLineup, CUP_STAGES } from "../math/depth.js";

export const PROGRESS_KEY = "last-kick-progress-v1";
export const ACHIEVEMENTS = Object.freeze([
  { id: "first-win", name: "开门红", desc: "赢下一场点球大战。" },
  {
    id: "perfect",
    name: "百发百中",
    desc: "至少罚三球，所有已罚球均进；提前结束也按实际次数统计。",
  },
  { id: "wall", name: "球门守护者", desc: "同一场扑出至少三球。" },
  { id: "ice", name: "冷静终结者", desc: "冰血球员在高压力下罚进。" },
  { id: "comeback", name: "逆转时刻", desc: "曾在本场比分落后，最终获胜。" },
  { id: "coach", name: "临场指挥", desc: "使用教练调整后，完成下一次射门。" },
  {
    id: "champion",
    name: "杯赛冠军",
    desc: "连续赢下八强赛、半决赛和决赛；各场独立结算。",
  },
]);
export const KITS = Object.freeze([
  {
    id: "teal",
    name: "夜场青",
    color: "#8cd5dc",
    requirement: "默认球衣",
    unlocked: () => true,
  },
  {
    id: "navy",
    name: "深蓝军团",
    color: "#8ba8ea",
    requirement: "完成 5 场",
    unlocked: (p) => p.stats.matches >= 5,
  },
  {
    id: "green",
    name: "主场绿",
    color: "#88d09d",
    requirement: "累计 3 胜",
    unlocked: (p) => p.stats.wins >= 3,
  },
  {
    id: "gold",
    name: "冠军金",
    color: "#ffc35a",
    requirement: "赢得杯赛",
    unlocked: (p) => p.stats.cups >= 1,
  },
]);
const empty = () => ({
  version: 1,
  lineup: [...DEFAULT_LINEUP],
  mode: "full",
  kit: "teal",
  title: null,
  stats: { matches: 0, wins: 0, goals: 0, saves: 0, cups: 0, xp: 0 },
  achievements: [],
  opponents: [],
  records: [],
  processed: [],
  cup: null,
});
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function sanitize(raw) {
  if (!raw || raw.version !== 1) return empty();
  const p = empty();
  try {
    p.lineup = validateLineup(raw.lineup);
  } catch {
    /* Use the default five. */
  }
  p.mode = raw.mode === "quick" ? "quick" : "full";
  for (const key of Object.keys(p.stats))
    if (integer(raw.stats?.[key])) p.stats[key] = Math.min(raw.stats[key], 1e9);
  p.achievements = [
    ...new Set(
      (Array.isArray(raw.achievements) ? raw.achievements : []).filter((id) =>
        ACHIEVEMENTS.some((a) => a.id === id),
      ),
    ),
  ];
  p.opponents = [
    ...new Set(
      (Array.isArray(raw.opponents) ? raw.opponents : []).filter((id) =>
        ["anticipator", "reactor", "stubborn"].includes(id),
      ),
    ),
  ];
  p.kit = KITS.some((k) => k.id === raw.kit && k.unlocked(p))
    ? raw.kit
    : "teal";
  p.title = p.achievements.includes(raw.title) ? raw.title : null;
  p.processed = (Array.isArray(raw.processed) ? raw.processed : [])
    .filter((id) => typeof id === "string" && id.length < 160)
    .slice(-128);
  p.records = (Array.isArray(raw.records) ? raw.records : [])
    .filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        r.id.length < 160 &&
        integer(r.goals) &&
        integer(r.shots) &&
        integer(r.saves) &&
        integer(r.oppGoals) &&
        ["win", "loss", "draw", "cashed"].includes(r.reason),
    )
    .slice(-40)
    .map((r) => ({
      id: r.id,
      goals: r.goals,
      shots: r.shots,
      saves: r.saves,
      oppGoals: r.oppGoals,
      reason: r.reason,
      mode: r.mode === "quick" ? "quick" : "full",
      cupStage: CUP_STAGES.some((s) => s.id === r.cupStage) ? r.cupStage : null,
      elapsedMs:
        Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0
          ? Math.min(r.elapsedMs, 86_400_000)
          : 0,
    }));
  if (
    raw.cup &&
    integer(raw.cup.stage) &&
    raw.cup.stage <= 3 &&
    ["active", "eliminated", "completed"].includes(raw.cup.status) &&
    (raw.cup.status === "completed") === (raw.cup.stage === 3)
  )
    p.cup = { stage: raw.cup.stage, status: raw.cup.status };
  return p;
}

// Non-cash progression never enters Engine, probabilities, cash or PRF inputs.
export class GameProgress {
  constructor(storage = null) {
    this.storage = storage;
    this.storageAvailable = Boolean(storage);
    try {
      this.profile = sanitize(
        JSON.parse(storage?.getItem(PROGRESS_KEY) ?? "null"),
      );
    } catch {
      this.profile = empty();
    }
  }
  save() {
    try {
      this.storage?.setItem(PROGRESS_KEY, JSON.stringify(this.profile));
    } catch {
      this.storageAvailable = false;
    }
    return this.profile;
  }
  preferences({ lineup, mode, kit, title } = {}) {
    if (lineup) this.profile.lineup = validateLineup(lineup);
    if (mode && ["full", "quick"].includes(mode)) this.profile.mode = mode;
    if (kit && KITS.some((k) => k.id === kit && k.unlocked(this.profile)))
      this.profile.kit = kit;
    if (title === null || this.profile.achievements.includes(title))
      this.profile.title = title;
    return this.save();
  }
  startCup() {
    if (this.profile.cup?.status !== "active")
      this.profile.cup = { stage: 0, status: "active" };
    return this.save();
  }
  record(settlement, archetype) {
    const p = this.profile;
    if (p.processed.includes(settlement.settlementId))
      return { unlocked: [], duplicate: true, cup: p.cup };
    const attacks = settlement.events.filter((e) => e.kind === "attack");
    const defenses = settlement.events.filter((e) => e.kind === "defend");
    const goals = attacks.filter((e) => e.success).length,
      saves = defenses.filter((e) => e.success).length;
    const win = settlement.reason === "win";
    p.processed.push(settlement.settlementId);
    p.processed = p.processed.slice(-128);
    p.stats.matches += 1;
    p.stats.wins += Number(win);
    p.stats.goals += goals;
    p.stats.saves += saves;
    p.stats.xp += 10 + Number(win) * 20 + goals * 2 + saves * 3;
    if (!p.opponents.includes(archetype)) p.opponents.push(archetype);
    let champion = false;
    if (
      settlement.config.cupStage &&
      p.cup?.status === "active" &&
      CUP_STAGES[p.cup.stage]?.id === settlement.config.cupStage
    ) {
      if (win) {
        p.cup.stage += 1;
        if (p.cup.stage === CUP_STAGES.length) {
          p.cup.status = "completed";
          p.stats.cups += 1;
          champion = true;
        }
      } else p.cup.status = "eliminated";
    }
    const coachIndex = settlement.events.findIndex((e) => e.kind === "coach");
    const earned = [
      win && "first-win",
      attacks.length >= 3 && goals === attacks.length && "perfect",
      saves >= 3 && "wall",
      attacks.some(
        (e) =>
          e.success &&
          e.player?.trait === "ice" &&
          e.pressureBefore?.level === 2,
      ) && "ice",
      win &&
        settlement.events.some(
          (e) => e.score && e.score.player < e.score.opp,
        ) &&
        "comeback",
      coachIndex >= 0 &&
        settlement.events
          .slice(coachIndex + 1)
          .some((e) => e.kind === "attack") &&
        "coach",
      champion && "champion",
    ].filter(Boolean);
    const unlocked = earned.filter((id) => !p.achievements.includes(id));
    p.achievements.push(...unlocked);
    p.records.push({
      id: settlement.settlementId,
      goals,
      shots: attacks.length,
      saves,
      oppGoals: defenses.length - saves,
      reason: settlement.reason,
      mode: settlement.config.mode,
      cupStage: settlement.config.cupStage,
      elapsedMs: settlement.elapsedMs,
    });
    p.records = p.records.slice(-40);
    this.save();
    return { unlocked, duplicate: false, cup: p.cup };
  }
}

export function matchHighlights(settlement) {
  const events = settlement.events,
    shots = events.filter((e) => e.kind === "attack"),
    saves = events.filter((e) => e.kind === "defend" && e.success),
    lines = [];
  const goals = shots.filter((e) => e.success).length;
  lines.push(
    `实际罚球 ${goals}/${shots.length}，扑出 ${saves.length}/${events.filter((e) => e.kind === "defend").length}。`,
  );
  const coach = events.find((e) => e.kind === "coach");
  if (coach)
    lines.push(
      `第 ${coach.round} 轮前交换第 ${coach.slots[0] + 1} 与第 ${coach.slots[1] + 1} 名球员，保留了比分、压力与门将记忆。`,
    );
  const key = [...events]
    .reverse()
    .find((e) => e.keyBallBefore && e.kind !== "coach");
  if (key && lines.length < 3)
    lines.push(
      `${key.suddenDeath ? "骤死" : "常规"}第 ${key.round} ${key.suddenDeath ? "组" : "轮"}关键球：${key.kind === "attack" ? (key.success ? "罚进" : "未进") : key.success ? "扑出" : "失球"}，比分 ${key.score.player}:${key.score.opp}。`,
    );
  if (lines.length < 3) {
    const repeated = shots.find((e, i) => i && shots[i - 1].dir === e.dir);
    if (repeated)
      lines.push(
        `连续选择同一方向，第二次出脚时门将押该方向 ${Math.round(repeated.keeperDistBefore[repeated.dir] * 100)}%。本场记录已参与报价。`,
      );
  }
  return lines.slice(0, 3);
}
