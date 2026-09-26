/**
 * The one-shots and the room tone. All synthesised at runtime, so the game
 * ships no audio files.
 *
 * The realism comes from the signal chain rather than from samples: every
 * source is routed through a convolution reverb built from a procedural
 * impulse response, so shots and footsteps sit in a wooden room instead of
 * sounding like dry noise bursts. A production build can swap the sources for
 * recorded foley behind exactly this API.
 */

import { ac, currentVenue, duckMusic, noiseBuffer, send, softClip } from './engine'

export { setVenue, unlockAudio, type Venue } from './engine'

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
  // A blank is still the loudest thing in the room for an instant.
  duckMusic(0.5, 0.05, 0.35)
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

  // Nothing else gets to be loud for the next second.
  duckMusic(0.16, 0.18, 1.2)

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
  duckMusic(0.34, 0.2, 0.9)
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
let running = false

function scheduleRoomTone(): void {
  if (!running) return
  const c = ac()
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

  // The cantina is a livelier room than the saloon, and sounds it.
  const spacing = currentVenue() === 'cantina' ? 700 : 900
  ambienceTimer = window.setTimeout(scheduleRoomTone, spacing + Math.random() * 3000)
}

/** Low room rumble plus sparse detail. The score is music.ts's business. */
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
  send(g, 0)
  bed.start()

  ambienceTimer = window.setTimeout(scheduleRoomTone, 1200)
}

export function stopAmbience(): void {
  running = false
  window.clearTimeout(ambienceTimer)
}
