import { gsap } from "gsap";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class LoadingSequence {
  constructor(node) {
    this.node = node;
    this.value = 0;
    this.motion = { value: 0 };
  }
  progress(value, message) {
    this.value = Math.max(this.value, Math.min(1, value));
    this.node.querySelector(".loading-status").textContent = message;
    gsap.to(this.motion, {
      value: this.value,
      duration: reduced() ? 0 : 0.28,
      overwrite: true,
      onUpdate: () => {
        const v = this.motion.value;
        this.node.querySelector("progress").value = v;
        this.node.querySelector(".loading-percent").textContent =
          `${Math.round(v * 100)}`;
        this.node.style.setProperty("--loaded", v);
      },
    });
    this.node.querySelectorAll(".loading-steps span").forEach((step, i) => {
      step.classList.toggle("complete", this.value >= (i + 1) / 3);
    });
  }
  async finish() {
    this.progress(1, "全场就绪 · 你的关键一球");
    this.node.dataset.ready = "true";
    await new Promise((resolve) =>
      gsap.to(this.node, {
        opacity: 0,
        scale: reduced() ? 1 : 1.035,
        duration: reduced() ? 0 : 0.4,
        delay: reduced() ? 0 : 0.28,
        onComplete: resolve,
      }),
    );
    gsap.killTweensOf(this.motion);
    this.node.remove();
  }
  fail(message) {
    gsap.killTweensOf(this.motion);
    this.node.querySelector(".loading-status").textContent = message;
    this.node.dataset.failed = "true";
  }
}

export class OpeningSequence {
  constructor(arena, overlay, audio) {
    this.arena = arena;
    this.overlay = overlay;
    this.audio = audio;
    this.skipButton = overlay.querySelector(".skip-video");
    this.skipButton.onclick = () => this.stop();
  }
  stop() {
    this.abort?.abort();
    this.media?.stop();
    this.audio.stopIntro();
  }
  async play(media) {
    this.stop();
    if (reduced()) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.media = media;
    this.arena.dataset.cinematic = "intro";
    this.overlay.hidden = false;
    this.skipButton.focus({ preventScroll: true });
    this.audio.intro();
    try {
      // The film itself is the opening. No captions, countdown or title cards.
      await media.play("intro", { signal });
    } finally {
      this.audio.stopIntro();
      media.stop();
      this.overlay.hidden = true;
      delete this.arena.dataset.cinematic;
      this.media = null;
      this.abort = null;
      this.audio.ambience();
    }
  }
}
