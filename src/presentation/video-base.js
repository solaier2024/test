import { assetUrl, mediaVariant } from "./assets.js";

export class VideoBase {
  constructor(video, manifest, { portrait = () => false } = {}) {
    this.video = video;
    this.manifest = manifest;
    this.portrait = portrait;
    this.stopCurrent = null;
    video.muted = true;
    video.playsInline = true;
  }
  // Metadata only for the current/next cinematic; never download the whole pack.
  warm(name) {
    const clip = mediaVariant(
      this.manifest.cinematics?.[name],
      this.portrait(),
    );
    if (!clip) return;
    this.video.preload = "metadata";
    this.video.poster = assetUrl(clip.poster);
    this.video.src = assetUrl(clip.src);
  }
  play(name, { signal, holdLastFrame = false } = {}) {
    this.stop();
    const clip = mediaVariant(
      this.manifest.cinematics?.[name],
      this.portrait(),
    );
    if (!clip || signal?.aborted) return Promise.resolve(false);
    const v = this.video;
    return new Promise((resolve) => {
      let done = false;
      const finish = (played) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeEventListener("ended", ended);
        v.removeEventListener("error", failed);
        signal?.removeEventListener("abort", failed);
        v.pause();
        if (!played || !holdLastFrame) v.classList.remove("playing");
        this.stopCurrent = null;
        resolve(played);
      };
      const ended = () => finish(true),
        failed = () => finish(false);
      const timer = setTimeout(failed, (clip.duration + 3) * 1000);
      this.stopCurrent = failed;
      v.addEventListener("ended", ended, { once: true });
      v.addEventListener("error", failed, { once: true });
      signal?.addEventListener("abort", failed, { once: true });
      v.poster = assetUrl(clip.poster);
      v.src = assetUrl(clip.src);
      v.preload = "auto";
      v.currentTime = 0;
      v.classList.add("playing");
      Promise.resolve(v.play()).catch(failed);
    });
  }
  stop() {
    this.stopCurrent?.();
    this.video.pause();
    this.video.classList.remove("playing");
  }
  destroy() {
    this.stop();
    this.video.removeAttribute("src");
    this.video.load();
  }
}
