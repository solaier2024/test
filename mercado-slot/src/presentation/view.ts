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
} from "../core/config.ts";
import { gridAt } from "../core/rng.ts";
import type { Result } from "../core/provider.ts";
import type { RoundEvent } from "../shell/round-controller.ts";
import { t, type Locale } from "../i18n.ts";
import { assetUrl } from "./assets.ts";
import {
  reelFrame,
  reelSequence,
  spinTiming,
  winTier,
  type Quality,
} from "./motion.ts";

const W = 1000,
  H = 528,
  CW = 218,
  CH = 160,
  TOP = 24;
const SYMBOL_SIZE = 182;
const X = [24, 256, 488] as const;
const AX = 768,
  AC = AX + 100;
const IDLE = [12, 24, 38] as const;
const COLORS = [0xf6b32e, 0x39ab87, 0x549cce, 0xdf7452, 0xa074c2] as const;
type Column = {
  group: Container;
  sprites: Sprite[];
  ghosts: Sprite[];
  labels: Text[];
  position: number;
  sequence: readonly number[] | null;
  moving: boolean;
  bounce: number;
  blur: number;
  pulse: number;
};
export type Cue =
  "spin" | "stop" | "axis" | "line" | "win" | "big" | "grand" | "return";
export class ReelView {
  private app = new Application();
  private initialized = false;
  private textures: Texture[] = [];
  private atlas: Texture | null = null;
  private columns: Column[] = [];
  private highlight = new Graphics();
  private wire = new Graphics();
  private bottleGroup = new Container();
  private bottle!: Sprite;
  private multiplierText!: Text;
  private multiplierCaption!: Text;
  private particles: Sprite[] = [];
  private particleTexture: Texture | null = null;
  private fx = {
    burst: 1,
    glow: 0,
    bottleScale: 1,
    bottleRotation: 0,
    axisProgress: 0,
    axisRevealed: true,
  };
  private award = { progress: 0 };
  private timeline: gsap.core.Timeline | null = null;
  private resolve: (() => void) | null = null;
  private locale: Locale = "es-MX";
  private result: Result | null = null;
  private multiplier = 1;
  private mode: Mode = "standard";
  private skipping = false;
  private lost = false;
  private selectedLine = 0;
  private quality: Quality = "lite";
  private qualitySequence = 0;
  private currentAtlasPath = "food-atlas-v3.webp";
  private reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private frames = 0;
  private startTime = 0;
  private pausedAt = 0;
  private pausedTime = 0;
  private emitting: ((event: RoundEvent) => void) | null = null;
  constructor(
    private host: HTMLElement,
    private cue: (cue: Cue) => void,
    private onContext: (lost: boolean) => void,
    private progress: (value: number) => void = () => {},
  ) {}

