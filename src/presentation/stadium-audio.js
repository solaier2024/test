// Original procedural stadium ambience and sports stings. No audio download,
// microphone access or playback before a user gesture.
export class StadiumAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.sources = new Set();
    this.timers = new Set();
  }
  activate() {
    if (!this.enabled) return;
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio) return;
    this.context ??= new Audio();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.context.destination);
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
          smooth = smooth * 0.8 + ((n / 4294967296) * 2 - 1) * 0.2;
          data[i] = smooth;
        }
      }
    }
    this.context.resume().catch(() => {});
    this.master.gain.setTargetAtTime(0.28, this.context.currentTime, 0.08);
  }
  setEnabled(value) {
    this.enabled = value;
    if (value) this.activate();
    else {
      this.stopIntro();
      this.stopAmbience();
      if (this.master)
        this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
    }
  }
  tone(
    frequency,
    duration = 0.2,
    level = 0.4,
    type = "sine",
    delay = 0,
    end = frequency,
  ) {
    if (!this.enabled || !this.context || !this.master) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createOscillator();
    const gain = this.context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, at);
    source.frequency.exponentialRampToValueAtTime(
      Math.max(1, end),
      at + duration,
    );
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(gain).connect(this.master);
    this.track(source);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  burst(duration = 0.2, level = 0.4, frequency = 1800, delay = 0) {
    if (!this.enabled || !this.context || !this.noise) return;
    const at = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + Math.min(0.08, duration / 5));
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(gain).connect(this.master);
    this.track(source);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
  track(source) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
  }
  ambience() {
    if (!this.enabled || !this.context || this.crowd) return;
    this.crowd = this.context.createBufferSource();
    this.crowd.buffer = this.noise;
    this.crowd.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.5;
    this.crowdGain = this.context.createGain();
    this.crowdGain.gain.value = 0.12;
    this.crowd.connect(filter).connect(this.crowdGain).connect(this.master);
    this.crowd.start();
  }
  stopAmbience() {
    this.crowd?.stop();
    this.crowd?.disconnect();
    this.crowd = null;
  }
  intro() {
    this.stopIntro();
    if (!this.enabled) return;
    this.activate();
    this.ambience();
    this.burst(1.7, 0.7, 500);
    for (let i = 0; i < 12; i++) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.tone(95, 0.27, 0.65, "sine", 0, 32);
        if (i % 2) this.burst(0.13, 0.4, 1400);
      }, i * 410);
      this.timers.add(timer);
    }
  }
  stopIntro() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
  }
  countdown() {
    this.tone(880, 0.12, 0.23, "sine");
    this.tone(70, 0.2, 0.4, "sine", 0, 28);
  }
  whistle() {
    this.tone(2350, 0.38, 0.1, "sine", 0, 2150);
    this.tone(2650, 0.28, 0.045, "sine");
  }
  kick() {
    this.tone(125, 0.16, 0.6, "sine", 0, 34);
    this.burst(0.12, 0.38, 1600);
  }
  result(success) {
    this.burst(success ? 1.7 : 0.85, success ? 1.1 : 0.4, 950);
    this.tone(success ? 90 : 60, 0.4, 0.5, "sine", 0, 25);
    if (success) this.burst(0.35, 0.65, 1700, 0.15);
  }
  destroy() {
    this.enabled = false;
    this.stopIntro();
    this.stopAmbience();
    this.context?.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
