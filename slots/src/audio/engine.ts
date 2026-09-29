/*
 * The audio graph. Everything is synthesised at runtime - there is not a single
 * audio file in this project - so there is no third-party sample to license and
 * nothing to download before the room has a sound.
 *
 *   voices -> [music bus | sfx bus] -> duck -> master -> out
 *                    \-> room (convolution) -----^
 *
 * Clips are silent on purpose. If the room tone were baked into the video the
 * score could not duck under a card, could not change with the shoe, and could
 * not follow the room when the piano stops.
 */

/** Resting level of the music bus; the ducking curve returns to exactly this. */
const MUSIC_LEVEL = 0.92
/** Resting level of the upright, which the room shutting it up returns to. */
const PIANO_LEVEL = 0.13

let ctx: AudioContext | null = null
let master: GainNode
let musicNode: GainNode
let sfxNode: GainNode
let pianoNode: GainNode
let roomIn: GainNode
let noise: AudioBuffer | null = null
let muted = false
let unlocked = false
const listeners = new Set<() => void>()

export function ac(): AudioContext {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new Ctor()

  master = ctx.createGain()
  master.gain.value = muted ? 0 : 0.85
  master.connect(ctx.destination)

  musicNode = ctx.createGain()
  musicNode.gain.value = MUSIC_LEVEL
  musicNode.connect(master)

  sfxNode = ctx.createGain()
  sfxNode.gain.value = 0.9
  sfxNode.connect(master)

  /*
   * The upright is across the room: quieter, dulled by the distance, and it
   * is FURNITURE. Measured on its own bus it used to peak at -35.8 against an
   * ambience of -39.8, which is to say the table had a soundtrack with a
   * saloon behind it rather than a saloon with a piano in the corner. The
   * sound of this table is the room and the machine; the piano is one of the
   * things the room is doing.
   */
  pianoNode = ctx.createGain()
  pianoNode.gain.value = PIANO_LEVEL
  const wall = ctx.createBiquadFilter()
  wall.type = 'lowpass'
  wall.frequency.value = 1500
  pianoNode.connect(wall).connect(master)

  roomIn = ctx.createGain()
  roomIn.gain.value = 0.9
  const verb = ctx.createConvolver()
  verb.buffer = impulse(ctx, 1.35, 3.4)
  roomIn.connect(verb).connect(master)

  return ctx
}

/**
 * A synthesised impulse response. Noise under an exponential decay with a few
 * discrete early reflections, which is what makes a big wooden room read as a
 * room rather than as a reverb preset.
 */
function impulse(c: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, n, c.sampleRate)
  const early = [0.011, 0.019, 0.029, 0.047, 0.071]
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const t = i / n
      d[i] = (Math.random() * 2 - 1) * (1 - t) ** decay
    }
    for (const at of early) {
      const i = Math.floor(at * c.sampleRate * (ch ? 1.07 : 1))
      if (i < n) d[i] += (ch ? -0.36 : 0.42) * (1 - at)
    }
  }
  return buf
}

export function noiseBuffer(c: BaseAudioContext, seconds = 2): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate && noise.duration >= seconds) return noise
  const n = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(1, n, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  noise = buf
  return buf
}

export const musicBus = () => (ac(), musicNode)
export const sfxBus = () => (ac(), sfxNode)
export const pianoBus = () => (ac(), pianoNode)
export const reverbIn = () => (ac(), roomIn)

/** tanh, as a curve a WaveShaper can use, for the soft edge on a struck sound. */
export function softClip(c: BaseAudioContext, drive = 2.2): WaveShaperNode {
  const shaper = c.createWaveShaper()
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive)
  shaper.curve = curve
  shaper.oversample = '2x'
  return shaper
}

/** Pulls the music down so whatever just happened is the loudest thing. */
export function duck(amount: number, hold: number, release: number): void {
  const c = ac()
  const g = musicNode.gain
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(MUSIC_LEVEL * (1 - amount), now + 0.03)
  g.setValueAtTime(MUSIC_LEVEL * (1 - amount), now + 0.03 + hold)
  g.linearRampToValueAtTime(MUSIC_LEVEL, now + 0.03 + hold + release)
}

/**
 * The oldest gesture in the genre: something happens and the piano stops. It is
 * free here because the upright already has its own bus.
 */
export function stopThePiano(seconds: number): void {
  const c = ac()
  const g = pianoNode.gain
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(0.0001, now + 0.08)
  g.setValueAtTime(0.0001, now + seconds)
  g.linearRampToValueAtTime(PIANO_LEVEL, now + seconds + 1.6)
}

/**
 * Sends a copy of the master output somewhere else as well as to the speakers.
 * render-score.mjs uses this to record the real graph, so what lands on disk is
 * what the game plays rather than a second arrangement written for testing.
 */
export function tapOutput(node: AudioNode): void {
  ac()
  master.connect(node)
}

export function isMuted(): boolean {
  return muted
}

export function isUnlocked(): boolean {
  return unlocked
}

export function setMuted(next: boolean): void {
  muted = next
  if (ctx) master.gain.linearRampToValueAtTime(next ? 0 : 0.85, ctx.currentTime + 0.12)
  listeners.forEach((l) => l())
}

export function onAudioState(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Browsers refuse to make a sound before the player touches something. This is
 * called from the sound button and from a one-shot listener on any input, so
 * touching anything at all unlocks it - and a deliberate mute is never
 * overridden by any of it.
 */
export async function unlock(): Promise<void> {
  const c = ac()
  if (c.state === 'suspended') {
    try {
      await c.resume()
    } catch {
      return
    }
  }
  if (c.state === 'running' && !unlocked) {
    unlocked = true
    listeners.forEach((l) => l())
  }
}

if (typeof window !== 'undefined') {
  const once = () => {
    void unlock()
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(ev, once, { once: true, passive: true })
  }
}
