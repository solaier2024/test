import { assetUrl, mediaVariant } from "./assets.js";

export class VideoBase {
  constructor(video, manifest, { portrait = () => false } = {}) {
    this.video = video;
    this.manifest = manifest;
    this.portrait = portrait;
    this.stopCurrent = null;
    this.playbackVersion = 0;
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
    return this.playClip(
      mediaVariant(this.manifest.cinematics?.[name], this.portrait()),
      { signal, holdLastFrame },
    );
  }
  playClip(clip, { signal, holdLastFrame = false, onTime = () => {} } = {}) {
    this.stop();
    if (!clip || signal?.aborted) return Promise.resolve(false);
    const v = this.video;
    return new Promise((resolve) => {
      let done = false;
      let frame;
      const finish = (played) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeEventListener("ended", ended);
        v.removeEventListener("error", failed);
        v.removeEventListener("timeupdate", time);
        signal?.removeEventListener("abort", failed);
        if (frame !== undefined) v.cancelVideoFrameCallback?.(frame);
        v.pause();
        if (!played || !holdLastFrame) v.classList.remove("playing");
        this.stopCurrent = null;
        resolve(played);
      };
      const ended = () => {
          onTime(v.currentTime);
          finish(true);
        },
        failed = () => finish(false);
      const time = () => onTime(v.currentTime);
      const frameTime = (_now, metadata) => {
        if (done) return;
        onTime(metadata.mediaTime);
        frame = v.requestVideoFrameCallback(frameTime);
      };
      const timer = setTimeout(failed, (clip.duration + 3) * 1000);
      this.stopCurrent = failed;
      v.addEventListener("ended", ended, { once: true });
      v.addEventListener("error", failed, { once: true });
      v.addEventListener("timeupdate", time);
      signal?.addEventListener("abort", failed, { once: true });
      v.poster = assetUrl(clip.poster);
      v.src = assetUrl(clip.src);
      v.preload = "auto";
      v.loop = false;
      v.currentTime = 0;
      v.classList.add("playing");
      if (v.requestVideoFrameCallback)
        frame = v.requestVideoFrameCallback(frameTime);
      Promise.resolve(v.play()).catch(failed);
    });
  }
  idle(clip) {
    this.stop();
    if (!clip) return;
    const version = this.playbackVersion;
    const v = this.video;
    v.poster = assetUrl(clip.poster);
    v.src = assetUrl(clip.src);
    v.preload = "auto";
    v.loop = true;
    v.classList.add("playing");
    Promise.resolve(v.play()).catch(() => {
      // Replacing the idle source rejects its pending play(). That rejection
      // belongs to the old loop and must not pause a newly started shot/replay.
      if (version !== this.playbackVersion) return;
      v.pause();
      v.classList.remove("playing");
    });
  }
  stop() {
    this.playbackVersion++;
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
