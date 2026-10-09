import { assetUrl, mediaVariant } from "./assets.js";
import { choreography } from "./choreography.js";
import { VideoBase } from "./video-base.js";

// A clip describes what happened, never whether the player should win.
export function selectShotClip(manifest, resolution, portrait = false) {
  const { ballDir, diveDir, saved } = choreography(resolution);
  const key = `${saved ? "save" : "goal"}-${ballDir}-${diveDir}`;
  const entry = manifest.gameplay?.shots?.[key];
  if (!entry || entry.status !== "approved") return null;
  const clip = mediaVariant(entry, portrait);
  if (
    !clip?.src ||
    !clip.poster ||
    clip.ballDir !== ballDir ||
    clip.diveDir !== diveDir ||
    clip.saved !== saved ||
    !(
      clip.kickAt >= 0 &&
      clip.impactAt > clip.kickAt &&
      clip.duration > clip.impactAt
    )
  )
    return null;
  return { ...clip, key };
}

// Match-stage video and opening video are separate layers, so skipping the
// opening, rotating the screen or failing a shot never exposes a cartoon field.
export class VideoMatchScene {
  constructor(
    video,
    poster,
    { onProgress = () => {}, onMissing = () => {} } = {},
  ) {
    this.video = video;
    this.poster = poster;
    this.onProgress = onProgress;
    this.onMissing = onMissing;
    this.width = 1;
    this.height = 1;
    this.mode = "follow";
    this.cameraModes = [["follow", "比赛机位"]];
    this.showcase = true;
    this.shotAbort = null;
  }
  async init(manifest) {
    this.manifest = manifest;
    this.player = new VideoBase(this.video, manifest, {
      portrait: () => this.portrait,
    });
    this.onProgress(0.3, "正在载入电影球场…");
    const entry = manifest.gameplay?.idle ?? manifest.cinematics?.intro;
    const clip = mediaVariant(entry, false);
    const image = new Image();
    image.src = assetUrl(clip.poster);
    await image.decode();
    this.onProgress(1, "写实画面就绪");
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
  async play(
    resolution,
    { fast = false, onKick = () => {}, onImpact = () => {} } = {},
  ) {
    this.shotAbort?.abort();
    const abort = new AbortController();
    this.shotAbort = abort;
    const clip = selectShotClip(this.manifest, resolution, this.portrait);
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
    this.video.dataset.presentation = clip ? clip.key : "result-only";
    try {
      if (fast) {
        this.player.stop();
        kick();
        impact();
        return;
      }
      if (clip) {
        const played = await this.player.playClip(clip, {
          signal: abort.signal,
          holdLastFrame: true,
          onTime: (time) => {
            if (time >= clip.kickAt) kick();
            if (time >= clip.impactAt) impact();
          },
        });
        if (!played && !abort.signal.aborted)
          this.onMissing("动作短片未能播放，已保留本球结果");
      } else {
        // Keep the genuine CG plate and show the accepted result. Do not use
        // an unrelated goal/save video or pretend the action pack is complete.
        this.onMissing("本球动作短片制作中，当前显示比赛判定");
        this.player.stop();
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 450);
          abort.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
      if (!abort.signal.aborted) {
        kick();
        impact();
      }
    } finally {
      if (this.shotAbort === abort) this.shotAbort = null;
    }
  }
  async cinematic() {
    /* Keep the photographic poster when intro cannot play. */
  }
  suspend() {
    this.shotAbort?.abort();
    this.player.stop();
  }
  destroy() {
    this.suspend();
    this.player.destroy();
  }
}
