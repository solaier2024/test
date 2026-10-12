import { assetUrl, mediaUrl } from "./assets.ts";

type MediaAsset = {
  file: string;
  bytes: number;
  duration: number;
  hasAudio: boolean;
};
type Manifest = {
  version: number;
  reviewed: boolean;
  assets: Record<string, MediaAsset>;
};
export class MarketMedia {
  private manifest: Manifest | null = null;
  private enabled = true;
  private sound = true;
  private volume = 0.65;
  private cinematic = false;
  private hidden = document.hidden;
  private generation = 0;
  private finishOpening: (() => void) | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private currentEnvironment = "";
  constructor(
    private video: HTMLVideoElement,
    private stage: HTMLElement,
  ) {
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("playing", () =>
      stage.classList.add("video-playing"),
    );
    video.addEventListener("error", () => {
      stage.classList.remove("video-playing");
      video.dataset["state"] = "fallback";
    });
    window.addEventListener("resize", this.resize);
  }
  async init() {
    this.poster();
    try {
      const response = await fetch(mediaUrl("manifest.json"), {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const manifest = (await response.json()) as Manifest;
      if (manifest.version !== 1 || !manifest.reviewed) return;
      for (const name of [
        "landscape-environment",
        "portrait-environment",
        "opening-cinematic",
      ]) {
        const asset = manifest.assets[name];
        if (
          !asset ||
          !/^[a-z-]+\.mp4$/.test(asset.file) ||
          asset.bytes > 2_000_000 ||
          asset.duration <= 0
        )
          return;
      }
      this.manifest = manifest;
      this.environment();
    } catch {
      /* A full game remains usable from its scene poster. */
    }
  }
  private portrait() {
    return matchMedia("(orientation: portrait)").matches;
  }
  private poster() {
    const path = this.portrait()
      ? "market-portrait-v2.webp"
      : "market-landscape-v2.webp";
    this.stage.style.setProperty("--market-poster", `url("${assetUrl(path)}")`);
    this.video.poster = assetUrl(path);
  }
  private release() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.stage.classList.remove("video-playing");
    this.currentEnvironment = "";
  }
  environment() {
    if (this.cinematic) return;
    this.poster();
    this.stage.classList.remove("cinematic");
    if (!this.manifest || !this.enabled || this.hidden) {
      this.video.pause();
      return;
    }
    const key = this.portrait()
      ? "portrait-environment"
      : "landscape-environment";
    if (this.currentEnvironment !== key) {
      this.release();
      this.currentEnvironment = key;
      this.video.src = mediaUrl(this.manifest.assets[key]!.file);
    }
    this.video.muted = true;
    this.video.loop = true;
    this.video.dataset["state"] = "environment";
    void this.video.play().catch(() => {
      this.stage.classList.remove("video-playing");
      this.video.dataset["state"] = "fallback";
    });
  }
  opening(): Promise<void> {
    this.skip();
    if (
      !this.manifest ||
      this.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return Promise.resolve();
    const generation = ++this.generation;
    this.cinematic = true;
    this.release();
    this.stage.classList.add("cinematic");
    this.video.src = mediaUrl(this.manifest.assets["opening-cinematic"]!.file);
    this.video.loop = false;
    this.video.muted = !this.sound;
    this.video.volume = this.volume * 0.9;
    this.video.dataset["state"] = "opening";
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null,
        loadingTicks = 0;
      const finish = () => {
        if (generation !== this.generation) return;
        if (timer) clearTimeout(timer);
        this.video.removeEventListener("ended", finish);
        this.video.removeEventListener("error", finish);
        this.finishOpening = null;
        this.cinematic = false;
        this.generation++;
        this.release();
        this.environment();
        resolve();
      };
      const watchLoad = () => {
        if (this.video.readyState >= 3) return;
        if (!this.hidden) loadingTicks++;
        if (loadingTicks >= 8) finish();
        else timer = setTimeout(watchLoad, 1000);
      };
      this.finishOpening = finish;
      this.video.addEventListener("ended", finish);
      this.video.addEventListener("error", finish);
      timer = setTimeout(watchLoad, 1000);
      // The first play is issued from the player's click so sound may unlock.
      void this.video.play().catch(() => {
        if (generation !== this.generation || !this.cinematic || this.hidden)
          return;
        this.video.muted = true;
        void this.video.play().catch(finish);
      });
    });
  }
  skip() {
    this.finishOpening?.();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled && !this.cinematic) this.release();
    else this.environment();
  }
  setSound(enabled: boolean) {
    this.sound = enabled;
    if (this.cinematic) this.video.muted = !enabled;
  }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.cinematic) this.video.volume = this.volume * 0.9;
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) this.video.pause();
    else if (this.cinematic) void this.video.play().catch(() => this.skip());
    else this.environment();
  }
  private resize = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.environment(), 180);
  };
  dispose() {
    this.skip();
    this.generation++;
    window.removeEventListener("resize", this.resize);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.release();
  }
}
