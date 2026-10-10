import { tr } from "../i18n/index.js";
import { assetUrl, mediaVariant } from "./assets.js";
import { choreography } from "./choreography.js";
import { VideoBase } from "./video-base.js";
import { ShotMediaCache } from "./shot-media-cache.js";

// A clip describes what happened, never whether the player should win.
export function selectShotClip(manifest, resolution, portrait = false) {
  const { ballDir, diveDir, saved } = choreography(resolution);
  const key = `${resolution.shot === "chip" && resolution.phase === "attack" ? "chip-" : ""}${saved ? "save" : "goal"}-${ballDir}-${diveDir}`;
  const entry = manifest.gameplay?.shots?.[key];
  if (!entry || entry.status !== "approved") return null;
  if (
    resolution.shot === "chip" &&
    resolution.phase === "attack" &&
    entry.chipTrajectory !== "approved"
  )
    return null;
  const clip = mediaVariant(entry, portrait);
  if (
    !clip?.src ||
    !clip.poster ||
    clip.ballDir !== ballDir ||
    clip.diveDir !== diveDir ||
    clip.saved !== saved ||
    (resolution.shot === "chip" &&
      resolution.phase === "attack" &&
      clip.shotType !== "chip") ||
    !(
      clip.kickAt >= 0 &&
      clip.impactAt > clip.kickAt &&
      clip.duration > clip.impactAt
    )
  )
    return null;
  return { ...clip, key, crowdMotion: entry.crowdMotion };
}

