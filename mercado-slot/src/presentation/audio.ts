// Procedural UI cues; no dependency on licensed recordings or a network fetch.
export class MarketAudio {
  private context: AudioContext | null = null;
  enabled = true;
  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch {
      /* Sound is optional. */
    }
  }
  private tone(
    frequency: number,
    time: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ) {
    const context = this.context;
    if (!this.enabled || !context || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  cue(kind: "spin" | "stop" | "axis" | "profit") {
    const context = this.context;
    if (!context) return;
    const time = context.currentTime;
    if (kind === "spin") this.tone(180, time, 0.12, 0.025, "triangle");
    if (kind === "stop") this.tone(380, time, 0.07, 0.018, "sine");
    if (kind === "axis") {
      this.tone(540, time, 0.12, 0.02, "sine");
      this.tone(810, time + 0.06, 0.2, 0.014, "sine");
    }
    if (kind === "profit")
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone(f, time + i * 0.07, 0.24, 0.016, "sine"),
      );
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) void this.context?.suspend();
    else void this.unlock();
  }
  setHidden(hidden: boolean) {
    if (hidden) void this.context?.suspend();
    else if (this.enabled) void this.context?.resume();
  }
  dispose() {
    void this.context?.close();
    this.context = null;
  }
}
