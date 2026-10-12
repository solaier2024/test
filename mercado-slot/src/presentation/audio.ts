import type { Cue } from "./view.ts";
import { mediaUrl } from "./assets.ts";

// Stream the licensed street-party score; Web Audio mixes it with our own cues.
// Attribution and loop-edit details are visible in the bilingual settings menu.
export class MarketAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private grill: AudioBufferSourceNode | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private recording: HTMLAudioElement;
  private recordingNode: MediaElementAudioSourceNode | null = null;
  private playAttempt = 0;
  private playPending = false;
  private hidden = false;
  private cinematic = false;
  private active = false;
  private disposed = false;
  enabled = true;
  music = true;
  volume = 0.65;
  constructor(recording: HTMLAudioElement) {
    this.recording = recording;
  }
  async unlock() {
    if (this.disposed) return;
    this.active = true;
    if (!this.enabled || this.hidden) return;
    try {
      if (!this.context) this.create();
      const context = this.context!;
      await context.resume();
      if (this.context !== context || this.disposed) return;
      if (this.enabled && !this.hidden) this.syncMusic();
      else void context.suspend();
    } catch {
      /* Audio never blocks playing with the accepted result. */
    }
  }
  private create() {
    const context = (this.context = new AudioContext());
    this.master = context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(context.destination);
    this.musicBus = context.createGain();
    this.musicBus.gain.value = 0.72;
    this.musicBus.connect(this.master);
    this.ambienceBus = context.createGain();
    this.ambienceBus.gain.value = 0.22;
    this.ambienceBus.connect(this.master);
    // One native streaming decoder avoids retaining a minute-long PCM buffer
    // and the old 80-ms synthetic-note timer on every device.
    this.recording.crossOrigin = "anonymous";
    this.recording.loop = true;
    this.recording.preload = "auto";
    this.recording.src = mediaUrl("street-fiesta.m4a");
    this.recordingNode = context.createMediaElementSource(this.recording);
    this.recordingNode.connect(this.musicBus);
    this.recording.load();
    this.mix();
    const buffer = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let seed = 19317;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      samples[i] = ((seed >>> 0) / 0x100000000) * 2 - 1;
    }
    this.noise = buffer;
    // The background recording is extracted from this game's own approved CG.
    void fetch(mediaUrl("grill-ambience.m4a"), {
      signal: AbortSignal.timeout(6000),
    })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((bytes) => context.decodeAudioData(bytes))
      .then((audio) => {
        if (this.context !== context || !this.ambienceBus) return;
        const source = context.createBufferSource();
        source.buffer = audio;
        source.loop = true;
        source.connect(this.ambienceBus);
        source.start();
        this.grill = source;
      })
      .catch(() => {});
  }
  private track(source: AudioScheduledSourceNode, cleanup: () => void) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      cleanup();
    };
  }
  private tone(
    frequency: number,
    time: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    bus = this.master,
    endFrequency?: number,
  ) {
    const c = this.context;
    if (!c || !bus || !this.enabled || this.hidden || c.state !== "running")
      return;
    const oscillator = c.createOscillator(),
      gain = c.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    if (endFrequency)
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        time + duration,
      );
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    this.track(oscillator, () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  }
  private percussion(
    time: number,
    duration: number,
    frequency: number,
    volume: number,
    bus = this.master,
  ) {
    const c = this.context;
    if (
      !c ||
      !bus ||
      !this.noise ||
      !this.enabled ||
      this.hidden ||
      c.state !== "running"
    )
      return;
    const source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain();
    source.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(time);
    source.stop(time + duration + 0.01);
    this.track(source, () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    });
  }
  private syncMusic() {
    const wanted =
      this.active &&
      this.enabled &&
      this.music &&
      !this.hidden &&
      !this.cinematic &&
      !this.disposed &&
      this.context?.state === "running";
    if (!wanted) {
      this.playAttempt++;
      this.playPending = false;
      this.recording.pause();
      return;
    }
    if (!this.recording.paused || this.playPending) return;
    const attempt = ++this.playAttempt;
    this.playPending = true;
    void this.recording
      .play()
      .catch(() => {
        // A late rejection from a paused CG/mute attempt must not stop the
        // replacement play request. Network failure never blocks the game.
      })
      .finally(() => {
        if (attempt === this.playAttempt) this.playPending = false;
      });
  }
  cue(kind: Cue) {
    const c = this.context;
    if (!c) return;
    const time = c.currentTime;
    if (kind === "spin") {
      this.percussion(time, 0.24, 2600, 0.07);
      this.tone(160, time, 0.14, 0.035, "triangle", this.master, 85);
    }
    if (kind === "stop") {
      this.percussion(time, 0.05, 720, 0.13);
      this.tone(120, time, 0.06, 0.045, "sine");
    }
    if (kind === "line") this.tone(820, time, 0.075, 0.014, "sine");
    if (kind === "axis") {
      this.tone(900, time, 0.2, 0.035, "sine");
      this.tone(1390, time, 0.12, 0.015, "sine");
    }
    if (kind === "return") this.percussion(time, 0.04, 1300, 0.025);
    if (["win", "big", "grand"].includes(kind)) {
      const notes =
        kind === "grand"
          ? [523.25, 659.25, 784, 1046.5, 1318.5, 1568]
          : [523.25, 659.25, 784, 1046.5];
      notes.forEach((f, i) => {
        this.tone(f, time + i * 0.055, 0.32, 0.035, "triangle");
        this.tone(f * 2, time + i * 0.055, 0.12, 0.01, "sine");
      });
      if (kind !== "win")
        [0, 0.14, 0.28].forEach((offset) =>
          this.percussion(time + offset, 0.055, 5200, 0.035),
        );
    }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopPending();
      this.syncMusic();
      void this.context?.suspend();
    } else if (this.active && !this.hidden) void this.unlock();
  }
  setMusic(enabled: boolean) {
    this.music = enabled;
    this.mix();
    this.syncMusic();
  }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.volume,
        this.context.currentTime,
        0.05,
      );
  }
  setCinematic(active: boolean) {
    this.cinematic = active;
    this.mix();
    this.syncMusic();
  }
  private mix() {
    const c = this.context;
    if (!c) return;
    this.musicBus?.gain.setTargetAtTime(
      !this.cinematic && this.music ? 0.72 : 0,
      c.currentTime,
      0.08,
    );
    this.ambienceBus?.gain.setTargetAtTime(
      this.cinematic ? 0 : 0.22,
      c.currentTime,
      0.08,
    );
  }
  private stopPending() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) {
      this.stopPending();
      this.syncMusic();
      void this.context?.suspend();
    } else if (this.enabled && this.active) void this.unlock();
  }
  dispose() {
    this.disposed = true;
    this.syncMusic();
    this.stopPending();
    try {
      this.grill?.stop();
    } catch {}
    this.recordingNode?.disconnect();
    this.recordingNode = null;
    this.recording.removeAttribute("src");
    this.recording.load();
    void this.context?.close();
    this.context = null;
  }
}