  async init() {
    this.progress(0.08);
    await this.app.init({
      width: W,
      height: H,
      backgroundAlpha: 0,
      autoStart: false,
      sharedTicker: false,
      antialias: true,
      resolution: Math.min(devicePixelRatio, 1.5),
      preference: "webgl",
    });
    this.app.stop();
    this.progress(0.28);
    this.host.replaceChildren(this.app.canvas);
    this.app.canvas.style.width = "100%";
    this.app.canvas.style.height = "100%";
    this.app.canvas.setAttribute("role", "img");
    this.app.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.app.canvas.addEventListener(
      "webglcontextrestored",
      this.contextRestored,
    );
    this.atlas = await Assets.load<Texture>(assetUrl("food-atlas-v3.webp"));
    this.progress(0.58);
    this.textures = this.framesFrom(this.atlas);
    const bottle = await Assets.load<Texture>(assetUrl("salsa-bottle-v3.webp"));
    this.progress(0.78);
    this.buildBoard();
    this.bottle = new Sprite(bottle);
    this.bottle.anchor.set(0.5);
    this.bottle.height = 446;
    this.bottle.scale.x = this.bottle.scale.y;
    this.bottleGroup.position.set(AC, H / 2);
    this.bottleGroup.addChild(this.bottle);
    this.multiplierText = new Text({
      text: "×1",
      style: {
        fontFamily: "Barlow Condensed, sans-serif",
        fontSize: 68,
        fontWeight: "700",
        fill: "#ffdb8c",
        stroke: { color: "#321404", width: 2 },
        dropShadow: { color: "#000000", alpha: 0.5, blur: 3, distance: 3 },
      },
    });
    this.multiplierText.anchor.set(0.5);
    this.multiplierText.y = 33;
    this.multiplierCaption = new Text({
      text: "",
      style: {
        fontFamily: "Barlow, sans-serif",
        fontSize: 12,
        fontWeight: "600",
        fill: "#ffdda0",
        letterSpacing: 2,
      },
    });
    this.multiplierCaption.anchor.set(0.5);
    this.multiplierCaption.y = 81;
    this.bottleGroup.addChild(this.multiplierText, this.multiplierCaption);
    this.app.stage.addChild(this.bottleGroup);
    this.buildParticles();
    this.app.stage.addChild(this.wire);
    this.initialized = true;
    this.host.dataset["quality"] = this.quality;
    this.setLocale(this.locale);
    this.showIdle("standard");
    this.progress(1);
  }
  private framesFrom(atlas: Texture) {
    const side = atlas.width / 4;
    return Array.from(
      { length: 8 },
      (_, i) =>
        new Texture({
          source: atlas.source,
          frame: new Rectangle(
            (i % 4) * side,
            Math.floor(i / 4) * side,
            side,
            side,
          ),
        }),
    );
  }
  private buildBoard() {
    const back = new Graphics();
    this.app.stage.addChild(back);
    back
      .roundRect(8, 11, 718, 506, 18)
      .fill(0x111c17)
      .stroke({ color: 0xa5824a, width: 4 });
    back
      .roundRect(15, 18, 704, 490, 14)
      .fill(0x0d1814)
      .stroke({ color: 0xd8bb7b, width: 2, alpha: 0.5 });
    for (const x of X) {
      back
        .roundRect(x, TOP, CW, CH * 3, 10)
        .fill(0x1b2b23)
        .stroke({ color: 0x957f54, width: 2, alpha: 0.55 });
      // Layered vertical highlights make one glass reel, not nine UI cards.
      back
        .rect(x + 3, TOP + 2, 13, CH * 3 - 4)
        .fill({ color: 0xf7edd2, alpha: 0.045 });
      back
        .rect(x + CW - 11, TOP + 2, 8, CH * 3 - 4)
        .fill({ color: 0x07120d, alpha: 0.25 });
      for (let r = 1; r < 3; r++)
        back
          .moveTo(x + 12, TOP + r * CH)
          .lineTo(x + CW - 12, TOP + r * CH)
          .stroke({ color: 0xbaa279, alpha: 0.11, width: 1 });
      // Static broad reflection and shadow bands give the smoked glass depth.
      for (let j = 0; j < 18; j++)
        back.rect(x + 17, TOP + 28 + j * 20, CW - 30, 20).fill({
          color: 0xf9d99a,
          alpha: Math.sin((j / 17) * Math.PI) * 0.014,
        });
      const group = new Container();
      group.position.set(x, TOP);
      const mask = new Graphics()
        .roundRect(x, TOP, CW, CH * 3, 10)
        .fill(0xffffff);
      this.app.stage.addChild(mask, group);
      group.mask = mask;
      const sprites: Sprite[] = [],
        ghosts: Sprite[] = [],
        labels: Text[] = [];
      for (let i = 0; i < 5; i++) {
        const ghost = new Sprite(this.textures[0]!);
        ghost.anchor.set(0.5);
        ghost.width = SYMBOL_SIZE;
        ghost.height = SYMBOL_SIZE * 1.08;
        ghost.alpha = 0;
        const sprite = new Sprite(this.textures[0]!);
        sprite.anchor.set(0.5);
        sprite.width = SYMBOL_SIZE;
        sprite.height = SYMBOL_SIZE;
        const label = new Text({
          text: "",
          style: {
            fontFamily: "Barlow Condensed, sans-serif",
            fontSize: 17,
            fontWeight: "700",
            fill: "#f6d48e",
            letterSpacing: 2,
            stroke: { color: "#122019", width: 3 },
          },
        });
        label.anchor.set(0.5);
        ghosts.push(ghost);
        sprites.push(sprite);
        labels.push(label);
        group.addChild(ghost, sprite, label);
      }
      this.columns.push({
        group,
        sprites,
        ghosts,
        labels,
        position: IDLE[this.columns.length]!,
        sequence: null,
        moving: false,
        bounce: 0,
        blur: 0,
        pulse: 1,
      });
    }
    const shade = new Graphics();
    for (let i = 0; i < 12; i++) {
      shade
        .rect(19, TOP + i * 2, 695, 2)
        .fill({ color: 0x020b07, alpha: (12 - i) * 0.018 });
      shade
        .rect(19, TOP + CH * 3 - (i + 1) * 2, 695, 2)
        .fill({ color: 0x020b07, alpha: (12 - i) * 0.02 });
    }
    this.app.stage.addChild(shade, this.highlight);
    back
      .roundRect(750, 14, 231, 502, 28)
      .fill(0x2a130c)
      .stroke({ color: 0xe2ac53, width: 3 });
    back
      .roundRect(757, 21, 217, 488, 22)
      .fill(0x441911)
      .stroke({ color: 0x6d4824, width: 1 });
    back.ellipse(AC, 488, 65, 11).fill({ color: 0x000000, alpha: 0.45 });
    // Decorative screws and etched separations stay in the scene graph.
    for (const [x, y] of [
      [13, 10],
      [725, 10],
      [13, 518],
      [725, 518],
      [748, 11],
      [982, 11],
      [748, 519],
      [982, 519],
    ])
      back
        .circle(x!, y!, 4)
        .fill(0xe8c16d)
        .moveTo(x! - 2, y!)
        .lineTo(x! + 2, y!)
        .stroke({ color: 0x73451d, width: 1 });
  }
  private buildParticles() {
    const star = new Graphics()
      .poly([16, 0, 21, 11, 32, 16, 21, 21, 16, 32, 11, 21, 0, 16, 11, 11])
      .fill(0xffffff);
    this.particleTexture = this.app.renderer.generateTexture({
      target: star,
      resolution: 1,
    });
    star.destroy();
    for (let i = 0; i < 32; i++) {
      const sprite = new Sprite(this.particleTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.tint = i % 3 ? 0xffd36e : 0xfff2c4;
      this.app.stage.addChild(sprite);
      this.particles.push(sprite);
    }
  }
  setLocale(locale: Locale) {
    this.locale = locale;
    if (!this.initialized) return;
    this.app.canvas.setAttribute("aria-label", t(locale, "board"));
    this.multiplierCaption.text = t(locale, "multiplier").toUpperCase();
    this.draw();
  }
  restore(result: Result) {
    this.result = result;
    this.mode = result.mode;
    this.multiplier = result.multiplier;
    this.fx.axisRevealed = true;
    this.fx.axisProgress = 0;
    this.selectedLine = 0;
    this.columns.forEach((column, c) => {
      column.sequence = null;
      column.position = result.reelStops[c]!;
      column.moving = false;
      column.bounce = 0;
      column.blur = 0;
      column.pulse = 1;
    });
    this.showHighlights();
    this.draw();
  }
  showIdle(mode: Mode) {
    this.result = null;
    this.mode = mode;
    this.selectedLine = 0;
    this.multiplier = mode === "extra" ? 2 : 1;
    this.fx.axisRevealed = true;
    this.fx.glow = 0;
    this.fx.burst = 1;
    this.columns.forEach((column, c) => {
      column.sequence = null;
      column.position = IDLE[c]!;
      column.moving = false;
      column.bounce = 0;
      column.blur = 0;
      column.pulse = 1;
    });
    this.highlight.clear();
    this.wire.clear();
    this.draw();
  }
  inspectLine(line: number) {
    if (
      !this.result ||
      this.timeline ||
      !this.result.lineWins.some((w) => w.line === line)
    )
      return;
    this.selectedLine = this.selectedLine === line ? 0 : line;
    this.showHighlights();
    this.draw();
  }
  private showHighlights() {
    this.highlight.clear();
    this.wire.clear();
    if (!this.result) return;
    for (const win of this.result.lineWins) {
      if (this.selectedLine && win.line !== this.selectedLine) continue;
      const rows = LINES[win.line - 1]!;
      for (let c = 0; c < 3; c++) {
        const row = rows[c]!;
        this.highlight
          .roundRect(X[c]! + 5, TOP + row * CH + 6, CW - 10, CH - 12, 11)
          .fill({ color: COLORS[win.line - 1]!, alpha: 0.065 })
          .stroke({
            color: COLORS[win.line - 1]!,
            width: this.selectedLine ? 4 : 3,
            alpha: 0.88,
          });
        const x = X[c]! + CW / 2,
          y = TOP + row * CH + CH / 2;
        if (!c) this.wire.moveTo(x, y);
        else this.wire.lineTo(x, y);
      }
      this.wire.stroke({
        color: COLORS[win.line - 1]!,
        width: 3,
        alpha: this.selectedLine ? 0.7 : 0.24,
      });
    }
  }
  private draw() {
    if (!this.initialized || this.lost) return;
    for (const [c, column] of this.columns.entries()) {
      const frame = reelFrame(column.position, REELS[c]!.length);
      for (let i = 0; i < 5; i++) {
        const row = i - 1;
        const symbol = column.sequence
          ? column.sequence[Math.floor(column.position) + row + 1]!
          : REELS[c]![(frame.center + row - 1 + 128) % 64]!;
        const sprite = column.sprites[i]!,
          ghost = column.ghosts[i]!,
          label = column.labels[i]!;
        sprite.texture = this.textures[symbol]!;
        ghost.texture = sprite.texture;
        sprite.position.set(
          CW / 2,
          row * CH + CH / 2 - frame.fraction * CH + column.bounce,
        );
        sprite.scale.set((SYMBOL_SIZE / sprite.texture.width) * column.pulse);
        sprite.alpha =
          this.selectedLine &&
          this.result &&
          row >= 0 &&
          row < 3 &&
          LINES[this.selectedLine - 1]![c] !== row
            ? 0.35
            : 1;
        ghost.position.set(sprite.x, sprite.y + 17);
        ghost.alpha = column.blur * 0.14;
        ghost.scale.set(sprite.scale.x, sprite.scale.y * 1.15);
        label.text =
          !column.moving && symbol === 7 ? t(this.locale, "allWild") : "";
        label.position.set(sprite.x, sprite.y + 66);
      }
    }
    this.bottleGroup.scale.set(this.fx.bottleScale);
    this.bottleGroup.rotation = this.fx.bottleRotation;
    const values = this.mode === "extra" ? MULTIPLIERS.slice(1) : MULTIPLIERS;
    this.multiplierText.text = this.fx.axisRevealed
      ? `×${this.multiplier}`
      : `×${values[Math.floor(this.fx.axisProgress) % values.length]}`;
    this.multiplierText.alpha = this.fx.axisRevealed ? 1 : 0.55;
    this.bottle.tint = this.fx.glow > 0.3 ? 0xffddac : 0xffffff;
    for (const [i, particle] of this.particles.entries()) {
      const p = this.fx.burst;
      particle.visible = p < 1 && !this.reduced;
      if (!particle.visible) continue;
      const angle = (i * 2.399963229728653) % (Math.PI * 2);
      const velocity = 160 + (i % 5) * 43;
      particle.position.set(
        420 + Math.cos(angle) * velocity * p,
        255 + Math.sin(angle) * velocity * p + 160 * p * p,
      );
      particle.alpha = (1 - p) * 0.9;
      particle.rotation = i + p * 4;
      particle.scale.set((0.22 + (i % 3) * 0.1) * (1 - p * 0.5));
    }
    this.app.render();
    this.frames++;
  }
  present(
    result: Result,
    turbo: boolean,
    emit: (event: RoundEvent) => void = () => {},
    replay = false,
  ): Promise<void> {
    this.skip();
    this.result = result;
    this.selectedLine = 0;
    this.mode = result.mode;
    this.multiplier = result.multiplier;
    this.skipping = false;
    this.frames = 0;
    this.startTime = performance.now();
    this.pausedTime = 0;
    this.pausedAt = 0;
    this.emitting = emit;
    this.highlight.clear();
    this.wire.clear();
    this.fx.axisRevealed = false;
    this.fx.axisProgress = 0;
    this.fx.glow = 0;
    this.fx.burst = 1;
    this.award.progress = 0;
    const timing = spinTiming(turbo, this.reduced);
    this.host.dataset["spinPace"] = timing.id;
    this.host.dataset["reelStopMs"] = "[]";
    const observedStops: number[] = [];
    const tier = winTier(result.payoutUnits, result.totalCostUnits);
    if (!replay) this.cue("spin");
    emit({ stage: "reels" });
    gsap.config({ autoSleep: 15 });
    return new Promise((resolve) => {
      this.resolve = resolve;
      const timeline = gsap.timeline({
        onUpdate: () => this.draw(),
        onComplete: () => this.finish(),
      });
      this.timeline = timeline;
      this.columns.forEach((column, c) => {
        const motion = timing.reels[c]!;
        column.moving = true;
        column.pulse = 1;
        column.bounce = 0;
        column.blur = 0;
        const stopped = () => {
          column.moving = false;
          column.bounce = -timing.bounce;
          if (!this.skipping) {
            this.cue("stop");
            observedStops[c] = Math.round(
              performance.now() - this.startTime - this.pausedTime,
            );
            this.host.dataset["reelStopMs"] = JSON.stringify(observedStops);
          }
        };
        if (this.reduced) {
          // Reduced motion reveals the accepted windows without rapid scrolling.
          timeline.call(
            () => {
              column.sequence = null;
              column.position = result.reelStops[c]!;
              stopped();
            },
            [],
            motion.stopAt,
          );
          return;
        }
        column.sequence = reelSequence(
          REELS[c]!,
          Math.round(column.position),
          result.reelStops[c]!,
          motion.travel,
        );
        column.position = 0;
        const launch = (motion.velocity * motion.accelerate) / 2;
        const braking = (motion.velocity * motion.brake) / 2;
        timeline.to(
          column,
          {
            position: launch,
            blur: 1,
            duration: motion.accelerate,
            ease: "power1.in",
          },
          motion.startAt,
        );
        timeline.to(
          column,
          {
            position: motion.travel - braking,
            duration: motion.cruise,
            ease: "none",
          },
          motion.startAt + motion.accelerate,
        );
        timeline.to(
          column,
          {
            position: motion.travel,
            blur: 0,
            duration: motion.brake,
            ease: "power1.out",
            onComplete: stopped,
          },
          motion.stopAt - motion.brake,
        );
        timeline.to(
          column,
          {
            bounce: 0,
            duration: motion.settle,
            ease: "power2.out",
          },
          motion.stopAt,
        );
      });
      timeline.call(
        () => {
          this.selectedLine = 0;
          this.showHighlights();
          emit({ stage: "base" });
        },
        [],
        timing.baseAt,
      );
      timeline.to(
        this.fx,
        {
          axisProgress: timing.axisSteps,
          duration: timing.multiplierAt - 0.03,
          ease: "none",
        },
        0.02,
      );
      timeline.to(
        this.fx,
        { bottleRotation: this.reduced ? 0 : -0.025, duration: timing.pulse },
        timing.multiplierAt - timing.pulse,
      );
      timeline.call(
        () => {
          this.fx.axisRevealed = true;
          this.fx.bottleRotation = 0;
          emit({ stage: "multiplier" });
          if (!this.skipping) this.cue("axis");
        },
        [],
        timing.multiplierAt,
      );
      timeline.to(
        this.fx,
        {
          bottleScale: this.reduced ? 1 : 1.06,
          glow: this.reduced ? 0 : 1,
          duration: timing.pulse,
          ease: "power2.out",
        },
        timing.multiplierAt,
      );
      timeline.to(
        this.fx,
        {
          bottleScale: 1,
          glow: 0,
          duration: timing.bottleSettle,
          ease: "power2.inOut",
        },
        timing.multiplierAt + timing.pulse,
      );
      let time = timing.lineAt;
      for (const win of result.lineWins) {
        timeline.call(
          () => {
            this.selectedLine = win.line;
            this.showHighlights();
            emit({ stage: "multiplier", line: win.line });
            if (!this.skipping) this.cue("line");
          },
          [],
          time,
        );
        for (const column of this.columns)
          timeline.to(
            column,
            {
              pulse: this.reduced ? 1 : 1.05,
              duration: timing.pulse / 2,
              yoyo: true,
              repeat: 1,
            },
            time,
          );
        time += timing.lineGap;
      }
      timeline.call(
        () => {
          this.selectedLine = 0;
          this.showHighlights();
          emit({ stage: "award", progress: 0 });
          if (!this.skipping && !replay && tier !== "none") this.cue(tier);
          if (!replay && ["win", "big", "grand"].includes(tier))
            this.fx.burst = 0;
        },
        [],
        time,
      );
      const countTime =
        tier === "grand"
          ? 0.95
          : tier === "big"
            ? 0.7
            : result.payoutUnits
              ? 0.45
              : 0.12;
      timeline.to(
        this.award,
        {
          progress: 1,
          duration: countTime * timing.countScale,
          ease: "power2.out",
          onUpdate: () =>
            emit({ stage: "award", progress: this.award.progress }),
        },
        time,
      );
      if (["win", "big", "grand"].includes(tier) && !replay)
        timeline.to(
          this.fx,
          {
            burst: 1,
            duration: Math.max(countTime, 0.65) * timing.countScale,
            ease: "none",
          },
          time,
        );
      if (document.hidden) this.setHidden(true);
    });
  }
  private finish() {
    const result = this.result;
    if (this.pausedAt) {
      this.pausedTime += performance.now() - this.pausedAt;
      this.pausedAt = 0;
    }
    this.timeline = null;
    this.fx.burst = 1;
    this.fx.bottleScale = 1;
    this.fx.bottleRotation = 0;
    if (result) {
      this.restore(result);
      this.emitting?.({ stage: "award", progress: 1 });
    }
    this.host.dataset["frameCount"] = String(this.frames);
    this.host.dataset["activeMs"] = String(
      Math.round(performance.now() - this.startTime - this.pausedTime),
    );
    this.host.dataset["quality"] = this.quality;
    this.emitting = null;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }
  skip() {
    const timeline = this.timeline;
    if (!timeline) return;
    this.skipping = true;
    timeline.progress(1);
    timeline.kill();
    if (this.resolve) this.finish();
  }
  async setQuality(quality: Quality) {
    if (!this.initialized || this.timeline || quality === this.quality) return;
    const sequence = ++this.qualitySequence;
    const path =
      quality === "full" ? "food-atlas-full-v3.webp" : "food-atlas-v3.webp";
    try {
      const next = await Assets.load<Texture>(assetUrl(path));
      if (sequence !== this.qualitySequence || this.timeline) return;
      const previous = this.textures,
        oldPath = this.currentAtlasPath;
      this.atlas = next;
      this.textures = this.framesFrom(next);
      this.currentAtlasPath = path;
      this.quality = quality;
      this.app.renderer.resolution = Math.min(
        devicePixelRatio,
        quality === "full" ? 2 : 1.5,
      );
      this.app.renderer.resize(W, H);
      this.draw();
      previous.forEach((texture) => texture.destroy(false));
      if (oldPath !== path) await Assets.unload(assetUrl(oldPath));
      this.host.dataset["quality"] = this.quality;
    } catch {
      /* Preserve the complete previous atlas, never partial sprites. */
    }
  }
  setHidden(hidden: boolean) {
    if (!this.timeline) return;
    if (hidden) {
      this.timeline.pause();
      if (!this.pausedAt) this.pausedAt = performance.now();
    } else {
      if (this.pausedAt) {
        this.pausedTime += performance.now() - this.pausedAt;
        this.pausedAt = 0;
      }
      this.timeline.resume();
    }
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.setHidden(true);
    this.onContext(true);
  };
  private contextRestored = () => {
    this.lost = false;
    this.onContext(false);
    this.skip();
    this.draw();
  };
  dispose() {
    this.qualitySequence++;
    this.skip();
    if (!this.initialized) return;
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
    this.textures.forEach((texture) => texture.destroy(false));
    this.particleTexture?.destroy(true);
    this.initialized = false;
  }
  get idleGrid(): Grid {
    return gridAt(IDLE);
  }
}
