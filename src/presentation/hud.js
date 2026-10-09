import { Application, Container, Graphics, Text } from "pixi.js";
import { gsap } from "gsap";
import { DIRECTIONS, TARGET_X, GOAL_Z } from "./choreography.js";
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
    this.app.ticker.maxFPS = 45;
    this.app.ticker.add(() => this.updateAim());
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.mobile = width < 850;
    this.side = this.mobile ? 0 : 282;
    this.sceneWidth = width - this.side;
    this.sceneHeight = height - (this.mobile ? 245 : 190);
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
    if (/^(camera|stake|shot|dir)-/.test(id))
      mirror.setAttribute("aria-pressed", String(active));
    mirror.onclick = () => action?.();
    mirror.onpointerenter = () => {
      if (!disabled) gsap.to(group, { alpha: 0.83, duration: 0.12 });
    };
    mirror.onpointerleave = () =>
      gsap.to(group, { alpha: disabled ? 0.38 : 1, duration: 0.12 });
    this.overlay.append(mirror);
    this.buttons.set(id, mirror);
    return group;
  }
  update(state) {
    this.state = state;
    this.render();
  }
  render() {
    if (!this.state || !this.width) return;
    const focus = document.activeElement?.id;
    for (const child of this.main.removeChildren())
      child.destroy({ children: true });
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
    this.text("TU EQUIPO", x + 18, 30, 9, C.muted);
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
      this.text("现场机位", w - 79, this.mobile ? 113 : 27, 10, C.muted, { weight: "600" });
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
    const x = this.mobile ? 18 : 27,
      y = h + 20;
    this.text("选择模拟投入", x, y, 12, C.white, { weight: "600" });
    this.text("MXN  ·  返还包含本金", x, y + 23, 10, C.muted);
    const chipW = this.mobile ? (w - 48) / 4 : 65;
    [5, 10, 20, 50].forEach((value, i) =>
      this.button(
        `stake-${value}`,
        `模拟投入 ${value} MXN`,
        x + i * (chipW + 4),
        y + 50,
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
    const startX = this.mobile ? x : w - 259,
      startY = this.mobile ? y + 114 : y + 28,
      startW = this.mobile ? w - 36 : 230;
    this.button("start", "进入球场", startX, startY, startW, 56, {
      label: this.state.busy ? "准备比赛…" : "迎战  →",
      sub: "THE STADIUM IS CALLING",
      primary: true,
      disabled: this.state.busy,
      action: this.handlers.start,
      size: 17,
    });
    if (!this.mobile)
      this.text(
        "模拟币体验，无真实资金交易",
        startX + startW / 2,
        y + 102,
        10,
        C.muted,
        { anchor: 0.5 },
      );
  }
  playControls(w, h) {
    const s = this.state,
      q = s.quote,
      o = this.handlers.option();
    if (!q) return;
    const attack = q.phase === "attack",
      pad = this.mobile ? 16 : 24,
      y = h + 15;
    this.text(
      s.busy ? "比赛进行中" : attack ? "你的回合 · 射门" : "你的回合 · 扑救",
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
      const start = this.mobile ? w - 152 : 178;
      ["placed", "driven"].forEach((id, i) =>
        this.button(
          `shot-${id}`,
          id === "placed" ? "选择推射" : "选择抽射",
          start + i * 69,
          y - 1,
          65,
          29,
          {
            label: id === "placed" ? "推射" : "抽射",
            size: 11,
            active: s.shot === id,
            disabled: s.busy,
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
      const option = q.options.find(
        (x) => x.dir === dir && (!attack || x.shot === s.shot),
      );
      const group = this.button(
        `dir-${dir}`,
        `${labels[dir]}，${attack ? "进球" : "扑救"}概率 ${Math.round(option.p * 100)}%，成功返还 ${money(option.onSuccess)}，失败返还 ${money(option.onFailure)}`,
        pad + i * (cardW + gap),
        cardsY,
        cardW,
        74,
        {
          label: labels[dir],
          active: s.direction === dir,
          disabled: s.busy,
          action: () => this.handlers.direction(dir),
          size: 12,
        },
      );
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
        disabled: s.busy,
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
        h + 158,
        10,
        q.keyBall ? C.lime : C.muted,
        { wrap: w - 40 },
      );
    else {
      const statusY = actionY + 61;
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
      this.text("一场真正的点球博弈", p, 208, 17, C.white, { weight: "700" });
      [
        ["01", "观察对手", "三类门将，各有自己的判断习惯。"],
        ["02", "改变球路", "推射与抽射，成功率和波动各不相同。"],
        ["03", "掌握节奏", "攻防交替，完成一轮后可选择收取返还。"],
      ].forEach(([n, title, desc], i) => {
        const y = 255 + i * 104;
        this.text(n, p, y, 26, C.teal, { font: DISPLAY, weight: "700" });
        this.text(title, p + 39, y + 3, 13, C.white, { weight: "700" });
        this.text(desc, p + 39, y + 32, 11, C.muted, { wrap: w - 42 });
      });
      this.rect(p, totalHeight - 89, w, 54, 0x24272c, { stroke: 0x6a5638 });
      this.text(
        "每一个方向，都有代价。",
        p + 14,
        totalHeight - 75,
        12,
        C.lime,
        { weight: "600" },
      );
      this.text(
        "查看每次选择的成功与失败返还",
        p + 14,
        totalHeight - 54,
        9,
        C.muted,
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
      `门将本场记录  ${s.info?.memory.samples ?? 0} 次`,
      p,
      573,
      10,
      C.muted,
    );
    this.text(
      s.info?.memory.history
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
    const by = h + 36;
    this.button(
      "restart",
      "再来一场",
      (w - Math.min(270, w - 44)) / 2,
      by,
      Math.min(270, w - 44),
      54,
      {
        label: "再来一场  →",
        primary: true,
        action: this.handlers.reset,
        size: 17,
      },
    );
    this.button("report-bottom", "查看比赛战报", w / 2 - 95, by + 68, 190, 34, {
      label: "查看战报与结果验证",
      size: 11,
      action: this.handlers.report,
    });
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
  async showResult(resolution) {
    for (const child of this.resultLayer.removeChildren()) child.destroy();
    const attack = resolution.phase === "attack",
      title = attack
        ? resolution.success
          ? "¡GOL!"
          : "ATAJADA"
        : resolution.success
          ? "¡ATAJADA!"
          : "GOL DEL RIVAL",
      desc = attack
        ? resolution.success
          ? "漂亮进球"
          : "门将扑出了射门"
        : resolution.success
          ? "成功扑救"
          : "对手进球";
    const group = new Container();
    this.resultLayer.addChild(group);
    group.position.set(this.sceneWidth / 2, this.sceneHeight * 0.35);
    this.text(
      title,
      0,
      0,
      this.mobile ? 47 : 76,
      resolution.success ? C.lime : C.white,
      { parent: group, font: DISPLAY, weight: "900", anchor: 0.5 },
    );
    this.text(
      `${desc}  ·  返还 ${money(resolution.cashAfter)}`,
      0,
      this.mobile ? 66 : 99,
      12,
      C.white,
      { parent: group, anchor: 0.5 },
    );
    group.alpha = 0;
    group.scale.set(0.82);
    gsap.to(group, { alpha: 1, duration: 0.15 });
    gsap.to(group.scale, { x: 1, y: 1, duration: 0.4, ease: "back.out(1.5)" });
    await new Promise((resolve) =>
      gsap.to(group, {
        alpha: 0,
        delay: 0.95,
        duration: 0.22,
        onComplete: resolve,
      }),
    );
    group.destroy({ children: true });
  }
  destroy() {
    this.app.destroy(true, { children: true });
  }
}
