/**
 * All sound is synthesised at runtime, so the game ships no audio files.
 *
 * The realism comes from signal chain rather than samples: every source is
 * routed through a convolution reverb built from a procedural impulse
 * response, so shots and footsteps sit in a wooden room instead of sounding
 * like dry noise bursts. A production build can swap the sources for recorded
 * foley behind exactly this API.
 */

export type Venue = 'saloon' | 'cantina'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let dry: GainNode | null = null
let wet: GainNode | null = null
let convolver: ConvolverNode | null = null
let musicBus: GainNode | null = null
let venue: Venue = 'saloon'

function ac(): AudioContext {
  if (ctx) return ctx
  const c = new AudioContext()
  ctx = c

  master = c.createGain()
  master.gain.value = 0.85
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

  musicBus = c.createGain()
  musicBus.gain.value = 0.3
  musicBus.connect(master)

  return c
}

/** Sends a node to both the direct path and the room. */
function send(node: AudioNode, reverbAmount = 1): void {
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

export function unlockAudio(): void {
  const c = ac()
  if (c.state === 'suspended') void c.resume()
}

export function setVolume(v: number): void {
  ac()
  if (master) master.gain.value = v
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Short filtered noise burst, the building block for every mechanical tick. */
function tick(at: number, freq: number, q: number, peak: number, length: number): void {
  const c = ac()
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, length)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  src.connect(bp).connect(g)
  send(g, 0.6)
  src.start(at)
  src.stop(at + length + 0.02)
}

/** Hammer falling on an empty chamber: a hard, dry mechanical snap. */
export function playClick(): void {
  const c = ac()
  const t = c.currentTime
  tick(t, 2600, 1.4, 0.55, 0.05)
  tick(t + 0.012, 1250, 3, 0.3, 0.04)
}

/** Thumbing the hammer back: two ratchet steps into the sear. */
export function playCock(): void {
  const c = ac()
  const t = c.currentTime
  tick(t, 1900, 2, 0.34, 0.045)
  tick(t + 0.088, 2600, 2.4, 0.42, 0.04)
  tick(t + 0.098, 900, 4, 0.2, 0.05)
}

/**
 * Black powder report, built in layers: the crack off the muzzle, the body
 * thump, a metallic cylinder ring, and the room tail from the convolver.
 */
export function playGunshot(): void {
  const c = ac()
  const t = c.currentTime

  const crack = c.createBufferSource()
  crack.buffer = noiseBuffer(c, 1.1)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(2400, t)
  hp.frequency.exponentialRampToValueAtTime(150, t + 0.4)
  const shaper = c.createWaveShaper()
  shaper.curve = softClip()
  const cg = c.createGain()
  cg.gain.setValueAtTime(1.1, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
  crack.connect(hp).connect(shaper).connect(cg)
  send(cg, 1.4)
  crack.start(t)
  crack.stop(t + 1.1)

  const thump = c.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(155, t)
  thump.frequency.exponentialRampToValueAtTime(30, t + 0.26)
  const tg = c.createGain()
  tg.gain.setValueAtTime(1.0, t)
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
  thump.connect(tg)
  send(tg, 0.5)
  thump.start(t)
  thump.stop(t + 0.45)

  // The frame and cylinder ringing after the charge lets go.
  for (const f of [1840, 2470, 3310]) {
    const ring = c.createOscillator()
    ring.type = 'sine'
    ring.frequency.value = f * (0.99 + Math.random() * 0.02)
    const rg = c.createGain()
    rg.gain.setValueAtTime(0.0001, t)
    rg.gain.exponentialRampToValueAtTime(0.045, t + 0.008)
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    ring.connect(rg)
    send(rg, 1.2)
    ring.start(t)
    ring.stop(t + 0.55)
  }
}

function softClip(): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 2.2)
  }
  return curve
}

/** Cylinder spin: a run of ratchet ticks that slows and drops into the notch. */
export function playSpin(): void {
  const c = ac()
  let t = c.currentTime
  let gap = 0.032
  for (let i = 0; i < 18; i++) {
    tick(t, 3300 - i * 62, 2.2, 0.26 - i * 0.008, 0.028)
    t += gap
    gap *= 1.115
  }
  tick(t + 0.03, 1500, 5, 0.34, 0.06)
}

/** Clay chips pushed across bare wood. */
export function playChips(): void {
  const c = ac()
  const t = c.currentTime
  for (let i = 0; i < 6; i++) {
    tick(t + i * 0.034 + Math.random() * 0.022, 1400 + Math.random() * 1700, 3, 0.2, 0.05)
  }
}

