import { Application, Container, Graphics, Text } from "pixi.js";
import { gsap } from "gsap";
import { DIRECTIONS, TARGET_X, GOAL_Z } from "./choreography.js";
import { PLAYERS, CUP_STAGES } from "../math/depth.js";
import { ACHIEVEMENTS, KITS } from "../shell/progress.js";
const C = {
  panel: 0x121a24,
  line: 0x35414e,
  white: 0xf4f2eb,
  muted: 0x9daab7,
  lime: 0xffc35a,
  teal: 0x8cd5dc,
  red: 0xff967b,
  dark: 0x231a10,
};
const FONT = 'Barlow, "Microsoft YaHei", Arial, sans-serif',
  DISPLAY = '"Barlow Condensed", Bahnschrift, Impact, Arial, sans-serif';
const money = (n) => `$${Number(n ?? 0).toFixed(2)}`,
  labels = { L: "左路", C: "中路", R: "右路" };

export class ShootoutHud {
  constructor(canvas, overlay, scene, handlers) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.scene = scene;
    this.handlers = handlers;
    this.state = null;
    this.buttons = new Map();
    this.mode = "follow";
  }
  async init() {
    this.app = new Application();
    await this.app.init({
      canvas: this.canvas,
      width: 100,
      height: 100,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
      preference: "webgl",
      autoStart: false,
    });
    this.main = new Container();
    this.aimLayer = new Container();
    this.resultLayer = new Container();
    this.app.stage.addChild(this.aimLayer, this.main, this.resultLayer);
    this.aimMarkers = new Map();
    for (const dir of DIRECTIONS) {
      const group = new Container(),
        graphic = new Graphics();
      group.addChild(graphic);
      this.aimLayer.addChild(group);
      this.text(dir, 0, 32, 9, C.white, {
        parent: group,
        anchor: 0.5,
        weight: "700",
      });
      group.eventMode = "static";
      group.cursor = "pointer";
      group.on("pointertap", () => this.handlers.direction(dir));
      this.aimMarkers.set(dir, { group, graphic });
    }
    this.app.stop();
  }
  invalidate() {
    if (this.frame || document.hidden || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.destroyed) {
        this.app.renderer.render({ container: this.app.stage });
        if (import.meta.env.DEV)
          this.canvas.dataset.hudDraws = String(
            (Number(this.canvas.dataset.hudDraws) || 0) + 1,
          );
      }
    });
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.mobile = width < 850;
    this.side = this.mobile ? 0 : 282;
    this.sceneWidth = width - this.side;
    this.sceneHeight = height - (this.mobile ? 310 : 230);
    this.app.renderer.resize(width, height);
    this.scene.resize(this.sceneWidth, this.sceneHeight);
    this.render();
    return { width: this.sceneWidth, height: this.sceneHeight };
  }
  text(
    str,
    x,
    y,
    size = 12,
    fill = C.white,
    {
      font = FONT,
      weight = "500",
      align = "left",
      wrap = 0,
      parent = this.main,
      anchor = 0,
    } = {},
  ) {
    const t = new Text({
      text: str,
      style: {
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        fill,
        align,
        wordWrap: !!wrap,
        wordWrapWidth: wrap,
        lineHeight: size * 1.45,
      },
    });
    t.position.set(x, y);
    t.anchor.set(anchor, 0);
    parent.addChild(t);
    return t;
  }
  rect(
    x,
    y,
    w,
    h,
    fill,
    { radius = 8, alpha = 1, stroke = null, parent = this.main } = {},
  ) {
    const g = new Graphics()
      .roundRect(x, y, w, h, radius)
      .fill({ color: fill, alpha });
    if (stroke) g.stroke({ color: stroke, width: 1 });
    parent.addChild(g);
    return g;
  }
  line(x, y, x2, y2, fill = C.line) {
    const g = new Graphics()
      .moveTo(x, y)
      .lineTo(x2, y2)
      .stroke({ color: fill, width: 1 });
    this.main.addChild(g);
    return g;
  }
  button(
    id,
    accessibleLabel,
    x,
    y,
    w,
    h,
    {
      label = accessibleLabel,
      sub = "",
      active = false,
      disabled = false,
      primary = false,
      action,
      color = null,
      size = 13,
    } = {},
  ) {
    const group = new Container();
    group.position.set(x, y);
    this.main.addChild(group);
    this.rect(0, 0, w, h, primary ? C.lime : active ? 0x413629 : 0x1c2835, {
      stroke: active ? C.lime : primary ? null : C.line,
      parent: group,
    });
    this.text(
      label,
      w / 2,
      sub ? 11 : (h - size * 1.4) / 2,
      size,
      primary ? C.dark : (color ?? (active ? C.lime : C.white)),
      { weight: "700", anchor: 0.5, parent: group },
    );
    if (sub)
      this.text(sub, w / 2, h - 26, 10, primary ? 0x70542c : C.muted, {
        anchor: 0.5,
        parent: group,
      });
    group.alpha = disabled ? 0.38 : 1;
    group.eventMode = disabled ? "none" : "static";
    group.cursor = disabled ? "default" : "pointer";
    group.on("pointertap", () => action?.());
    const mirror = document.createElement("button");
    mirror.className = "a11y-control";
    mirror.id = `control-${id}`;
    mirror.type = "button";
    mirror.textContent = accessibleLabel;
    Object.assign(mirror.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    mirror.disabled = disabled;
    if (/^(camera|stake|shot|dir|mode|competition)-/.test(id))
      mirror.setAttribute("aria-pressed", String(active));
    mirror.onclick = () => action?.();
    mirror.onpointerenter = () => {
      if (!disabled)
        gsap.to(group, {
          alpha: 0.83,
          duration: 0.12,
          onUpdate: () => this.invalidate(),
        });
    };
    mirror.onpointerleave = () =>
      gsap.to(group, {
        alpha: disabled ? 0.38 : 1,
        duration: 0.12,
        onUpdate: () => this.invalidate(),
      });
    this.overlay.append(mirror);
    this.buttons.set(id, mirror);
    return group;
  }
  update(state) {
    this.state = state;
    this.teamColor = Number.parseInt(
      KITS.find((k) => k.id === state.profile.kit).color.slice(1),
      16,
    );
    this.render();
  }
  render() {
    if (!this.state || !this.width) return;
    const focus = document.activeElement?.id;
    for (const child of this.main.removeChildren()) {
      gsap.killTweensOf(child);
      for (const nested of child.children ?? []) gsap.killTweensOf(nested);
      child.destroy({ children: true });
    }
    this.overlay.replaceChildren();
    this.buttons.clear();
    const s = this.state,
      w = this.sceneWidth,
      h = this.sceneHeight;
    this.rect(0, h, w, this.height - h, 0x121a24, { radius: 0 });
    this.line(0, h, w, h);
    if (s.screen !== "bet") {
      this.scoreboard(w);
      this.cameraButtons(w);
    }
    if (s.screen === "bet") this.betScreen(w, h);
    else if (s.screen === "settled") this.settledScreen(w, h);
    else this.playControls(w, h);
    if (!this.mobile) this.sidebar(w, this.height);
    this.updateAim();
    this.invalidate();
    if (focus?.startsWith("control-"))
      document.getElementById(focus)?.focus({ preventScroll: true });
  }
  scoreboard(w) {
    const s = this.state,
      m = s.match,
      round = m?.suddenDeath
        ? `骤死 ${m.sdSet} / 3`
        : `第 ${m?.round ?? 1} / 5 轮`,
      bw = this.mobile ? 210 : 285,
      x = (w - bw) / 2;
    this.rect(x, 18, bw, 79, 0x101923, { alpha: 0.86, stroke: 0x5a6470 });
    const title = ACHIEVEMENTS.find((a) => a.id === s.profile.title)?.name;
    this.text(title ?? "TU EQUIPO", x + 18, 30, 9, this.teamColor);
    this.text("RIVAL", x + bw - 18, 30, 9, C.muted, { anchor: 1 });
    this.text(String(m?.playerGoals ?? 0), x + 33, 44, 28, C.lime, {
      font: DISPLAY,
      weight: "800",
      anchor: 0.5,
    });
    this.text(String(m?.oppGoals ?? 0), x + bw - 33, 44, 28, C.white, {
      font: DISPLAY,
      weight: "800",
      anchor: 0.5,
    });
    this.text(round, x + bw / 2, 37, 10, C.white, { anchor: 0.5 });
    this.text("—", x + bw / 2, 54, 13, C.muted, { anchor: 0.5 });
    const cupStage = CUP_STAGES.find((stage) => stage.id === s.match?.cupStage);
    if (cupStage)
      this.text(cupStage.name, x + bw / 2, 73, 9, C.teal, { anchor: 0.5 });
    const dots = (kind, start) => {
      const events = s.events.filter((e) => e.phase === kind);
      for (let i = 0; i < Math.max(5, events.length); i++) {
        const e = events[i],
          goal = e && (kind === "attack" ? e.success : !e.success);
        this.main.addChild(
          new Graphics()
            .circle(start + i * 10, 86, 2.4)
            .fill(e ? (goal ? C.lime : 0xe08f83) : 0x4a5d57),
        );
      }
    };
    dots("attack", x + 13);
    dots("defend", x + bw - 58);
    if (!this.mobile) {
      this.rect(20, 20, 136, 26, 0x0b2027, { alpha: 0.76, radius: 4 });
      this.text("ESTADIO  ·  MÉXICO", 30, 25, 9, 0xc4dbcf, { weight: "600" });
      this.text("NOCHE DE PENALES", 22, 54, 9, 0xa6bdb1);
    } else {
      this.text("返还 MXN", 15, 110, 9, C.muted);
      this.text(
        money(s.settlement?.payout ?? m?.cashValue ?? s.stake * 0.96),
        15,
        125,
        24,
        C.lime,
        { font: DISPLAY, weight: "700" },
      );
    }
  }
  cameraButtons(w) {
    const names = this.scene.cameraModes ?? [
        ["follow", "跟随"],
        ["broadcast", "转播"],
        ["keeper", "门后"],
      ],
      y = this.mobile ? 173 : 22,
      sw = this.scene.cameraModes ? 76 : this.mobile ? 44 : 46;
    if (names.length === 1) {
      this.text("现场机位", w - 79, this.mobile ? 113 : 27, 10, C.muted, {
        weight: "600",
      });
      return;
    }
    names.forEach(([id, name], i) =>
      this.button(
        `camera-${id}`,
        `${name}镜头`,
        w - (sw + 4) * names.length - 16 + i * (sw + 4),
        y,
        sw,
        25,
        {
          label: name,
          active: id === this.mode,
          size: 10,
          disabled: this.state.busy,
          action: () => this.handlers.camera(id),
        },
      ),
    );
  }
  betScreen(w, h) {
    const s = this.state;
    const center = w * (this.mobile ? 0.5 : 0.25),
      first = Math.min(w * 0.095, 62),
      last = Math.min(w * 0.14, 100),
      titleY = h * (this.mobile ? 0.07 : 0.22);
    this.text("EL ÚLTIMO", center, titleY, first, C.white, {
      font: DISPLAY,
      weight: "800",
      anchor: 0.5,
    });
    this.text("GOL.", center, titleY + first * 1.04, last, C.lime, {
      font: DISPLAY,
      weight: "900",
      anchor: 0.5,
    });
    this.text(
      "全场屏息。选定球路，拿下关键一球。",
      center,
      titleY + first * 1.04 + last * 1.15,
      this.mobile ? 11 : 13,
      C.white,
      { anchor: 0.5 },
    );
    this.rect(center - 84, h - 59, 168, 28, 0x151d27, {
      alpha: 0.85,
      radius: 14,
      stroke: 0x88734d,
    });
    this.text("5 轮攻防  ·  每一球都算数", center, h - 52, 10, 0xd7c7aa, {
      anchor: 0.5,
    });
    const title = ACHIEVEMENTS.find((a) => a.id === s.profile.title)?.name;
    if (title)
      this.text(`已佩戴 · ${title}`, center, h - 83, 10, this.teamColor, {
        anchor: 0.5,
      });
    const x = this.mobile ? 18 : 27,
      y = h + 14,
      col = this.mobile ? (w - 40) / 2 : 125;
    ["full", "quick"].forEach((mode, i) =>
      this.button(
        `mode-${mode}`,
        mode === "full" ? "完整模式" : "快速模式",
        x + i * (col + 4),
        y,
        col,
        32,
        {
          label: mode === "full" ? "完整攻防" : "快速 · 自动防守",
          active: s.mode === mode,
          disabled: s.busy,
          size: 11,
          action: () => this.handlers.mode(mode),
        },
      ),
    );
    const cy = this.mobile ? y + 40 : y,
      cx = this.mobile ? x : x + 268;
    ["single", "cup"].forEach((competition, i) =>
      this.button(
        `competition-${competition}`,
        competition === "single" ? "单场比赛" : "三场杯赛",
        cx + i * (col + 4),
        cy,
        col,
        32,
        {
          label: competition === "single" ? "单场比赛" : "三场杯赛",
          active: s.competition === competition,
          disabled: s.busy,
          size: 11,
          action: () => this.handlers.competition(competition),
        },
      ),
    );
    const iy = this.mobile ? y + 89 : y + 49;
    this.text("模拟投入 · MXN", x, iy, 10, C.muted);
    const chipW = this.mobile ? (w - 48) / 4 : 65;
    [5, 10, 20, 50].forEach((value, i) =>
      this.button(
        `stake-${value}`,
        `模拟投入 ${value} MXN`,
        x + i * (chipW + 4),
        iy + 22,
        chipW,
        42,
        {
          label: `$${value}`,
          active: this.state.stake === value,
          disabled: this.state.busy,
          action: () => this.handlers.stake(value),
        },
      ),
    );
    const startX = this.mobile ? x + col + 4 : w - 257,
      startY = this.mobile ? iy + 77 : iy + 13,
      startW = this.mobile ? col : 230;
    this.button(
      "lineup",
      "安排五人阵容",
      this.mobile ? x : startX,
      this.mobile ? startY : y,
      this.mobile ? col : startW,
      this.mobile ? 56 : 32,
      {
        label: "安排五人阵容",
        sub: this.mobile
          ? s.lineup
              .map((id) => PLAYERS.find((p) => p.id === id).number)
              .join(" · ")
          : "",
        disabled: s.busy,
        action: this.handlers.lineup,
        size: 13,
      },
    );
    this.button("start", "进入球场", startX, startY, startW, 56, {
      label: s.busy ? "准备比赛…" : "迎战  →",
      sub:
        s.competition === "cup"
          ? CUP_STAGES[
              s.profile.cup?.status === "active" ? s.profile.cup.stage : 0
            ].name
          : s.mode === "quick"
            ? "自动防守 · 逐球实况"
            : "完整攻防 · 逐球实况",
      primary: true,
      disabled: this.state.busy,
      action: this.handlers.start,
      size: 17,
    });
    this.button(
      "lobby-intel",
      "查看赛前对手简报",
      x,
      this.height - 40,
      this.mobile ? col : 140,
      25,
      { label: "赛前对手简报", size: 10, action: this.handlers.intel },
    );
    this.button(
      "career",
      "查看成绩与球衣",
      this.mobile ? x + col + 4 : x + 148,
      this.height - 40,
      this.mobile ? col : 140,
      25,
      {
        label: `生涯 · ${s.profile.stats.wins} 胜`,
        size: 10,
        action: this.handlers.career,
      },
    );
  }
  playControls(w, h) {
    const s = this.state,
      q = s.quote,
      o = this.handlers.option();
    if (!q) return;
    const attack = q.phase === "attack",
      pad = this.mobile ? 16 : 24,
      y = h + 64;
    this.matchContext(w, h);
    this.text(
      s.busy
        ? s.activity === "loading"
          ? "正在准备本球视频…"
          : "比赛进行中"
        : attack
          ? `你的回合 · ${q.player.name}`
          : s.mode === "quick"
            ? "自动防守 · 公开概率策略"
            : "你的回合 · 扑救",
      pad,
      y,
      this.mobile ? 13 : 16,
      C.white,
      { weight: "700" },
    );
    if (!this.mobile)
      this.text(
        attack ? "选择球路与射法" : "方向以射手视角为准",
        pad,
        y + 29,
        10,
        C.muted,
      );
    if (attack) {
      const start = this.mobile ? w - 181 : 205,
        shotW = this.mobile ? 50 : 65;
      ["placed", "driven", "chip"].forEach((id, i) =>
        this.button(
          `shot-${id}`,
          id === "chip" && !s.playableShots.includes(id)
            ? "吊射视频待补齐"
            : `选择${{ placed: "推射", driven: "抽射", chip: "吊射" }[id]}`,
          start + i * (shotW + 4),
          y - 1,
          shotW,
          29,
          {
            label: { placed: "推射", driven: "抽射", chip: "吊射" }[id],
            size: 11,
            active: s.shot === id,
            disabled: s.busy || !s.playableShots.includes(id),
            action: () => this.handlers.shot(id),
          },
        ),
      );
    }
    const cardsY = y + (this.mobile ? 44 : 56),
      gap = 8,
      cardsWidth = this.mobile ? w - pad * 2 : w - pad * 2 - 196,
      cardW = (cardsWidth - gap * 2) / 3;
    for (const [i, dir] of DIRECTIONS.entries()) {
      const available = s.playableDirections?.includes(dir) ?? true;
      const option = q.options.find(
        (x) => x.dir === dir && (!attack || x.shot === s.shot),
      );
      const group = this.button(
        `dir-${dir}`,
        available
          ? `${labels[dir]}，${attack ? "进球" : "扑救"}概率 ${Math.round(option.p * 100)}%，成功返还 ${money(option.onSuccess)}，失败返还 ${money(option.onFailure)}`
          : `${labels[dir]}，比赛视频待补齐`,
        pad + i * (cardW + gap),
        cardsY,
        cardW,
        74,
        {
          label: labels[dir],
          active: s.direction === dir,
          disabled: s.busy || !available,
          action: () => this.handlers.direction(dir),
          size: 12,
        },
      );
      if (!available) {
        this.text("视频待补齐", cardW / 2, 47, 10, C.muted, {
          anchor: 0.5,
          parent: group,
        });
        continue;
      }
      this.text(
        `${Math.round(option.p * 100)}%`,
        cardW - 12,
        10,
        22,
        s.direction === dir ? C.lime : C.white,
        { font: DISPLAY, weight: "700", anchor: 1, parent: group },
      );
      group.children[1].anchor.set(0, 0);
      group.children[1].x = 12;
      group.children[1].y = 11;
      this.text(`成 ${money(option.onSuccess)}`, 12, 39, 10, C.teal, {
        parent: group,
      });
      this.text(
        `败 ${money(option.onFailure)}`,
        12,
        54,
        10,
        option.failureIsLoss ? C.red : C.muted,
        { parent: group },
      );
    }
    const actionY = this.mobile ? cardsY + 85 : cardsY,
      actionX = this.mobile ? pad : w - 193,
      actionW = this.mobile ? w - pad * 2 - 112 : 170;
    this.button(
      "submit",
      attack ? "确认射门" : "确认扑救",
      actionX,
      actionY,
      actionW,
      this.mobile ? 48 : 74,
      {
        label: s.busy ? "正在呈现…" : attack ? "确认射门  ↗" : "确认扑救  ↗",
        sub: this.mobile
          ? ""
          : `${labels[s.direction]} · ${Math.round((o?.p ?? 0) * 100)}%`,
        primary: true,
        disabled:
          s.busy || !(s.playableDirections?.includes(s.direction) ?? true),
        action: this.handlers.submit,
        size: this.mobile ? 15 : 16,
      },
    );
    if (this.mobile)
      this.button("intel", "查看对手情报", w - pad - 104, actionY, 104, 48, {
        label: "对手情报",
        sub: `${s.info?.memory.samples ?? 0} 次记录`,
        action: this.handlers.intel,
        size: 11,
      });
    const hint =
      q.keyBall?.text ??
      (attack ? q.keeperHint : "观察射手的方向倾向，选择你的扑救位置");
    if (!this.mobile)
      this.text(
        `${q.keyBall ? "◆" : "•"}  ${hint}`,
        pad,
        h + 211,
        10,
        q.keyBall ? C.lime : C.muted,
        { wrap: w - 40 },
      );
    else {
      const statusY = actionY + 55;
      if (q.canCashOut)
        this.button("cash", "收取当前返还", pad, statusY, w - pad * 2, 26, {
          label: `收取 ${money(q.cashValue)}  ·  或继续下一轮`,
          size: 10,
          disabled: s.busy,
          action: this.handlers.cash,
        });
      else
        this.text(
          q.keyBall?.text ?? "完成本轮攻防后可收取当前返还",
          pad,
          statusY,
          10,
          q.keyBall ? C.lime : C.muted,
          { wrap: w - pad * 2 },
        );
    }
  }
  matchContext(w, h) {
    const s = this.state,
      q = s.quote,
      p = this.mobile ? 16 : 24,
      dist = q.phase === "attack" ? q.keeperDist : s.info.shooterTendency;
    const kind = q.phase === "attack" ? "门将押向" : "射手威胁";
    this.text(
      `${kind}   ← ${Math.round(dist.L * 100)}%   ↑ ${Math.round(dist.C * 100)}%   → ${Math.round(dist.R * 100)}%`,
      p,
      h + 10,
      this.mobile ? 10 : 12,
      C.teal,
      { weight: "600" },
    );
    const remaining = s.info.remaining;
    const status = `压力 ${q.pressure.name} · 剩余 ${remaining.player}/${remaining.opp} · ${q.phase === "attack" ? q.player.role : "守门员"}`;
    this.text(status, p, h + 33, 10, q.pressure.level === 2 ? C.red : C.muted);
    this.button(
      "coach",
      q.canAdjust ? "使用教练调整" : "查看本场阵容和压力",
      this.mobile ? w - 88 : w - 157,
      h + 30,
      this.mobile ? 72 : 128,
      25,
      {
        label: q.canAdjust ? "教练调整" : "阵容·压力",
        size: 10,
        disabled: s.busy,
        action: this.handlers.lineup,
        active: q.canAdjust,
      },
    );
  }
  sidebar(x, totalHeight) {
    const s = this.state,
      p = x + 24,
      w = this.side - 48;
    this.rect(x, 0, this.side, totalHeight, C.panel, { radius: 0 });
    this.line(x, 0, x, totalHeight);
    this.text("MATCH CENTER", p, 24, 10, C.muted, { weight: "600" });
    this.text(
      s.screen === "bet"
        ? "THE LAST KICK"
        : s.screen === "settled"
          ? "比赛已结算"
          : "当前返还 · MXN",
      p,
      54,
      11,
      C.white,
      { weight: "600" },
    );
    this.text(
      money(s.settlement?.payout ?? s.match?.cashValue ?? s.stake * 0.96),
      p,
      79,
      51,
      C.lime,
      { font: DISPLAY, weight: "700" },
    );
    this.text(
      `模拟投入 ${money(s.stake)}   ·   ${((s.settlement?.payout ?? s.match?.cashValue ?? s.stake * 0.96) / s.stake).toFixed(2)}×`,
      p,
      151,
      10,
      C.muted,
    );
    this.line(p, 184, p + w, 184);
    if (s.screen === "bet") {
      this.text("为这一场安排阵容", p, 208, 17, C.white, { weight: "700" });
      s.lineup.forEach((id, i) => {
        const player = PLAYERS.find((v) => v.id === id),
          y = 252 + i * 49;
        this.text(`0${i + 1}`, p, y, 20, C.teal, {
          font: DISPLAY,
          weight: "700",
        });
        this.text(player.name, p + 40, y, 14, C.white, { weight: "700" });
        this.text(player.role, p + w, y + 2, 11, C.muted, { anchor: 1 });
      });
      this.button("sidebar-lineup", "编辑阵容顺序", p, 521, w, 37, {
        label: "编辑阵容顺序",
        action: this.handlers.lineup,
      });
      this.text(
        s.mode === "quick"
          ? "自动防守读取公开概率，轮末决定继续。"
          : "完整攻防 · 轮末可以收取返还。",
        p,
        579,
        11,
        C.muted,
        { wrap: w },
      );
      this.text(
        "特质改变概率与波动，称号和球衣是外观成长。",
        p,
        623,
        10,
        C.muted,
        { wrap: w },
      );
      return;
    }
    const option = this.handlers.option();
    if (option) {
      this.text(
        `${s.quote.phase === "attack" ? "进球" : "扑救"}成功`,
        p,
        207,
        10,
        C.muted,
      );
      this.text(money(option.onSuccess), p + w, 204, 18, C.teal, {
        font: DISPLAY,
        weight: "700",
        anchor: 1,
      });
      this.text(
        option.failureIsLoss ? "失败 · 比赛落败" : "本次失败",
        p,
        242,
        10,
        option.failureIsLoss ? C.red : C.muted,
      );
      this.text(money(option.onFailure), p + w, 239, 18, C.red, {
        font: DISPLAY,
        weight: "700",
        anchor: 1,
      });
      this.button("cash", "收取当前返还", p, 277, w, 43, {
        label: s.quote.canCashOut
          ? `收取 ${money(s.quote.cashValue)}`
          : "完成本轮后可收取",
        size: 12,
        disabled: s.busy || !s.quote.canCashOut,
        action: this.handlers.cash,
      });
    } else {
      this.text("FINAL WHISTLE", p, 210, 25, C.teal, {
        font: DISPLAY,
        weight: "700",
      });
      this.text("打开战报，回顾每次决策。", p, 254, 11, C.muted);
      this.button("report", "查看比赛战报", p, 279, w, 43, {
        action: this.handlers.report,
      });
    }
    this.line(p, 345, p + w, 345);
    this.text(
      s.quote?.phase === "defend" ? "对手射手倾向" : "门将情报",
      p,
      365,
      11,
      C.muted,
      { weight: "600" },
    );
    this.button("intel", "查看对手情报", p + w - 65, 360, 65, 24, {
      label: "详情",
      size: 10,
      action: this.handlers.intel,
    });
    this.text(
      s.quote?.phase === "defend" ? "对手射手" : (s.info?.archetypeName ?? ""),
      p,
      388,
      22,
      C.white,
      { weight: "700" },
    );
    const dist =
      s.quote?.phase === "defend"
        ? s.info?.shooterTendency
        : (s.quote?.keeperDist ?? s.info?.preMatchTendency);
    if (dist)
      DIRECTIONS.forEach((dir, i) => {
        const y = 438 + i * 40;
        this.text(labels[dir], p, y, 10, C.muted);
        this.rect(p + 37, y + 4, w - 82, 5, 0x344f43, { radius: 3 });
        this.rect(p + 37, y + 4, (w - 82) * dist[dir], 5, C.teal, {
          radius: 3,
        });
        this.text(
          `${Math.round(dist[dir] * 100)}%`,
          p + w,
          y - 2,
          14,
          C.white,
          { font: DISPLAY, anchor: 1, weight: "700" },
        );
      });
    this.text(
      `本场记录 · ${s.quote?.phase === "defend" ? "对手真实球路" : "我的射门"}`,
      p,
      573,
      10,
      C.muted,
    );
    this.text(
      (s.quote?.phase === "defend"
        ? s.info?.opponentHistory.map((e) => e.ballDir)
        : s.info?.memory.history
      )
        .map((d) => ({ L: "←", C: "↑", R: "→" })[d])
        .join("   ") || "首球使用赛前情报",
      p,
      596,
      14,
      C.lime,
      { wrap: w },
    );
    if (totalHeight > 715)
      this.text(s.info?.archetypeDesc ?? "", p, totalHeight - 59, 10, C.muted, {
        wrap: w,
      });
  }
  settledScreen(w, h) {
    const s = this.state,
      st = s.settlement,
      title = {
        win: "赢下比赛",
        loss: "比赛结束",
        draw: "平局收官",
        cashed: "已收取返还",
      }[st.reason],
      cardW = Math.min(w - 40, 380),
      x = (w - cardW) / 2,
      y = Math.max(115, h * 0.26);
    this.rect(x, y, cardW, 230, 0x101923, {
      alpha: 0.94,
      stroke: 0x8a7246,
      radius: 14,
    });
    this.text("FINAL WHISTLE", w / 2, y + 24, 11, C.muted, { anchor: 0.5 });
    this.text(title, w / 2, y + 48, 28, C.white, {
      weight: "700",
      anchor: 0.5,
    });
    this.text(
      money(st.payout),
      w / 2,
      y + 97,
      62,
      st.reason === "loss" ? C.white : C.lime,
      { font: DISPLAY, weight: "800", anchor: 0.5 },
    );
    this.text("最终返还 · MXN · 包含本金", w / 2, y + 185, 10, C.muted, {
      anchor: 0.5,
    });
    const attacks = s.events.filter((e) => e.phase === "attack"),
      saved = s.events.filter((e) => e.phase === "defend" && e.success);
    const by = h + 18;
    this.text(
      `进球 ${attacks.filter((e) => e.success).length}/${attacks.length}   ·   扑出 ${saved.length}   ·   生涯 ${s.profile.stats.wins} 胜`,
      w / 2,
      by,
      12,
      C.teal,
      { anchor: 0.5 },
    );
    const reward = s.rewards?.unlocked
      .slice(0, 2)
      .map((id) => ACHIEVEMENTS.find((a) => a.id === id).name)
      .join(" · ");
    const rewardLabel = reward
      ? `解锁：${reward}${s.rewards.unlocked.length > 2 ? ` 等 ${s.rewards.unlocked.length} 项` : ""}`
      : "";
    const cup = st.config.cupStage
      ? s.profile.cup?.status === "completed"
        ? "杯赛冠军 · 三场独立结算已完成"
        : s.profile.cup?.status === "active"
          ? `晋级 ${CUP_STAGES[s.profile.cup.stage].name} · 下场重新投入`
          : "本届杯赛结束 · 可重新挑战"
      : "";
    this.text(
      cup || rewardLabel || "打开战报回顾阵容、压力与关键球。",
      w / 2,
      by + 25,
      10,
      C.lime,
      { anchor: 0.5, wrap: w - 40, align: "center" },
    );
    if (cup && reward)
      this.text(rewardLabel, w / 2, by + 42, 9, C.muted, { anchor: 0.5 });
    this.button(
      "restart",
      "再来一场",
      (w - Math.min(270, w - 44)) / 2,
      by + 64,
      Math.min(270, w - 44),
      54,
      {
        label:
          st.config.cupStage && s.profile.cup?.status === "active"
            ? "准备下一场  →"
            : "再来一场  →",
        primary: true,
        action: this.handlers.reset,
        size: 17,
      },
    );
    this.button(
      "report-bottom",
      "查看比赛战报",
      w / 2 - 140,
      by + 130,
      135,
      34,
      {
        label: "查看战报与结果验证",
        size: 11,
        action: this.handlers.report,
      },
    );
    this.button(
      "career-settled",
      "查看成绩与球衣",
      w / 2 + 5,
      by + 130,
      135,
      34,
      { label: "成绩与球衣", size: 11, action: this.handlers.career },
    );
  }
  updateAim() {
    if (!this.state || !this.width) return;
    const s = this.state;
    this.aimLayer.visible = s.screen === "play" && !s.busy;
    if (!this.aimLayer.visible) return;
    for (const dir of DIRECTIONS) {
      const p = this.scene.project(TARGET_X[dir], 1.2, GOAL_Z),
        { group, graphic: g } = this.aimMarkers.get(dir);
      group.visible =
        (s.playableDirections?.includes(dir) ?? true) &&
        p.z >= 0 &&
        p.x >= 0 &&
        p.x <= this.sceneWidth &&
        p.y >= 108 &&
        p.y <= this.sceneHeight - 20;
      if (!group.visible) continue;
      group.position.set(p.x, p.y);
      const active = dir === s.direction,
        size = this.mobile ? 22 : 28;
      g.clear()
        .circle(0, 0, size)
        .fill({ color: 0x153b32, alpha: active ? 0.65 : 0.2 })
        .stroke({
          color: active ? C.lime : 0xbdd9cb,
          alpha: active ? 1 : 0.5,
          width: active ? 2 : 1,
        });
      if (active)
        g.moveTo(-10, 0)
          .lineTo(10, 0)
          .moveTo(0, -10)
          .lineTo(0, 10)
          .stroke({ color: C.lime, width: 1 });
      group.children[1].y = size + 5;
    }
  }
  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.app.destroy(true, { children: true });
  }
}
