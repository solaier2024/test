// Original score: heavy double stomps, claps and a wordless low crowd motif.
// The chant uses its own notes; no commercial recording or lyrics are used.
export class StadiumAudio {
  constructor({ enabled = false, context = null } = {}) {
    this.enabled = enabled;
    this.context = context;
    this.sources = new Set();
    this.mode = "match";
    this.pressure = 0;
    this.playing = false;
  }
  activate() {
    if (!this.enabled) return;
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!this.context && !Audio) return;
    this.context ??= new Audio();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = 0.64;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.006;
      limiter.release.value = 0.18;
      this.master.connect(limiter).connect(this.context.destination);
      this.scoreGain = this.context.createGain();
      this.scoreGain.connect(this.master);
      const length = Math.ceil(this.context.sampleRate * 4);
      this.noise = this.context.createBuffer(
        2,
        length,
        this.context.sampleRate,
      );
      let n = 5381;
      for (let channel = 0; channel < 2; channel++) {
        const data = this.noise.getChannelData(channel);
        let smooth = 0;
        for (let i = 0; i < length; i++) {
          n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
          smooth = smooth * 0.45 + (n / 2147483648 - 1) * 0.55;
          data[i] = smooth;
        }
      }
    }
    if (this.context.state === "suspended" && !this.hidden)
      this.context.resume?.().catch(() => {});
    this.master.gain.setTargetAtTime(0.64, this.context.currentTime, 0.06);
  }
  setEnabled(value) {
    this.enabled = value;
    if (value) {
      this.activate();
      if (this.playing && !this.hidden) this.ambience();
    } else {
      this.stopScheduler();
      this.stopSources();
      this.stopCrowd();
      this.master?.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
    }
  }
  match(state) {
    this.pressure = state.quote?.keyBall
      ? 1
      : Math.min(0.55, (state.match?.round ?? 1) * 0.1);
    this.charging = state.busy && state.screen === "play";
    this.scoreGain?.gain.setTargetAtTime(
      this.charging ? 0.42 : 1,
      this.context.currentTime,
      0.1,
    );
    if (state.screen === "play") {
      this.playing = true;
      this.ambience();
    } else this.stopAmbience();
  }
  tone(
    frequency,
    duration = 0.2,
    level = 0.4,
    type = "sine",
    delay = 0,
    end = frequency,
  ) {
    if (!this.enabled || !this.context || !this.master || this.hidden) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createOscillator(),
      gain = this.context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(
      Math.max(1, end),
      at + duration,
    );
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(gain).connect(this.bus ?? this.master);
    this.track(source, [gain]);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  burst(duration = 0.2, level = 0.4, frequency = 1800, delay = 0, pan = 0) {
    if (!this.enabled || !this.context || !this.noise || this.hidden) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createBufferSource(),
      filter = this.context.createBiquadFilter();
    const gain = this.context.createGain(),
      stereo = this.context.createStereoPanner();
    source.buffer = this.noise;
    source.playbackRate.value = 0.85 + Math.abs(pan) * 0.3;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(
      level,
      at + Math.min(0.025, duration / 8),
    );
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source
      .connect(filter)
      .connect(gain)
      .connect(stereo)
      .connect(this.bus ?? this.master);
    this.track(source, [filter, gain, stereo]);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  track(source, nodes = []) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }
  stomp(delay = 0, strength = 1) {
    this.tone(118, 0.32, 0.78 * strength, "sine", delay, 36);
    this.tone(58, 0.46, 0.32 * strength, "sine", delay + 0.012, 30);
    this.burst(0.17, 0.6 * strength, 190, delay, -0.2);
    this.burst(0.1, 0.32 * strength, 1150, delay + 0.012, 0.2);
  }
  clap(delay = 0, strength = 1) {
    for (const [offset, pan, level] of [
      [0, -0.6, 0.5],
      [0.018, 0.65, 0.42],
      [0.043, -0.18, 0.32],
    ])
      this.burst(0.24, level * strength, 1700, delay + offset, pan);
    this.burst(0.52, 0.13 * strength, 2600, delay + 0.07, 0.4);
  }
  hum(note, duration, delay, strength = 1) {
    if (!this.enabled || !this.context || this.hidden) return;
    const at = this.context.currentTime + delay;
    // Detuned male voices filtered into a closed-mouth, chesty vowel.
    for (let i = 0; i < 9; i++) {
      const source = this.context.createOscillator(),
        chest = this.context.createBiquadFilter();
      const mouth = this.context.createBiquadFilter(),
        gain = this.context.createGain();
      const pan = this.context.createStereoPanner(),
        offset = i * 0.004;
      source.type = "sawtooth";
      source.frequency.setValueAtTime(
        note * (1 + (i - 4) * 0.004),
        at + offset,
      );
      source.frequency.linearRampToValueAtTime(
        note * (1 + (4 - i) * 0.003),
        at + duration,
      );
      chest.type = "lowpass";
      chest.frequency.value = 560;
      chest.Q.value = 2.8;
      mouth.type = "peaking";
      mouth.frequency.value = 280 + i * 18;
      mouth.Q.value = 3;
      mouth.gain.value = 8;
      pan.pan.value = (i - 4) / 5;
      gain.gain.setValueAtTime(0, at + offset);
      gain.gain.linearRampToValueAtTime(0.032 * strength, at + 0.09 + offset);
      gain.gain.setValueAtTime(
        0.032 * strength,
        at + Math.max(0.1, duration - 0.13),
      );
      gain.gain.linearRampToValueAtTime(0, at + duration);
      source
        .connect(chest)
        .connect(mouth)
        .connect(gain)
        .connect(pan)
        .connect(this.bus ?? this.master);
      this.track(source, [chest, mouth, gain, pan]);
      source.start(at + offset);
      source.stop(at + duration + 0.02);
    }
  }
  scoreBar(
    delay,
    index,
    {
      pressure = this.pressure,
      intro = this.mode === "intro",
      charging = this.charging,
    } = {},
  ) {
    this.bus = this.scoreGain;
    const beat = 60 / (intro ? 116 : pressure > 0.8 ? 124 : 108);
    const strength =
      (intro ? 1.2 : 0.85 + pressure * 0.35) * (charging ? 0.7 : 1);
    this.stomp(delay, strength);
    this.stomp(delay + beat, strength * 1.07);
    this.clap(delay + beat * 2, strength);
    if ((index % 4 === 3 && pressure > 0.4) || intro)
      this.clap(delay + beat * 3.5, strength * 0.5);
    const notes = [
      [98, 98, 110],
      [98, 92.5, 82.4],
      [87.3, 98, 110],
      [98, 110, 98],
    ][index % 4];
    const vocal = (intro ? 0.9 : 0.65 + pressure * 0.35) * (charging ? 0.6 : 1);
    this.hum(notes[0], beat * 0.62, delay + 0.045, vocal);
    this.hum(notes[1], beat * 0.65, delay + beat + 0.045, vocal);
    this.hum(notes[2], beat * 1.45, delay + beat * 2 + 0.05, vocal);
    this.bus = null;
    return beat * 4;
  }
  ambience() {
    if (!this.enabled || !this.context || this.hidden) return;
    this.playing = true;
    if (!this.crowd) {
      this.crowd = this.context.createBufferSource();
      this.crowd.buffer = this.noise;
      this.crowd.loop = true;
      this.crowdFilter = this.context.createBiquadFilter();
      this.crowdFilter.type = "bandpass";
      this.crowdFilter.frequency.value = 680;
      this.crowdFilter.Q.value = 0.5;
      this.crowdGain = this.context.createGain();
      this.crowdGain.gain.value = 0.075;
      this.crowd
        .connect(this.crowdFilter)
        .connect(this.crowdGain)
        .connect(this.scoreGain);
      this.crowd.start();
    }
    if (this.scheduler) return;
    this.nextBar = this.context.currentTime + 0.06;
    this.bar = 0;
    const schedule = () => {
      if (this.context.state !== "running") return;
      if (this.nextBar < this.context.currentTime)
        this.nextBar = this.context.currentTime + 0.03;
      while (this.nextBar < this.context.currentTime + 0.2)
        this.nextBar += this.scoreBar(
          this.nextBar - this.context.currentTime,
          this.bar++,
        );
    };
    schedule();
    this.scheduler = setInterval(schedule, 80);
  }
  stopScheduler() {
    clearInterval(this.scheduler);
    this.scheduler = null;
  }
  stopSources() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
  }
  stopCrowd() {
    if (!this.crowd) return;
    try {
      this.crowd.stop();
    } catch {}
    this.crowd.disconnect();
    this.crowdFilter.disconnect();
    this.crowdGain.disconnect();
    this.crowd = null;
  }
  stopAmbience() {
    this.playing = false;
    this.stopScheduler();
    this.stopSources();
    this.stopCrowd();
  }
  intro() {
    this.mode = "intro";
    if (!this.enabled) return;
    this.activate();
    this.ambience();
    this.burst(1.2, 0.45, 500);
  }
  stopIntro() {
    this.mode = "match";
  }
  countdown() {
    this.tone(880, 0.12, 0.15);
    this.stomp(0, 0.75);
  }
  whistle() {
    this.tone(2350, 0.38, 0.085, "sine", 0, 2150);
    this.tone(2650, 0.28, 0.035);
  }
  kick() {
    this.tone(145, 0.18, 0.7, "sine", 0, 34);
    this.burst(0.12, 0.45, 1400);
  }
  result(success) {
    this.burst(success ? 2.4 : 1.1, success ? 0.95 : 0.38, 950);
    this.stomp(0, success ? 1.4 : 0.65);
    if (success) {
      this.clap(0.13, 1.25);
      this.hum(130.8, 0.9, 0.15, 1.3);
      this.burst(1.5, 0.4, 1750, 0.2, -0.4);
    }
  }
  setHidden(hidden) {
    this.hidden = hidden;
    if (hidden) {
      this.stopScheduler();
      this.stopSources();
      this.stopCrowd();
      this.context?.suspend?.().catch(() => {});
    } else if (this.enabled && this.playing) {
      this.activate();
      this.ambience();
    }
  }
  destroy() {
    this.enabled = false;
    this.stopAmbience();
    this.context?.close?.().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
