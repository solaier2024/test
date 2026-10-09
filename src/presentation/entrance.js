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
    this.timeline?.kill();
    this.scene?.cameraTween?.kill();
    this.audio.stopIntro();
  }
  async play(media, scene) {
    this.stop();
    if (reduced()) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.media = media;
    this.scene = scene;
    const title = this.overlay.querySelector(".cinema-title");
    const number = this.overlay.querySelector(".cinema-count");
    const subtitle = this.overlay.querySelector(".cinema-subtitle");
    const strip = this.overlay.querySelector(".cinema-meter");
    this.arena.dataset.cinematic = "intro";
    this.overlay.hidden = false;
    number.hidden = true;
    title.hidden = false;
    title.innerHTML = "<span>全场屏息。</span><strong>由你定局。</strong>";
    subtitle.textContent = "FIVE ROUNDS. ONE LAST KICK.";
    this.skipButton.focus({ preventScroll: true });
    this.audio.intro();
    const timeline = gsap.timeline({ paused: true });
    this.timeline = timeline;
    timeline.fromTo(
      title.children,
      { y: 50, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, stagger: 0.16, ease: "power3.out" },
      0.3,
    );
    timeline.fromTo(
      subtitle,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45 },
      0.8,
    );
    timeline.to(title, { opacity: 0, y: -20, duration: 0.45 }, 3.75);
    timeline.to(subtitle, { opacity: 0, duration: 0.3 }, 3.9);
    timeline.fromTo(
      strip,
      { scaleX: 0 },
      { scaleX: 1, duration: 6, ease: "none" },
      0,
    );
    const sync = () => timeline.time(Math.min(6, media.video.currentTime));
    gsap.ticker.add(sync);
    try {
      const played = await media.play("intro", { signal, holdLastFrame: true });
      gsap.ticker.remove(sync);
      timeline.kill();
      if (signal.aborted) return;
      if (!played) {
        // A failed video still has a genuine camera move in the live scene.
        title.hidden = false;
        gsap.set(title, { opacity: 1, y: 0 });
        await scene.cinematic("intro", { duration: 1.8 });
      }
      if (signal.aborted) return;
      this.audio.stopIntro();
      title.hidden = true;
      subtitle.textContent = "YOUR MOMENT. YOUR SHOT.";
      gsap.set(subtitle, { opacity: 1, y: 0 });
      number.hidden = false;
      await new Promise((resolve) => {
        const count = gsap.timeline({
          onComplete: resolve,
          onInterrupt: resolve,
        });
        this.timeline = count;
        ["3", "2", "1", "开球"].forEach((text, i) => {
          count.call(
            () => {
              number.textContent = text;
              if (i < 3) this.audio.countdown();
              else this.audio.whistle();
            },
            null,
            i * 0.42,
          );
          count.fromTo(
            number,
            { opacity: 0, scale: 1.3 },
            { opacity: 1, scale: 1, duration: 0.18, ease: "power2.out" },
            i * 0.42,
          );
          count.to(number, { opacity: 0, duration: 0.12 }, i * 0.42 + 0.28);
        });
      });
    } finally {
      gsap.ticker.remove(sync);
      this.timeline?.kill();
      this.audio.stopIntro();
      media.stop();
      this.overlay.hidden = true;
      delete this.arena.dataset.cinematic;
      this.media = null;
      this.scene = null;
      this.abort = null;
      gsap.set([title, subtitle, number, strip], { clearProps: "all" });
      this.audio.ambience();
    }
  }
}
