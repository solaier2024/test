import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { gsap } from "gsap";
import {
  LINES,
  MULTIPLIERS,
  REELS,
  type Grid,
  type Mode,
  type SymbolId,
} from "../core/config.ts";
import type { Result } from "../core/provider.ts";
import { t, type Locale } from "../i18n.ts";
import { assetUrl } from "./assets.ts";

const WIDTH = 820,
  HEIGHT = 444,
  CELL_W = 170,
  CELL_H = 132;
const X = [24, 210, 396] as const,
  TOP = 24,
  AXIS_X = 628;
type Column = {
  group: Container;
  sprites: Sprite[];
  labels: Text[];
  progress: number;
  stopped: boolean;
  bounce: number;
  target: readonly SymbolId[];
};
export class ReelView {
  private app = new Application();
  private atlas: Texture | null = null;
  private textures: Texture[] = [];
  private columns: Column[] = [];
  private axisTexts: Text[] = [];
  private axisDecorations: Sprite[] = [];
  private lines = new Graphics();
  private timeline: gsap.core.Timeline | null = null;
  private completion: (() => void) | null = null;
  private axis = {
    progress: 0,
    stopped: true,
    multiplier: 1,
    mode: "standard" as Mode,
  };
  private locale: Locale = "es-MX";
  private result: Result | null = null;
  private skipping = false;
  private frames = 0;
  private lost = false;
  constructor(
    private host: HTMLElement,
    private cue: (kind: "stop" | "axis") => void,
    private onContext: (lost: boolean) => void,
  ) {}