// Match-stage video and opening video are separate layers, so skipping the
// opening, rotating the screen or failing a shot never exposes a cartoon field.
export class VideoMatchScene {
  constructor(video, poster, { onProgress = () => {} } = {}) {
    this.video = video;
    this.poster = poster;
    this.onProgress = onProgress;
    this.width = 1;
    this.height = 1;
    this.mode = "follow";
    this.cameraModes = [["follow", tr("比赛机位")]];
    this.showcase = true;
    this.shotAbort = null;
    this.warmTimer = null;
    this.warmKey = null;
  }
  async init(manifest) {
    this.manifest = manifest;
    this.clips = new ShotMediaCache();
    this.player = new VideoBase(this.video, manifest, {
      portrait: () => this.portrait,
    });
    this.onProgress(0.3, tr("正在载入电影球场…"));
    const entry = manifest.gameplay?.idle ?? manifest.cinematics?.intro;
    const clip = mediaVariant(entry, false);
    const image = new Image();
    image.src = assetUrl(clip.poster);
    await image.decode();
    this.onProgress(1, tr("写实画面就绪"));
    await this.prepare("attack");
  }
  get portrait() {
    return this.width / this.height < 1;
  }
  resize(width, height) {
    const portraitChanged = this.portrait !== width / height < 1;
    this.width = width;
    this.height = height;
    for (const node of [this.video, this.poster])
      Object.assign(node.style, { width: `${width}px`, height: `${height}px` });
    if (portraitChanged && !this.shotAbort)
      this.prepare(this.phase ?? "attack");
  }
  async prepare(phase) {
    this.phase = phase;
    const clip = mediaVariant(this.manifest.gameplay.idle, this.portrait);
    this.currentPlate = clip;
    this.poster.style.backgroundImage = `url("${assetUrl(clip.poster)}")`;
    this.player.idle(clip);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      this.player.stop();
    this.video.dataset.presentation = "idle";
  }
  async setCamera(mode) {
    this.mode = mode;
  }
  supports(option, phase) {
    const requiresCrowd = this.manifest.gameplay.crowdMotionRequired;
    if (requiresCrowd && this.manifest.gameplay.idle.crowdMotion !== "approved")
      return false;
    return [true, false].every((success) => {
      const clip = selectShotClip(
        this.manifest,
        { ...option, phase, success },
        this.portrait,
      );
      return clip && (!requiresCrowd || clip.crowdMotion === "approved");
    });
  }
  async preflight(option, phase) {
    const requiresCrowd = this.manifest.gameplay.crowdMotionRequired;
    if (requiresCrowd && this.manifest.gameplay.idle.crowdMotion !== "approved")
      throw new Error(tr("动态看台视频正在制作，本球尚未提交"));
    const outcomes = [true, false].map((success) =>
      selectShotClip(
        this.manifest,
        { ...option, phase, success },
        this.portrait,
      ),
    );
    if (outcomes.some((clip) => !clip))
      throw new Error(tr("对应比赛视频仍在准备中，本球尚未提交"));
    if (
      requiresCrowd &&
      outcomes.some((clip) => clip.crowdMotion !== "approved")
    )
      throw new Error(tr("本球观众反应视频尚未就绪，本球尚未提交"));
    await Promise.all(outcomes.map((clip) => this.clips.load(clip)));
  }
  warm(quote, option) {
    clearTimeout(this.warmTimer);
    const connection = navigator.connection;
    if (
      document.hidden ||
      this.shotAbort ||
      !quote ||
      !option ||
      connection?.saveData ||
      ["slow-2g", "2g"].includes(connection?.effectiveType) ||
      !this.supports(option, quote.phase)
    )
      return;
    const clips = [true, false].map((success) =>
      selectShotClip(
        this.manifest,
        { ...option, phase: quote.phase, success },
        this.portrait,
      ),
    );
    const key = clips.map((c) => c.src).join("|");
    if (key === this.warmKey) return;
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null;
      this.warmKey = key;
      Promise.all(clips.map((c) => this.clips.load(c))).catch(() => {
        if (this.warmKey === key) this.warmKey = null;
        // A speculative failure is retried by preflight, before any submit.
      });
    }, 160);
  }
  setHidden(hidden) {
    clearTimeout(this.warmTimer);
    if (this.shotAbort) return; // Already accepted actions keep their result.
    if (hidden) this.video.pause();
    else this.prepare(this.phase ?? "attack");
  }
  project(x) {
    // Normalized, asset-calibrated goal points, transformed with object-fit.
    const plate = this.currentPlate;
    const dir = x < -1 ? "L" : x > 1 ? "R" : "C";
    const point = plate.targets[dir];
    const scale = Math.max(
      this.width / plate.width,
      this.height / plate.height,
    );
    return {
      x:
        point[0] * plate.width * scale + (this.width - plate.width * scale) / 2,
      y:
        point[1] * plate.height * scale +
        (this.height - plate.height * scale) / 2,
      z: 1,
    };
  }
  async play(resolution, { onKick = () => {}, onImpact = () => {} } = {}) {
    const selected = selectShotClip(this.manifest, resolution, this.portrait);
    if (!selected) throw new Error(tr("本球视频尚未就绪"));
    this.shotAbort?.abort();
    const abort = new AbortController();
    this.shotAbort = abort;
    const unpin = this.clips.pin?.(selected.src);
    let kicked = false,
      impacted = false;
    const kick = () => {
      if (!kicked) {
        kicked = true;
        onKick();
      }
    };
    const impact = () => {
      if (!impacted) {
        impacted = true;
        onImpact();
      }
    };
    try {
      const clip = await this.clips.load(selected);
      this.video.dataset.presentation = clip.key;
      const played = await this.player.playClip(clip, {
        signal: abort.signal,
        holdLastFrame: true,
        onTime: (time) => {
          if (time >= clip.kickAt) kick();
          if (time >= clip.impactAt) impact();
        },
      });
      if (!played && !abort.signal.aborted)
        throw new Error(tr("本球视频播放中断，可用回放重看"));
      return played;
    } finally {
      unpin?.();
      if (this.shotAbort === abort) this.shotAbort = null;
    }
  }
  suspend() {
    this.shotAbort?.abort();
    this.player.stop();
  }
  destroy() {
    clearTimeout(this.warmTimer);
    this.suspend();
    this.player.destroy();
    this.clips.destroy();
  }
}
