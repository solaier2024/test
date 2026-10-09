import { assetUrl } from "./assets.js";

// Load both possible outcomes before accepting a play. The presentation cannot
// make missing footage bias the result, consume a turn, or become a text result.
export class ShotMediaCache {
  constructor({
    fetchMedia = (url, options) => globalThis.fetch(url, options),
    maxEntries = 4,
    maxBytes = 8 * 1024 * 1024,
    resolveUrl = assetUrl,
  } = {}) {
    this.fetchMedia = fetchMedia;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.resolveUrl = resolveUrl;
    this.sizes = new Map();
    this.pinned = new Set();
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
    const timer = setTimeout(cancelled, 20000);
    try {
      const response = await this.fetchMedia(this.resolveUrl(clip.src), {
        signal: timeout.signal,
      });
      if (!response.ok) throw new Error("比赛视频加载失败，请重试");
      const blob = await response.blob();
      if (!blob.size || this.abort.signal.aborted)
        throw new Error("比赛视频加载中断，请重试");
      if (blob.size > this.maxBytes)
        throw new Error("本球视频过大，请检查媒体配置");
      const src = URL.createObjectURL(blob);
      this.entries.set(clip.src, src);
      this.sizes.set(clip.src, blob.size);
      this.trim();
      if (!this.entries.has(clip.src))
        throw new Error("视频缓存正在播放其他片段，请稍后重试");
      return src;
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", cancelled);
    }
  }
  trim() {
    let bytes = [...this.sizes.values()].reduce((a, b) => a + b, 0);
    while (this.entries.size > this.maxEntries || bytes > this.maxBytes) {
      const oldest = [...this.entries.keys()].find(
        (key) => !this.pinned.has(key),
      );
      if (oldest === undefined) break;
      URL.revokeObjectURL(this.entries.get(oldest));
      this.entries.delete(oldest);
      bytes -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
    }
  }
  pin(key) {
    this.pinned.add(key);
    return () => {
      this.pinned.delete(key);
      this.trim();
    };
  }
  destroy() {
    this.abort.abort();
    for (const url of this.entries.values()) URL.revokeObjectURL(url);
    this.entries.clear();
    this.sizes.clear();
    this.pinned.clear();
  }
}
