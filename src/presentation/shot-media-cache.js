import { assetUrl } from "./assets.js";

// Load both possible outcomes before accepting a play. The presentation cannot
// make missing footage bias the result, consume a turn, or become a text result.
export class ShotMediaCache {
  constructor({
    fetchMedia = (url, options) => globalThis.fetch(url, options),
    maxEntries = 4,
  } = {}) {
    this.fetchMedia = fetchMedia;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.pending = new Map();
    this.abort = new AbortController();
  }
  async load(clip) {
    const key = clip.src;
    if (this.entries.has(key)) {
      const src = this.entries.get(key);
      this.entries.delete(key);
      this.entries.set(key, src);
      return { ...clip, src };
    }
    if (!this.pending.has(key)) {
      this.pending.set(key, this.download(clip));
    }
    try {
      return { ...clip, src: await this.pending.get(key) };
    } finally {
      this.pending.delete(key);
    }
  }
  async download(clip) {
    const timeout = new AbortController();
    const cancelled = () => timeout.abort();
    this.abort.signal.addEventListener("abort", cancelled, { once: true });
    const timer = setTimeout(cancelled, 12000);
    try {
      const response = await this.fetchMedia(assetUrl(clip.src), {
        signal: timeout.signal,
      });
      if (!response.ok) throw new Error("比赛视频加载失败，请重试");
      const blob = await response.blob();
      if (!blob.size || this.abort.signal.aborted)
        throw new Error("比赛视频加载中断，请重试");
      const src = URL.createObjectURL(blob);
      this.entries.set(clip.src, src);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        URL.revokeObjectURL(this.entries.get(oldest));
        this.entries.delete(oldest);
      }
      return src;
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", cancelled);
    }
  }
  destroy() {
    this.abort.abort();
    for (const url of this.entries.values()) URL.revokeObjectURL(url);
    this.entries.clear();
  }
}
