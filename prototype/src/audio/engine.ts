/**
 * The shared audio graph. Every source in the game, one-shot or score, lands
 * on these buses, so the room, the levels and the ducking are decided in one
 * place instead of being argued out per sound.
 *
 * Nothing here loads a file. All of it is synthesised at runtime, which keeps
 * the download at zero bytes, keeps it honest on a phone, and sidesteps
 * sample licensing entirely.
 */

export type Venue = 'saloon' | 'cantina'

/**
 * Where the score sits when nothing is ducking it. Set by ear against the
 * gunshot, which is the loudest thing in the game by a long way and has to
 * stay that way.
 */
const MUSIC_LEVEL = 0.82
const MASTER_LEVEL = 0.85

let ctx: AudioContext | null = null
let master: GainNode | null = null
let dry: GainNode | null = null
let wet: GainNode | null = null
let convolver: ConvolverNode | null = null
let music: GainNode | null = null
let venue: Venue = 'saloon'
let muted = false

const listeners = new Set<() => void>()
const announce = () => listeners.forEach((fn) => fn())

export function ac(): AudioContext {
  if (ctx) return ctx
  const c = new AudioContext()
  ctx = c

  master = c.createGain()
  master.gain.value = muted ? 0.0001 : MASTER_LEVEL
  master.connect(c.destination)

  convolver = c.createConvolver()
  convolver.buffer = roomImpulse(c, venue)

  dry = c.createGain()
  dry.gain.value = 0.82
  dry.connect(master)

  wet = c.createGain()
  wet.gain.value = 0.42
  convolver.connect(wet)
  wet.connect(master)

  music = c.createGain()
  music.gain.value = MUSIC_LEVEL
  music.connect(master)

  c.onstatechange = announce
  armUnlock()
  return c
}

/**
 * Browsers hold audio back until the page has been interacted with, and they
 * do not care what the interaction was for. Listening for any gesture at all
 * means the score starts on whatever the player happens to touch first.
 */
function armUnlock(): void {
  const release = () => {
    if (!muted && ctx && ctx.state !== 'running') void ctx.resume()
  }
  for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(event, release, { capture: true, passive: true })
  }
}

/** The bus the score plays on, so it can be ducked as one thing. */
export function musicBus(): GainNode {
  ac()
  return music as GainNode
}

/** Sends a node to both the direct path and the room. */
export function send(node: AudioNode, reverbAmount = 1): void {
  ac()
  node.connect(dry as GainNode)
  if (reverbAmount > 0 && convolver) {
    const tap = (ctx as AudioContext).createGain()
    tap.gain.value = reverbAmount
    node.connect(tap)
    tap.connect(convolver)
  }
}

/**
 * The room's input, for callers that need to route their own wet path. The
 * score does, because a cue has to be able to fade out its reverb along with
 * everything else rather than leaving a tail nobody can stop.
 */
export function reverbIn(): ConvolverNode {
  ac()
  return convolver as ConvolverNode
}

/**
 * Procedural impulse response: exponentially decaying noise with a handful of
 * early reflections, shaped differently for a timber saloon and a hard-walled
 * adobe cantina.
 */
function roomImpulse(c: AudioContext, room: Venue): AudioBuffer {
  const seconds = room === 'cantina' ? 1.9 : 1.25
  const decay = room === 'cantina' ? 2.4 : 3.6
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)

  // Adobe walls ring brighter and longer; timber soaks up the top end.
  const tilt = room === 'cantina' ? 0.85 : 0.45
  const reflections =
    room === 'cantina' ? [0.011, 0.019, 0.031, 0.047, 0.068] : [0.007, 0.013, 0.023, 0.038]

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const env = Math.pow(1 - t, decay)
      const white = Math.random() * 2 - 1
      lp += (white - lp) * tilt
      data[i] = lp * env
    }
    for (const r of reflections) {
      const idx = Math.floor(r * c.sampleRate) + (ch === 1 ? 37 : 0)
      if (idx < len) data[idx] += (room === 'cantina' ? 0.7 : 0.5) * (Math.random() > 0.5 ? 1 : -1)
    }
  }
  return buf
}

export function setVenue(room: Venue): void {
  venue = room
  if (ctx && convolver) convolver.buffer = roomImpulse(ctx, room)
}

export const currentVenue = (): Venue => venue

export function unlockAudio(): void {
  const c = ac()
  if (!muted && c.state !== 'running') void c.resume()
}

/* ---------------------------------------------------------- mute & ducking */

export type SoundState = 'on' | 'off' | 'blocked'

/**
 * A single string rather than an object, so it can be handed straight to
 * useSyncExternalStore without a new identity on every read.
 */
export function soundState(): SoundState {
  if (muted) return 'off'
  return ctx?.state === 'running' ? 'on' : 'blocked'
}

export function setMuted(next: boolean): void {
  muted = next
  const c = ac()
  if (!next && c.state !== 'running') void c.resume()
  const g = (master as GainNode).gain
  const t = c.currentTime
  g.cancelScheduledValues(t)
  g.setValueAtTime(Math.max(g.value, 0.0001), t)
  g.linearRampToValueAtTime(next ? 0.0001 : MASTER_LEVEL, t + 0.22)
  announce()
}

export function onAudioChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Pulls the score down under a gunshot and lets it back up. Without this the
 * music and the report fight over the same few hundred milliseconds and the
 * shot stops sounding dangerous.
 */
export function duckMusic(depth = 0.2, hold = 0.16, release = 1.1): void {
  const c = ac()
  const g = (music as GainNode).gain
  const t = c.currentTime
  g.cancelScheduledValues(t)
  g.setValueAtTime(Math.max(g.value, 0.0001), t)
  g.linearRampToValueAtTime(MUSIC_LEVEL * depth, t + 0.025)
  g.setValueAtTime(MUSIC_LEVEL * depth, t + hold)
  g.linearRampToValueAtTime(MUSIC_LEVEL, t + hold + release)
}

/* ------------------------------------------------------------- primitives */

export function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

export function softClip(drive = 2.2): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive)
  }
  return curve
}
