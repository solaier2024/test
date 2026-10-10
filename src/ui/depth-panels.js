import { tr, pressureLabel } from "../i18n/index.js";
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
  if (text != null) node.textContent = tr(text);
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
            ? tr(
                "安排五名不同球员的出场顺序。常规赛每人一球；骤死从第一名重新轮转。",
              )
            : tr(
                "每场一次，轮末交换两名未出场球员。不会重置比分、压力或门将记忆。",
              ),
          "panel-lead",
        ),
      );
      if (!preparing) {
        const pressure = s.match.pressure,
          block = el("div", null, "pressure-block");
        block.append(
          el("strong", tr`当前压力：${pressureLabel(pressure.level)}`),
          el(
            "p",
            pressure.sources.map((source) => tr(source)).join(" · ") ||
              tr("近期稳定，尚无情境压力"),
          ),
          el("p", tr(pressure.recovery)),
          el(
            "p",
            tr`当前扣减：推射 ${PRESSURE_PENALTIES.placed[pressure.level] * 100}，抽射 ${PRESSURE_PENALTIES.driven[pressure.level] * 100}，扑救 ${PRESSURE_PENALTIES.defend[pressure.level] * 100} 个百分点。冰血只免本人射门的这项扣减。`,
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
          el("strong", tr(p.name)),
          el(
            "span",
            used ? tr("{0} · Already played", tr(p.role)) : tr(p.role),
            "player-role",
          ),
          el("p", tr(p.desc)),
        );
        row.append(detail);
        const controls = el("div", null, "player-controls");
        if (preparing) {
          const select = el("select");
          select.setAttribute("aria-label", tr`第 ${i + 1} 名球员`);
          PLAYERS.forEach((p) => {
            const option = el("option", `${tr(p.name)} · ${tr(p.role)}`);
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
              tr("上移"),
              () => {
                [draft[i], draft[i - 1]] = [draft[i - 1], draft[i]];
                render();
              },
              i === 0,
            ),
            button(
              tr("下移"),
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
              selected.includes(i)
                ? tr("已选")
                : used
                  ? tr("已出场")
                  : tr("选择交换"),
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
          button(tr("恢复默认"), () => {
            draft.splice(0, 5, ...DEFAULT_LINEUP);
            render();
          }),
          button(tr("沿用上场"), () => {
            draft.splice(0, 5, ...c.progress.profile.lineup);
            render();
          }),
          button(tr("确认阵容"), () => {
            c.setLineup(draft);
            this.close();
            this.toast(tr("五人出场顺序已更新"));
          }),
        );
      else
        footer.append(
          el(
            "span",
            s.match.adjustmentsUsed
              ? tr("本场调整已用完")
              : s.quote?.canAdjust
                ? tr("调整剩余 1 次")
                : tr("需要轮末且至少两名未出场球员"),
          ),
          button(
            tr("确认交换"),
            async () => {
              if (await c.adjust(...selected)) {
                this.close();
                this.toast(tr("阵容已交换，当前报价已更新"));
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
              ? tr(QUICK_POLICY.desc)
              : tr("完整模式由你逐球选择射门与扑救方向。"),
            "panel-note",
          ),
        );
      if (!c.present.supports?.({ dir: "C", shot: "chip" }, "attack"))
        node.append(
          el(
            "p",
            tr(
              "吊射动作素材待补齐。艺术家暂时仅能使用没有特质加成的推射和抽射，也可在赛前替换为重炮。",
            ),
            "panel-note",
          ),
        );
    };
    render();
    this.open(preparing ? tr("五人阵容") : tr("本场阵容 · 压力 · 教练"), node);
  }
  career() {
    const c = this.controller(),
      p = c.progress.profile,
      node = el("div", null, "depth-panel");
    const stats = el("div", null, "career-stats");
    for (const [label, value] of [
      [tr("比赛"), p.stats.matches],
      [tr("胜场"), p.stats.wins],
      [tr("进球"), p.stats.goals],
      [tr("扑救"), p.stats.saves],
      [tr("冠军"), p.stats.cups],
    ]) {
      const item = el("div");
      item.append(el("strong", String(value)), el("span", label));
      stats.append(item);
    }
    node.append(
      stats,
      el(
        "p",
        tr`等级 ${1 + Math.floor(p.stats.xp / 100)} · ${p.stats.xp} 经验。成绩和外观不会修改成功率、报价或返还。`,
        "panel-lead",
      ),
    );
    node.append(el("h3", tr("称号与成就")));
    const achievements = el("div", null, "achievement-grid");
    ACHIEVEMENTS.forEach((a) => {
      const earned = p.achievements.includes(a.id),
        card = el("div", null, `achievement-card${earned ? " earned" : ""}`);
      card.append(
        el("strong", `${earned ? "✓ " : "○ "}${tr(a.name)}`),
        el("p", tr(a.desc)),
        button(
          p.title === a.id
            ? tr("已佩戴")
            : earned
              ? tr("佩戴称号")
              : tr("待解锁"),
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
    node.append(achievements, el("h3", tr("球衣徽章")));
    node.append(
      el(
        "p",
        tr("解锁出场名单和比分牌的球衣徽章；当前拍摄视频中的球员服装固定。"),
        "panel-note",
      ),
    );
    const kits = el("div", null, "kit-grid");
    KITS.forEach((k) => {
      const unlocked = k.unlocked(p),
        card = el("div", null, `kit-card${unlocked ? " earned" : ""}`);
      card.append(
        jersey({ number: 10 }, k.color),
        el("strong", tr(k.name)),
        el("p", tr(k.requirement)),
        button(
          p.kit === k.id ? tr("已装备") : unlocked ? tr("装备") : tr("待解锁"),
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
    node.append(kits, el("h3", tr("对手图鉴")));
    const opponents = el("div", null, "opponent-grid");
    Object.values(ARCHETYPES).forEach((a) => {
      const seen = p.opponents.includes(a.id),
        card = el("div", null, "opponent-card");
      card.append(
        el("strong", seen ? tr(a.name) : tr("未遇见")),
        el(
          "p",
          seen
            ? tr`${tr(a.desc)}。学习权重 ${a.learn}，记忆衰减 ${a.decay}。`
            : tr("完成一场与该原型的比赛后解锁。"),
        ),
      );
      opponents.append(card);
    });
    node.append(opponents, el("h3", tr("杯赛路线")));
    const route = el("ol", null, "cup-route");
    CUP_STAGES.forEach((stage, i) => {
      const status =
        p.cup?.stage > i
          ? tr("✓ 已晋级")
          : p.cup?.stage === i
            ? p.cup.status === "active"
              ? tr("当前关卡")
              : tr("本届已结束")
            : tr("等待挑战");
      const item = el("li");
      item.append(
        el("span", `${tr(stage.name)} · ${tr(stage.rival)}`),
        document.createTextNode(" "),
        el("span", status),
      );
      route.append(item);
    });
    node.append(
      route,
      el(
        "p",
        tr(
          "每场独立开局、投入与结算。只在胜利时晋级；平局、落败或主动收取均结束本届。没有连场金钱加成。",
        ),
        "panel-note",
      ),
    );
    if (p.records.length) {
      node.append(el("h3", tr("最近比赛")));
      const records = el("div", null, "recent-matches");
      [...p.records]
        .reverse()
        .slice(0, 8)
        .forEach((r) =>
          records.append(
            el(
              "p",
              tr`${{ win: tr("胜"), loss: tr("负"), draw: tr("平"), cashed: tr("主动收取") }[r.reason]} · ${r.goals}:${r.oppGoals} · 进球 ${r.goals}/${r.shots} · 扑出 ${r.saves} · ${r.mode === "quick" ? tr("自动防守") : tr("完整攻防")}`,
            ),
          ),
        );
      node.append(records);
    }
    node.append(
      el(
        "p",
        c.progress.storageAvailable
          ? tr("成长和阵容保存在当前浏览器。更换浏览器不会自动同步。")
          : tr("浏览器未允许持久保存，本次成长保存在内存中。"),
        "panel-note",
      ),
    );
    this.open(tr("生涯 · 成绩 · 杯赛"), node);
  }
}