  async init() {
    await this.app.init({
      width: WIDTH,
      height: HEIGHT,
      backgroundAlpha: 0,
      autoStart: false,
      sharedTicker: false,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 1.5),
      preference: "webgl",
    });
    this.app.stop();
    this.host.replaceChildren(this.app.canvas);
    this.app.canvas.setAttribute("role", "img");
    this.app.canvas.style.width = "100%";
    this.app.canvas.style.height = "100%";
    this.app.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.app.canvas.addEventListener(
      "webglcontextrestored",
      this.contextRestored,
    );
    this.atlas = await Assets.load<Texture>(assetUrl("food-atlas.webp"));
    for (let i = 0; i < 8; i++)
      this.textures.push(
        new Texture({
          source: this.atlas.source,
          frame: new Rectangle(
            (i % 4) * 256,
            Math.floor(i / 4) * 256,
            256,
            256,
          ),
        }),
      );
    const background = new Graphics();
    this.app.stage.addChild(background);
    for (const x of X) {
      for (let row = 0; row < 3; row++) {
        background
          .roundRect(x, TOP + row * CELL_H, CELL_W, CELL_H - 5, 10)
          .fill({ color: row === 1 ? 0x182725 : 0x15211f, alpha: 0.96 })
          .stroke({ color: 0x9b794a, width: 1, alpha: 0.24 });
      }
      const group = new Container();
      group.position.set(x, TOP);
      const mask = new Graphics()
        .rect(x, TOP, CELL_W, CELL_H * 3)
        .fill(0xffffff);
      this.app.stage.addChild(mask, group);
      group.mask = mask;
      const sprites: Sprite[] = [],
        labels: Text[] = [];
      for (let row = 0; row < 5; row++) {
        const sprite = new Sprite(this.textures[row % 8]!);
        sprite.anchor.set(0.5);
        sprite.width = 138;
        sprite.height = 138;
        const label = new Text({
          text: "",
          style: {
            fontFamily: "Barlow, sans-serif",
            fontSize: 13,
            fontWeight: "700",
            fill: "#f7d287",
            letterSpacing: 2,
          },
        });
        label.anchor.set(0.5);
        sprites.push(sprite);
        labels.push(label);
        group.addChild(sprite, label);
      }
      this.columns.push({
        group,
        sprites,
        labels,
        progress: 0,
        bounce: 0,
        stopped: true,
        target: [0, 6, 2],
      });
    }
    background
      .roundRect(AXIS_X, TOP, 166, CELL_H * 3 - 5, 12)
      .fill({ color: 0x14211f, alpha: 0.98 });
    background
      .roundRect(AXIS_X, TOP + CELL_H + 2, 166, CELL_H - 9, 9)
      .fill({ color: 0x5e3d1c, alpha: 0.66 })
      .stroke({ color: 0xf4c773, width: 2, alpha: 0.8 });
    const axisGroup = new Container();
    const axisMask = new Graphics()
      .rect(AXIS_X, TOP, 166, CELL_H * 3 - 5)
      .fill(0xffffff);
    this.app.stage.addChild(axisMask, axisGroup);
    axisGroup.mask = axisMask;
    for (let i = 0; i < 5; i++) {
      const text = new Text({
        text: "×1",
        style: {
          fontFamily: "Barlow Condensed, sans-serif",
          fontSize: 74,
          fontWeight: "700",
          fill: "#f1ca85",
        },
      });
      text.anchor.set(0.5);
      text.x = AXIS_X + 83;
      axisGroup.addChild(text);
      this.axisTexts.push(text);
    }
    // Inactive cells are decorative peppers, not fabricated neighbouring
    // jackpot stops. Only the center displays the accepted multiplier.
    for (const row of [0, 2]) {
      const pepper = new Sprite(this.textures[1]!);
      pepper.anchor.set(0.5);
      pepper.position.set(AXIS_X + 83, TOP + row * CELL_H + CELL_H / 2);
      pepper.width = 92;
      pepper.height = 92;
      pepper.alpha = 0.44;
      axisGroup.addChild(pepper);
      this.axisDecorations.push(pepper);
    }
    this.app.stage.addChild(this.lines);
    this.setGrid([
      [6, 1, 4],
      [3, 6, 7],
      [0, 2, 5],
    ]);
  }
  setLocale(locale: Locale) {
    this.locale = locale;
    this.app.canvas.setAttribute("aria-label", t(locale, "board"));
    this.draw();
  }
  setGrid(grid: Grid, multiplier = 1, mode: Mode = "standard") {
    this.columns.forEach((column, c) => {
      column.target = grid.map((row) => row[c]!);
      column.stopped = true;
      column.bounce = 0;
    });
    this.axis = { ...this.axis, stopped: true, multiplier, mode };
    this.draw();
  }
  showIdle(mode: Mode) {
    this.result = null;
    this.lines.clear();
    this.setGrid(
      [
        [6, 1, 4],
        [3, 6, 7],
        [0, 2, 5],
      ],
      mode === "extra" ? 2 : 1,
      mode,
    );
  }
  private draw() {
    if (this.lost) return;
    for (const [c, column] of this.columns.entries()) {
      const offset = column.stopped ? column.bounce : column.progress % CELL_H;
      for (let i = 0; i < 5; i++) {
        const index = column.stopped
          ? column.target[(i - 1 + 3) % 3]!
          : REELS[c]![(i + Math.floor(column.progress / CELL_H)) % 64]!;
        const sprite = column.sprites[i]!,
          label = column.labels[i]!;
        sprite.texture = this.textures[index]!;
        sprite.position.set(CELL_W / 2, (i - 1) * CELL_H + CELL_H / 2 + offset);
        label.text =
          index === 7 && column.stopped ? t(this.locale, "allWild") : "";
        label.position.set(sprite.x, sprite.y + 48);
      }
    }
    const values =
      this.axis.mode === "extra" ? MULTIPLIERS.slice(1) : MULTIPLIERS;
    const centerIndex = values.indexOf(
      this.axis.multiplier as (typeof MULTIPLIERS)[number],
    );
    this.axisTexts.forEach((text, i) => {
      text.visible = !this.axis.stopped || i === 2;
      const index = this.axis.stopped
        ? (centerIndex + i - 2 + values.length * 2) % values.length
        : (Math.floor(this.axis.progress / CELL_H) + i) % values.length;
      text.text = `×${values[index]}`;
      text.y =
        TOP +
        (i - 1) * CELL_H +
        CELL_H / 2 +
        (this.axis.stopped ? 0 : this.axis.progress % CELL_H);
      text.alpha = i === 2 && this.axis.stopped ? 1 : 0.22;
    });
    for (const pepper of this.axisDecorations)
      pepper.visible = this.axis.stopped;
    this.app.render();
    this.frames++;
  }
  private showLines(result: Result) {
    this.lines.clear();
    const colors = [0xf7c96f, 0x85d4b1, 0x9cc9ef, 0xf19f91, 0xe3b6f8];
    for (const win of result.lineWins) {
      const rows = LINES[win.line - 1]!;
      for (let c = 0; c < 3; c++) {
        const x = X[c]! + CELL_W / 2,
          y = TOP + rows[c]! * CELL_H + CELL_H / 2;
        if (!c) this.lines.moveTo(x, y);
        else this.lines.lineTo(x, y);
      }
      this.lines.stroke({
        color: colors[win.line - 1]!,
        alpha: 0.78,
        width: 4,
      });
    }
  }
  present(result: Result, turbo: boolean): Promise<void> {
    this.skip();
    this.result = result;
    this.skipping = false;
    this.frames = 0;
    this.lines.clear();
    this.lines.alpha = 0;
    this.axis.mode = result.mode;
    this.axis.stopped = false;
    this.axis.progress = 0;
    for (const [c, column] of this.columns.entries()) {
      column.target = result.grid.map((row) => row[c]!);
      column.progress = 0;
      column.bounce = 0;
      column.stopped = false;
    }
    const speed =
      turbo || matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0.43
        : 1;
    gsap.config({ autoSleep: 15 });
    return new Promise((resolve) => {
      this.completion = resolve;
      const timeline = gsap.timeline({
        onUpdate: () => this.draw(),
        onComplete: () => this.finish(),
      });
      this.timeline = timeline;
      this.columns.forEach((column, c) => {
        const end = (1 + c * 0.2) * speed;
        timeline.to(
          column,
          {
            progress: 2400 + c * 600,
            duration: end,
            ease: "none",
            onComplete: () => {
              column.stopped = true;
              column.bounce = -12;
              if (!this.skipping) this.cue("stop");
            },
          },
          0.04 * speed,
        );
        timeline.to(
          column,
          { bounce: 0, duration: 0.15 * speed, ease: "back.out(1.6)" },
          end + 0.04 * speed,
        );
      });
      timeline.to(
        this.axis,
        {
          progress: 3800,
          duration: 1.85 * speed,
          ease: "power1.out",
          onComplete: () => {
            this.axis.stopped = true;
            this.axis.multiplier = result.multiplier;
            if (!this.skipping) this.cue("axis");
          },
        },
        0.04 * speed,
      );
      timeline.call(() => this.showLines(result), [], 1.99 * speed);
      timeline.to(
        this.lines,
        { alpha: 1, duration: 0.23 * speed },
        1.99 * speed,
      );
      if (document.hidden) timeline.pause();
    });
  }
  private finish() {
    if (this.result) {
      this.setGrid(this.result.grid, this.result.multiplier, this.result.mode);
      this.showLines(this.result);
      this.lines.alpha = 1;
      this.draw();
    }
    this.host.dataset["frameCount"] = String(this.frames);
    this.timeline = null;
    const resolve = this.completion;
    this.completion = null;
    resolve?.();
  }
  skip() {
    if (!this.timeline) return;
    this.skipping = true;
    const timeline = this.timeline;
    timeline.progress(1);
    timeline.kill();
    if (this.completion) this.finish();
  }
  setHidden(hidden: boolean) {
    if (hidden) this.timeline?.pause();
    else this.timeline?.resume();
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.timeline?.pause();
    this.onContext(true);
  };
  private contextRestored = () => {
    this.lost = false;
    this.onContext(false);
    if (this.result)
      this.setGrid(this.result.grid, this.result.multiplier, this.result.mode);
    this.skip();
    this.draw();
  };
  dispose() {
    this.skip();
    this.app.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.app.canvas.removeEventListener(
      "webglcontextrestored",
      this.contextRestored,
    );
    this.app.destroy(true, {
      children: true,
      texture: true,
      textureSource: false,
    });
    this.textures = [];
    this.columns = [];
  }
}
