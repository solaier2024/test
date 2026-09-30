/*
 * The audio graph. Everything is synthesised at runtime - there is not a single
 * audio file in this project - so there is no third-party sample to license and
 * nothing to download before the room has a sound.
 *
 *   the saloon and the machine -> sfx bus ----.
 *   the upright in the corner --> piano bus --+-> master -> out
 *                            \-> room (convolution) ------^
 *
 * Clips are silent on purpose. If the room tone were baked into the video it
 * could not duck under a reel, could not fill up as the night goes on, and
 * could not stop dead when somebody calls the house.
 *
 * There were three buses until the music was rebuilt. The third carried a low
 * sawtooth drone that came up under the floor as the room's attention rose -
 * and that was the one genuinely non-diegetic thing on the table, a film score
 * cue with no source in the picture. The room pressing in is now the room
 * pressing in: more talkers, less space between them. Nothing was left on the
 * music bus afterwards, so it went too, and duck() - which every machine sound
 * calls and which had quietly been ducking nothing but that drone - now does
 * what its name says and leans on the upright.
 */

/**
 * Resting level of the upright, which everything leaning on it returns to.
 *
 * Came down from 0.13 when the instrument got its second string: a
 * honky-tonk unison pair is two strings' worth of energy, so the same number
 * bought a louder piano than it used to, and the measured gap to the room
 * closed to 5dB. The upright is furniture; it does not get to spend the room's
 * headroom on being more characterful.
 *
 * Back up a little when the piano became a band, and it is not a change of
 * mind about furniture. The arrangement now spends a lot of its energy above
 * the wall's corner - a banjo is nearly all offbeat and overtone - so the
 * same bus gain measured 2.3dB quieter than the solo piano did, and what was
 * meant to be something you could tap a foot to arrived as a rumour. 0.125
 * put the band back where the piano was.
 *
 * And then back DOWN by 3.9dB when a fiddle took the tune, which is the same
 * correction in the opposite direction and for a better-defined reason than
 * either of the two before it. Every instrument on this bus until now was
 * struck or plucked: all the energy goes in at one instant and the note is a
 * spike followed by a decay, so most of the time a piano is playing, most of
 * what it is doing is getting quieter. A bow pours energy in for as long as
 * the arm moves, so a bowed note has no decay at all and its average level is
 * close to its peak. At 0.125 the new arrangement measured -50.5 dBFS against
 * a room mean of -48.7, and "the upright is furniture" wants at least 4dB of
 * daylight; the fiddle had eaten it without one number in music.ts being about
 * loudness. 0.08 restores 5.7dB, which is more room than the piano ever had.
 */
const BAND_LEVEL = 0.08

let ctx: AudioContext | null = null
let master: GainNode
let sfxNode: GainNode
let bandNode: GainNode
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

  sfxNode = ctx.createGain()
  sfxNode.gain.value = 0.9
  sfxNode.connect(master)

  /*
   * The band is at the other end of the bar: quieter, dulled by the distance,
   * and it is the FLOOR rather than the feature. Measured on its own bus it
   * used to peak at -35.8 against an ambience of -39.8, which is to say the
   * table had a soundtrack with a saloon behind it rather than a saloon with
   * a band in it. The sound of this table is the room and the machine; the
   * band is one of the things the room is doing.
   *
   * The wall was at 1500Hz when there was only a piano behind it. A banjo is
   * almost entirely made of what lives above that - it is a drum with strings
   * over it - so at 1500 the band arrangement arrived as a rumour of itself.
   * 2600 lets the offbeat through and is still unmistakably through a wall.
   */
  bandNode = ctx.createGain()
  bandNode.gain.value = BAND_LEVEL
  const wall = ctx.createBiquadFilter()
  wall.type = 'lowpass'
  wall.frequency.value = 2600
  bandNode.connect(wall).connect(master)

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

export const sfxBus = () => (ac(), sfxNode)
export const bandBus = () => (ac(), bandNode)
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

/** Leans on the upright so whatever just happened is the loudest thing. */
export function duck(amount: number, hold: number, release: number): void {
  const c = ac()
  const g = bandNode.gain
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(BAND_LEVEL * (1 - amount), now + 0.03)
  g.setValueAtTime(BAND_LEVEL * (1 - amount), now + 0.03 + hold)
  g.linearRampToValueAtTime(BAND_LEVEL, now + 0.03 + hold + release)
}

/**
 * The oldest gesture in the genre: something happens and the piano stops. It is
 * free here because the upright already has its own bus.
 */
export function stopTheBand(seconds: number): void {
  const c = ac()
  const g = bandNode.gain
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(0.0001, now + 0.08)
  g.setValueAtTime(0.0001, now + seconds)
  g.linearRampToValueAtTime(BAND_LEVEL, now + seconds + 1.6)
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
