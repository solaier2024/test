import {
  PLAYERS,
  DEFAULT_LINEUP,
  CUP_STAGES,
  QUICK_POLICY,
  PRESSURE_PENALTIES,
} from "../math/depth.js";
import { ARCHETYPES } from "../math/keeper.js";
import { ACHIEVEMENTS, KITS } from "../shell/progress.js";

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (label, action, disabled = false) => {
  const node = el("button", label, "panel-button");
  node.type = "button";
  node.disabled = disabled;
  node.onclick = action;
  return node;
};
const player = (id) => PLAYERS.find((p) => p.id === id);
const jersey = (p, color) => {
  const node = el("div", String(p.number), "jersey-badge");
  node.style.setProperty("--kit-color", color);
  return node;
};

export class DepthPanels {
  constructor({ controller, open, close, toast }) {
    Object.assign(this, { controller, open, close, toast });
  }
  lineup() {
    const c = this.controller(),
      s = c.state,
      preparing = s.screen === "bet";
    const draft = [...s.lineup],
      selected = [],
      node = el("div", null, "depth-panel");
    const render = () => {
      node.replaceChildren();
      const kit = KITS.find((k) => k.id === s.profile.kit);
      node.append(
        el(
          "p",
          preparing
            ? "安排五名不同球员的出场顺序。常规赛每人一球；骤死从第一名重新轮转。"
            : "每场一次，轮末交换两名未出场球员。不会重置比分、压力或门将记忆。",
          "panel-lead",
        ),
      );
      if (!preparing) {
        const pressure = s.match.pressure,
          block = el("div", null, "pressure-block");
        block.append(
          el("strong", `当前压力：${pressure.name}`),
          el("p", pressure.sources.join(" · ") || "近期稳定，尚无情境压力"),
          el("p", pressure.recovery),
          el(
            "p",
            `当前扣减：推射 ${PRESSURE_PENALTIES.placed[pressure.level] * 100}，抽射 ${PRESSURE_PENALTIES.driven[pressure.level] * 100}，扑救 ${PRESSURE_PENALTIES.defend[pressure.level] * 100} 个百分点。冰血只免本人射门的这项扣减。`,
          ),
        );
        node.append(block);
      }
      const list = el("div", null, "lineup-list");
      draft.forEach((id, i) => {
        const p = player(id),
          used = !preparing && i < s.match.playerTaken;
        const row = el(
          "div",
          null,
          `lineup-row${used ? " spent" : ""}${selected.includes(i) ? " chosen" : ""}`,
        );
        row.append(
          el("span", `0${i + 1}`, "slot-number"),
          jersey(p, kit.color),
        );
        const detail = el("div", null, "player-detail");
        detail.append(
          el("strong", p.name),
          el("span", `${p.role}${used ? " · 已出场" : ""}`, "player-role"),
          el("p", p.desc),
        );
        row.append(detail);
        const controls = el("div", null, "player-controls");
        if (preparing) {
          const select = el("select");
          select.setAttribute("aria-label", `第 ${i + 1} 名球员`);
          PLAYERS.forEach((p) => {
            const option = el("option", `${p.name} · ${p.role}`);
            option.value = p.id;
            select.append(option);
          });
          select.value = id;
          select.onchange = () => {
            const existing = draft.indexOf(select.value);
            if (existing >= 0)
              [draft[i], draft[existing]] = [draft[existing], draft[i]];
            else draft[i] = select.value;
            render();
          };
          controls.append(
            select,
            button(
              "上移",
              () => {
                [draft[i], draft[i - 1]] = [draft[i - 1], draft[i]];
                render();
              },
              i === 0,
            ),
            button(
              "下移",
              () => {
                [draft[i], draft[i + 1]] = [draft[i + 1], draft[i]];
                render();
              },
              i === 4,
            ),
          );
        } else
          controls.append(
            button(
              selected.includes(i) ? "已选" : used ? "已出场" : "选择交换",
              () => {
                const at = selected.indexOf(i);
                if (at >= 0) selected.splice(at, 1);
                else if (selected.length < 2) selected.push(i);
                render();
              },
              used || s.busy || !s.quote?.canAdjust,
            ),
          );
        row.append(controls);
        list.append(row);
      });
      node.append(list);
      const footer = el("div", null, "panel-actions");
      if (preparing)
        footer.append(
          button("恢复默认", () => {
            draft.splice(0, 5, ...DEFAULT_LINEUP);
            render();
          }),
          button("沿用上场", () => {
            draft.splice(0, 5, ...c.progress.profile.lineup);
            render();
          }),
          button("确认阵容", () => {
            c.setLineup(draft);
            this.close();
            this.toast("五人出场顺序已更新");
          }),
        );
      else
        footer.append(
          el(
            "span",
            s.match.adjustmentsUsed
              ? "本场调整已用完"
              : s.quote?.canAdjust
                ? "调整剩余 1 次"
                : "需要轮末且至少两名未出场球员",
          ),
          button(
            "确认交换",
            async () => {
              if (await c.adjust(...selected)) {
                this.close();
                this.toast("阵容已交换，当前报价已更新");
              }
            },
            selected.length !== 2 || s.busy,
          ),
        );
      node.append(footer);
      if (preparing)
        node.append(
          el(
            "p",
            s.mode === "quick"
              ? QUICK_POLICY.desc
              : "完整模式由你逐球选择射门与扑救方向。",
            "panel-note",
          ),
        );
      if (!c.present.supports?.({ dir: "C", shot: "chip" }, "attack"))
        node.append(
          el(
            "p",
            "吊射动作素材待补齐。艺术家暂时仅能使用没有特质加成的推射和抽射，也可在赛前替换为重炮。",
            "panel-note",
          ),
        );
    };
    render();
    this.open(preparing ? "五人阵容" : "本场阵容 · 压力 · 教练", node);
  }
  career() {
    const c = this.controller(),
      p = c.progress.profile,
      node = el("div", null, "depth-panel");
    const stats = el("div", null, "career-stats");
    for (const [label, value] of [
      ["比赛", p.stats.matches],
      ["胜场", p.stats.wins],
      ["进球", p.stats.goals],
      ["扑救", p.stats.saves],
      ["冠军", p.stats.cups],
    ]) {
      const item = el("div");
      item.append(el("strong", String(value)), el("span", label));
      stats.append(item);
    }
    node.append(
      stats,
      el(
        "p",
        `等级 ${1 + Math.floor(p.stats.xp / 100)} · ${p.stats.xp} 经验。成绩和外观不会修改成功率、报价或返还。`,
        "panel-lead",
      ),
    );
    node.append(el("h3", "称号与成就"));
    const achievements = el("div", null, "achievement-grid");
    ACHIEVEMENTS.forEach((a) => {
      const earned = p.achievements.includes(a.id),
        card = el("div", null, `achievement-card${earned ? " earned" : ""}`);
      card.append(
        el("strong", `${earned ? "✓ " : "○ "}${a.name}`),
        el("p", a.desc),
        button(
          p.title === a.id ? "已佩戴" : earned ? "佩戴称号" : "待解锁",
          () => {
            c.progress.preferences({ title: a.id });
            c.emit();
            this.career();
          },
          !earned,
        ),
      );
      achievements.append(card);
    });
    node.append(achievements, el("h3", "球衣徽章"));
    node.append(
      el(
        "p",
        "解锁出场名单和比分牌的球衣徽章；当前拍摄视频中的球员服装固定。",
        "panel-note",
      ),
    );
    const kits = el("div", null, "kit-grid");
    KITS.forEach((k) => {
      const unlocked = k.unlocked(p),
        card = el("div", null, `kit-card${unlocked ? " earned" : ""}`);
      card.append(
        jersey({ number: 10 }, k.color),
        el("strong", k.name),
        el("p", k.requirement),
        button(
          p.kit === k.id ? "已装备" : unlocked ? "装备" : "待解锁",
          () => {
            c.progress.preferences({ kit: k.id });
            c.emit();
            this.career();
          },
          !unlocked,
        ),
      );
      kits.append(card);
    });
    node.append(kits, el("h3", "对手图鉴"));
    const opponents = el("div", null, "opponent-grid");
    Object.values(ARCHETYPES).forEach((a) => {
      const seen = p.opponents.includes(a.id),
        card = el("div", null, "opponent-card");
      card.append(
        el("strong", seen ? a.name : "未遇见"),
        el(
          "p",
          seen
            ? `${a.desc}。学习权重 ${a.learn}，记忆衰减 ${a.decay}。`
            : "完成一场与该原型的比赛后解锁。",
        ),
      );
      opponents.append(card);
    });
    node.append(opponents, el("h3", "杯赛路线"));
    const route = el("ol", null, "cup-route");
    CUP_STAGES.forEach((stage, i) => {
      const status =
        p.cup?.stage > i
          ? "✓ 已晋级"
          : p.cup?.stage === i
            ? p.cup.status === "active"
              ? "当前关卡"
              : "本届已结束"
            : "等待挑战";
      route.append(el("li", `${stage.name} · ${stage.rival}　${status}`));
    });
    node.append(
      route,
      el(
        "p",
        "每场独立开局、投入与结算。只在胜利时晋级；平局、落败或主动收取均结束本届。没有连场金钱加成。",
        "panel-note",
      ),
    );
    if (p.records.length) {
      node.append(el("h3", "最近比赛"));
      const records = el("div", null, "recent-matches");
      [...p.records]
        .reverse()
        .slice(0, 8)
        .forEach((r) =>
          records.append(
            el(
              "p",
              `${{ win: "胜", loss: "负", draw: "平", cashed: "主动收取" }[r.reason]} · ${r.goals}:${r.oppGoals} · 进球 ${r.goals}/${r.shots} · 扑出 ${r.saves} · ${r.mode === "quick" ? "自动防守" : "完整攻防"}`,
            ),
          ),
        );
      node.append(records);
    }
    node.append(
      el(
        "p",
        c.progress.storageAvailable
          ? "成长和阵容保存在当前浏览器。更换浏览器不会自动同步。"
          : "浏览器未允许持久保存，本次成长保存在内存中。",
        "panel-note",
      ),
    );
    this.open("生涯 · 成绩 · 杯赛", node);
  }
}