/** A dull, slow double thud under moments of high tension. */
export function playHeartbeat(): void {
  const c = ac()
  const t = c.currentTime
  for (const [at, peak] of [
    [0, 0.5],
    [0.26, 0.34],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(64, t + at)
    o.frequency.exponentialRampToValueAtTime(34, t + at + 0.16)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t + at)
    g.gain.exponentialRampToValueAtTime(peak, t + at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22)
    o.connect(g)
    send(g, 0.2)
    o.start(t + at)
    o.stop(t + at + 0.3)
  }
}

/** Win and loss stingers, so a settled hand lands without reading text. */
export function playSting(win: boolean): void {
  const c = ac()
  const t = c.currentTime
  const notes = win ? [196, 262, 330] : [175, 139, 110]
  notes.forEach((f, i) => {
    const at = t + i * 0.13
    const o = c.createOscillator()
    o.type = win ? 'triangle' : 'sawtooth'
    o.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(win ? 0.17 : 0.12, at + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.75)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = win ? 2400 : 900
    o.connect(lp).connect(g)
    send(g, 1.1)
    o.start(at)
    o.stop(at + 0.8)
  })
}

// ---------------------------------------------------------------- ambience

let ambienceTimer = 0
let musicTimer = 0
let running = false

/** Plucked string with a short body resonance, for the cantina guitar. */
function pluck(at: number, freq: number, gain: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.value = freq
  const body = c.createBiquadFilter()
  body.type = 'bandpass'
  body.frequency.value = freq * 2.1
  body.Q.value = 1.1
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.5)
  o.connect(body).connect(g)
  g.connect(musicBus as GainNode)
  if (convolver) {
    const tap = c.createGain()
    tap.gain.value = 0.8
    g.connect(tap)
    tap.connect(convolver)
  }
  o.start(at)
  o.stop(at + 1.6)
}

/** Slightly detuned hammer strike, for the saloon upright piano. */
function pianoNote(at: number, freq: number, gain: number): void {
  const c = ac()
  for (const detune of [0.997, 1.003]) {
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq * detune
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.9)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1800
    o.connect(lp).connect(g)
    g.connect(musicBus as GainNode)
    if (convolver) {
      const tap = c.createGain()
      tap.gain.value = 0.9
      g.connect(tap)
      tap.connect(convolver)
    }
    o.start(at)
    o.stop(at + 2)
  }
}

// A minor, played sparsely. Slow enough to sit under dialogue and tension.
const SALOON_PHRASE = [220, 261.63, 329.63, 261.63, 196, 246.94]
// Phrygian colouring, the interval that reads as Spanish guitar.
const CANTINA_PHRASE = [220, 233.08, 277.18, 329.63, 277.18, 233.08]

function scheduleMusic(): void {
  if (!running || !ctx) return
  const phrase = venue === 'cantina' ? CANTINA_PHRASE : SALOON_PHRASE
  const play = venue === 'cantina' ? pluck : pianoNote
  const t = ctx.currentTime + 0.05
  const step = venue === 'cantina' ? 0.42 : 0.55

  phrase.forEach((f, i) => {
    if (Math.random() < 0.22) return
    play(t + i * step, f, 0.09 + Math.random() * 0.05)
  })
  // Root underneath, an octave down, to give the phrase a floor.
  play(t, phrase[0] / 2, 0.07)

  musicTimer = window.setTimeout(scheduleMusic, (phrase.length * step + 2.2 + Math.random() * 3) * 1000)
}

function scheduleRoomTone(): void {
  if (!running || !ctx) return
  const c = ctx
  const at = c.currentTime

  // Bottles, boots, a chair shifting: sparse, quiet, never on a grid.
  const r = Math.random()
  if (r < 0.34) {
    tick(at, 2600 + Math.random() * 2600, 6, 0.05, 0.06)
  } else if (r < 0.62) {
    tick(at, 320 + Math.random() * 260, 2, 0.06, 0.13)
    tick(at + 0.13, 280 + Math.random() * 200, 2, 0.04, 0.11)
  } else {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = 90 + Math.random() * 60
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.035, at + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
    o.connect(g)
    send(g, 0.8)
    o.start(at)
    o.stop(at + 0.55)
  }

  ambienceTimer = window.setTimeout(scheduleRoomTone, 900 + Math.random() * 3400)
}

/** Low room rumble plus sparse detail and a slow instrumental bed. */
export function startAmbience(): void {
  if (running) return
  running = true
  const c = ac()

  const bed = c.createBufferSource()
  bed.buffer = noiseBuffer(c, 4)
  bed.loop = true
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 300
  const g = c.createGain()
  g.gain.value = 0.045
  bed.connect(lp).connect(g)
  g.connect(master as GainNode)
  bed.start()

  ambienceTimer = window.setTimeout(scheduleRoomTone, 1200)
  musicTimer = window.setTimeout(scheduleMusic, 2400)
}

export function stopAmbience(): void {
  running = false
  window.clearTimeout(ambienceTimer)
  window.clearTimeout(musicTimer)
}
