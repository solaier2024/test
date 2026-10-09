import { assetUrl } from "./assets.js";

// Real breathing and crowd recordings, close heartbeat/percussion, and
// stadium reflections. No pitched choir or looping melodic score.
export class StadiumAudio {
  constructor({ enabled = true, context = null } = {}) {
    Object.assign(this, {
      enabled,
      context,
      mode: "match",
      pressure: 0,
      playing: false,
    });
    this.sources = new Set();
    this.sampleData = {};
    this.samples = {};
    this.decodeRequests = new Map();
    this.loadAbort = new AbortController();
  }
  async load(entries) {
    const results = await Promise.allSettled(
      Object.entries(entries).map(async ([name, clip]) => {
        if (this.samples[name]) return;
        const abort = new AbortController(),
          cancel = () => abort.abort();
        this.loadAbort.signal.addEventListener("abort", cancel, { once: true });
        const deadline = setTimeout(cancel, 20000);
        try {
          const response = await fetch(assetUrl(clip.src), {
            signal: abort.signal,
          });
          if (!response.ok) throw new Error("现场声音加载失败");
          this.sampleData[name] = await response.arrayBuffer();
          if (this.context) await this.decodeSample(name);
        } finally {
          clearTimeout(deadline);
          this.loadAbort.signal.removeEventListener("abort", cancel);
        }
      }),
    );
    return results.filter((r) => r.status === "rejected").length;
  }
  decodeSample(name) {
    if (this.samples[name] || !this.sampleData[name]) return Promise.resolve();
    if (!this.decodeRequests.has(name)) {
      const request = this.context
        .decodeAudioData(this.sampleData[name].slice(0))
        .then((sample) => {
          this.samples[name] = sample;
          delete this.sampleData[name];
        })
        .finally(() => this.decodeRequests.delete(name));
      this.decodeRequests.set(name, request);
    }
    return this.decodeRequests.get(name);
  }
  async activate() {
    if (!this.enabled) return;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!this.context && !Audio) return;
    this.context ??= new Audio();
    if (!this.master) this.buildGraph();
    if (this.context.state === "suspended" && !this.hidden)
      this.context.resume?.().catch(() => {});
    this.master.gain.setTargetAtTime(0.8, this.context.currentTime, 0.04);
    await Promise.allSettled(
      Object.keys(this.sampleData).map((name) => this.decodeSample(name)),
    );
  }
  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.16;
    this.master.connect(limiter).connect(ctx.destination);
    for (const name of [
      "heart",
      "breath",
      "rhythm",
      "stands",
      "reaction",
      "whistle",
    ]) {
      this[name + "Gain"] = ctx.createGain();
      this[name + "Gain"].connect(this.master);
    }
    // Reflections belong to the stands; breathing remains close and dry.
    for (const [seconds, level] of [
      [0.11, 0.22],
      [0.23, 0.14],
      [0.37, 0.09],
    ]) {
      const delay = ctx.createDelay(1),
        low = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      delay.delayTime.value = seconds;
      low.type = "lowpass";
      low.frequency.value = 2600;
      gain.gain.value = level;
      this.standsGain.connect(delay);
      this.reactionGain.connect(delay);
      this.whistleGain.connect(delay);
      delay.connect(low).connect(gain).connect(this.master);
    }
    this.noise = ctx.createBuffer(
      2,
      Math.ceil(ctx.sampleRate * 2),
      ctx.sampleRate,
    );
    let seed = 5381;
    for (let channel = 0; channel < 2; channel++) {
      const data = this.noise.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        smooth = smooth * 0.45 + (seed / 2147483648 - 1) * 0.55;
        data[i] = smooth;
      }
    }
    this.setMix();
  }
  setMix(at = this.context?.currentTime ?? 0) {
    if (!this.master) return;
    const quiet = this.inFlight || at < (this.reactionUntil ?? 0);
    const levels = {
      heart: quiet ? 0.07 : this.charging ? 0.82 : 0.6 + this.pressure * 0.18,
      breath: quiet
        ? 0.04
        : 0.7 + this.pressure * 0.2 + (this.charging ? 0.1 : 0),
      rhythm: quiet
        ? 0.18
        : this.mode === "intro"
          ? 0.7
          : 0.42 + this.pressure * 0.18,
      stands: this.charging ? 0.18 : this.mode === "intro" ? 0.42 : 0.34,
      reaction: 1,
      whistle: 1,
    };
    for (const [name, level] of Object.entries(levels))
      this[name + "Gain"].gain.setTargetAtTime(level, at, 0.08);
  }
  setEnabled(value) {
    this.enabled = value;
    if (value)
      this.activate()
        .then(() => {
          if (this.playing && !this.hidden && this.enabled) this.ambience();
        })
        .catch(() => {});
    else {
      this.stopScheduler();
      this.stopSources();
      this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.015);
    }
  }
  match(state) {
    this.pressure = Number.isInteger(state.quote?.pressure?.level)
      ? [0.15, 0.5, 1][state.quote.pressure.level]
      : state.quote?.keyBall
        ? 1
        : Math.min(0.6, (state.match?.round ?? 1) * 0.1);
    this.charging = state.busy && state.screen === "play";
    if (!this.charging) this.inFlight = false;
    this.setMix();
    if (state.screen === "play") {
      this.playing = true;
      this.ambience();
      if (!state.busy || state.activity === "playing")
        this.penaltyReady(state.quote?.quoteId);
    } else this.stopAmbience();
  }
  penaltyReady(quoteId) {
    if (!quoteId || this.readyQuoteId === quoteId) return;
    this.readyQuoteId = quoteId;
    this.whistle();
  }
  track(source, nodes = []) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }
  tone(
    frequency,
    duration,
    level,
    delay = 0,
    end = frequency,
    bus = this.master,
  ) {
    if (!this.enabled || !this.master || this.hidden) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createOscillator(),
      gain = this.context.createGain();
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(
      Math.max(1, end),
      at + duration,
    );
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(gain).connect(bus);
    this.track(source, [gain]);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  burst(duration, level, frequency, delay = 0, pan = 0, bus = this.master) {
    if (!this.enabled || !this.noise || this.hidden) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createBufferSource(),
      filter = this.context.createBiquadFilter();
    const gain = this.context.createGain(),
      stereo = this.context.createStereoPanner();
    source.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(
      level,
      at + Math.min(0.015, duration / 8),
    );
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(gain).connect(stereo).connect(bus);
    this.track(source, [filter, gain, stereo]);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  sample(
    name,
    delay,
    level,
    {
      bus = this.master,
      offset = 0,
      duration,
      rate = 1,
      fade = 0.12,
      pan = 0,
    } = {},
  ) {
    if (!this.enabled || !this.samples[name] || this.hidden) return;
    const at = this.context.currentTime + delay,
      buffer = this.samples[name];
    const length =
      Math.min(duration ?? buffer.duration, buffer.duration - offset) / rate;
    if (length <= 0) return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    const stereo = this.context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    stereo.pan.value = pan;
    const edge = Math.min(fade, length / 3);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + edge);
    gain.gain.setValueAtTime(level, at + length - edge);
    gain.gain.linearRampToValueAtTime(0, at + length);
    source.connect(gain).connect(stereo).connect(bus);
    this.track(source, [gain, stereo]);
    source.start(at, offset, length * rate);
  }
  heartbeat(delay = 0) {
    this.tone(84, 0.13, 0.64, delay, 40, this.heartGain);
    this.tone(66, 0.15, 0.4, delay + 0.16, 32, this.heartGain);
    this.burst(0.055, 0.14, 125, delay, 0, this.heartGain);
  }
  drum(delay, strength = 1) {
    this.tone(118, 0.26, 0.75 * strength, delay, 36, this.rhythmGain);
    this.burst(0.13, 0.44 * strength, 240, delay, -0.15, this.rhythmGain);
  }
  clap(delay, strength = 1) {
    for (const [offset, pan, level] of [
      [0, -0.6, 0.32],
      [0.027, 0.65, 0.3],
      [0.061, -0.18, 0.2],
    ])
      this.burst(
        0.18,
        level * strength,
        1700,
        delay + offset,
        pan,
        this.rhythmGain,
      );
  }
  scheduleTo(until) {
    const now = this.context.currentTime;
    const tempo =
      this.mode === "intro"
        ? 94
        : this.charging
          ? 104 + this.pressure * 14
          : 78 + this.pressure * 24;
    const beat = 60 / tempo;
    this.nextHeart ??= now + 0.02;
    this.nextBreath ??= now + 0.12;
    this.nextStands ??= now;
    this.nextRhythm ??= now + 0.35;
    this.rhythmIndex ??= 0;
    // A delayed/background timer must not play a backlog of beats at once.
    for (const name of ["nextHeart", "nextBreath", "nextStands", "nextRhythm"])
      if (this[name] < now - 0.05) this[name] = now + 0.02;
    while (this.nextHeart < until) {
      this.heartbeat(Math.max(0, this.nextHeart - now));
      this.nextHeart += beat;
    }
    if (this.samples.breath)
      while (this.nextBreath < until) {
        const rate = 1 + this.pressure * 0.08;
        this.sample("breath", Math.max(0, this.nextBreath - now), 0.7, {
          bus: this.breathGain,
          rate,
          fade: 0.08,
        });
        this.nextBreath += this.samples.breath.duration / rate - 0.1;
      }
    if (this.samples.stands)
      while (this.nextStands < until) {
        this.sample("stands", Math.max(0, this.nextStands - now), 0.72, {
          bus: this.standsGain,
          fade: 0.7,
          pan: this.rhythmIndex % 2 ? -0.1 : 0.1,
        });
        this.nextStands += this.samples.stands.duration - 1.3;
      }
    while (this.nextRhythm < until) {
      const delay = Math.max(0, this.nextRhythm - now);
      if (this.rhythmIndex % 4 === 0 || this.rhythmIndex % 4 === 2)
        this.drum(delay, this.rhythmIndex % 4 === 2 ? 0.7 : 1);
      else this.clap(delay, this.rhythmIndex % 4 === 3 ? 0.7 : 1);
      this.nextRhythm +=
        beat *
        (this.rhythmIndex % 4 === 1
          ? 1.5
          : this.rhythmIndex % 4 === 2
            ? 0.5
            : 1);
      this.rhythmIndex++;
    }
  }
  ambience() {
    if (!this.enabled || !this.context || !this.master || this.hidden) return;
    this.playing = true;
    if (this.scheduler) return;
    const schedule = () => {
      if (this.context.state !== "running") return;
      if (
        !this.inFlight &&
        this.reactionUntil &&
        this.context.currentTime >= this.reactionUntil
      ) {
        this.reactionUntil = 0;
        this.setMix();
      }
      this.scheduleTo(this.context.currentTime + 0.18);
    };
    schedule();
    this.scheduler = setInterval(schedule, 80);
  }
  stopScheduler() {
    clearInterval(this.scheduler);
    this.scheduler = null;
    for (const name of [
      "nextHeart",
      "nextBreath",
      "nextStands",
      "nextRhythm",
      "rhythmIndex",
    ])
      this[name] = null;
  }
  stopSources() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
  }
  stopAmbience() {
    this.playing = false;
    this.inFlight = false;
    this.reactionUntil = 0;
    this.readyQuoteId = null;
    this.stopScheduler();
    this.stopSources();
  }
  intro() {
    this.mode = "intro";
    this.setMix();
    this.ambience();
    this.sample("stands", 0.2, 0.35, {
      duration: 2.5,
      fade: 0.4,
      bus: this.reactionGain,
    });
  }
  stopIntro() {
    this.mode = "match";
    this.setMix();
  }
  whistle(delay = 0) {
    this.sample("whistle", delay, 0.9, {
      bus: this.whistleGain,
      fade: 0.008,
      pan: -0.12,
    });
  }
  kick(delay = 0) {
    if (!this.context) return;
    this.inFlight = true;
    this.setMix(this.context.currentTime + delay);
    this.tone(145, 0.16, 0.65, delay, 34);
    this.burst(0.1, 0.32, 1400, delay);
  }
  result(success, delay = 0) {
    if (!this.context) return;
    const at = this.context.currentTime + delay;
    this.reactionUntil = at + 2;
    this.setMix(at);
    this.sample(success ? "roar" : "stands", delay, success ? 1.3 : 0.42, {
      offset: success ? 0 : 11,
      duration: success ? 6 : 1.8,
      fade: success ? 0.35 : 0.08,
      bus: this.reactionGain,
    });
    if (!success)
      this.sample("breath", delay + 0.2, 0.45, { duration: 1.6, fade: 0.08 });
  }
  setHidden(hidden) {
    this.hidden = hidden;
    if (hidden) {
      this.stopScheduler();
      this.stopSources();
      this.context?.suspend?.().catch(() => {});
    } else if (this.enabled && this.playing)
      this.activate()
        .then(() => this.ambience())
        .catch(() => {});
  }
  destroy() {
    this.enabled = false;
    this.loadAbort.abort();
    this.stopAmbience();
    this.context?.close?.().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
