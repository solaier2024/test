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

import { ac, currentVenue, duckMusic, noiseBuffer, reverbIn, send, softClip } from './engine'

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

/**
 * Hammer falling on an empty chamber.
 *
 * This is the near miss, and it is the most common outcome in the game, so
 * it has to carry weight rather than just being quiet. Four things happen at
 * once: the snap, the empty cylinder ringing hollow behind it, a long low
 * breath out, and the score dipping and then swelling back past where it was.
 * The relief is in that swell; the click on its own is a dry tick.
 */
export function playClick(): void {
  const c = ac()
  const t = c.currentTime

  tick(t, 3100, 1.2, 0.68, 0.05)
  tick(t + 0.012, 1250, 3, 0.36, 0.045)
  // Steel on steel has a body as well as a top. Without this the snap is all
  // sibilance and disappears the moment the arrangement is doing anything.
  tick(t + 0.002, 520, 1.6, 0.46, 0.1)

  // Nothing in the chamber to stop the frame ringing.
  for (const [f, level] of [
    [1420, 0.05],
    [2180, 0.032],
  ] as const) {
    const ring = c.createOscillator()
    ring.type = 'sine'
    ring.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t + 0.004)
    g.gain.exponentialRampToValueAtTime(level, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
    ring.connect(g)
    send(g, 1.3)
    ring.start(t)
    ring.stop(t + 0.75)
  }

  // The breath the player has been holding.
  const breath = c.createBufferSource()
  breath.buffer = noiseBuffer(c, 1.0)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.9
  bp.frequency.setValueAtTime(900, t + 0.1)
  bp.frequency.exponentialRampToValueAtTime(260, t + 0.85)
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, t + 0.1)
  bg.gain.exponentialRampToValueAtTime(0.06, t + 0.24)
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  breath.connect(bp).connect(bg)
  send(bg, 0.5)
  breath.start(t + 0.1)
  breath.stop(t + 1.0)

  /*
   * Shallow and short. A deep duck here made the empty chamber read as a
   * hole in the music rather than as a thing that happened: measured against
   * the loudest bed, the window containing the click came out quieter than
   * the one before it. The swell afterwards is where the relief lives.
   */
  duckMusic(0.62, 0.035, 0.85, 1.26)
}

/**
 * Thumbing the hammer back: two ratchet steps into the sear, with the room
 * leaning in behind them. The rising tone is doing the work - a mechanism
 * that only clicks is a prop, one that pulls the pitch up with it is a
 * threat being cocked.
 */
export function playCock(): void {
  const c = ac()
  const t = c.currentTime
  tick(t, 1900, 2, 0.36, 0.045)
  tick(t + 0.088, 2600, 2.4, 0.46, 0.04)
  tick(t + 0.098, 900, 4, 0.22, 0.05)

  const lean = c.createOscillator()
  lean.type = 'sawtooth'
  lean.frequency.setValueAtTime(96, t)
  lean.frequency.exponentialRampToValueAtTime(188, t + 0.5)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 460
  lp.Q.value = 6
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.34)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62)
  lean.connect(lp).connect(g)
  send(g, 0.4)
  lean.start(t)
  lean.stop(t + 0.7)
}

/**
 * Black powder report, built in layers: the crack off the muzzle, the body
 * thump, a metallic cylinder ring, and the room tail from the convolver.
 */
export function playGunshot(): void {
  const c = ac()
  const t = c.currentTime

  // Nothing else gets to be loud for the next second and a half.
  duckMusic(0.1, 0.22, 1.5)

  /*
   * The first two milliseconds, unfiltered and flat out. Every other layer
   * here has an envelope that takes a moment to open; this one does not, and
   * it is the difference between a bang and a whump.
   */
  const snap = c.createBufferSource()
  snap.buffer = noiseBuffer(c, 0.02)
  const sg = c.createGain()
  sg.gain.setValueAtTime(1.3, t)
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.016)
  snap.connect(sg)
  send(sg, 0.35)
  snap.start(t)
  snap.stop(t + 0.03)

  const crack = c.createBufferSource()
  crack.buffer = noiseBuffer(c, 1.1)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(2400, t)
  hp.frequency.exponentialRampToValueAtTime(150, t + 0.4)
  const shaper = c.createWaveShaper()
  shaper.curve = softClip(3.2)
  const cg = c.createGain()
  cg.gain.setValueAtTime(1.35, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  crack.connect(hp).connect(shaper).connect(cg)
  send(cg, 1.5)
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

  /*
   * Below the thump, and slower. A black-powder charge in a small room moves
   * air for far longer than the crack lasts, and on a phone this is the part
   * that survives the speaker as pressure rather than as tone.
   */
  const heave = c.createOscillator()
  heave.type = 'sine'
  heave.frequency.setValueAtTime(74, t + 0.01)
  heave.frequency.exponentialRampToValueAtTime(21, t + 0.7)
  const shape = c.createWaveShaper()
  shape.curve = softClip(1.6)
  const hg = c.createGain()
  hg.gain.setValueAtTime(0.0001, t)
  hg.gain.exponentialRampToValueAtTime(0.95, t + 0.02)
  hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.95)
  heave.connect(shape).connect(hg)
  send(hg, 0.25)
  heave.start(t)
  heave.stop(t + 1.0)

  // The frame and cylinder ringing after the charge lets go.
  for (const f of [1840, 2470, 3310]) {
    const ring = c.createOscillator()
    ring.type = 'sine'
    ring.frequency.value = f * (0.99 + Math.random() * 0.02)
    const rg = c.createGain()
    rg.gain.setValueAtTime(0.0001, t)
    rg.gain.exponentialRampToValueAtTime(0.055, t + 0.008)
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    ring.connect(rg)
    send(rg, 1.2)
    ring.start(t)
    ring.stop(t + 0.6)
  }

  /*
   * The far wall answering. Straight into the convolver with no dry path, a
   * beat late, so the room is heard as distance rather than as a tail.
   */
  const slap = c.createBufferSource()
  slap.buffer = noiseBuffer(c, 0.9)
  const slapLp = c.createBiquadFilter()
  slapLp.type = 'lowpass'
  slapLp.frequency.value = 1400
  const slapG = c.createGain()
  slapG.gain.setValueAtTime(0.0001, t + 0.045)
  slapG.gain.exponentialRampToValueAtTime(0.4, t + 0.07)
  slapG.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  slap.connect(slapLp).connect(slapG)
  slapG.connect(reverbIn())
  slap.start(t + 0.045)
  slap.stop(t + 0.95)
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

/**
 * Two dull thuds, played the moment before a trigger is pulled on a cylinder
 * that is more likely than not to be loaded. Deliberately rare: it is the
 * game's only first-person sound and it stops meaning anything if it is on
 * every hand.
 */
export function playHeartbeat(): void {
  const c = ac()
  const t = c.currentTime
  for (const [at, peak] of [
    [0, 0.62],
    [0.3, 0.44],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(62, t + at)
    o.frequency.exponentialRampToValueAtTime(30, t + at + 0.18)
    const shape = c.createWaveShaper()
    shape.curve = softClip(1.5)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t + at)
    g.gain.exponentialRampToValueAtTime(peak, t + at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.3)
    o.connect(shape).connect(g)
    send(g, 0.2)
    o.start(t + at)
    o.stop(t + at + 0.36)
  }
  // Just enough room for it, without the score losing its place.
  duckMusic(0.62, 0.18, 0.6)
}

/**
 * Win and loss stingers, so a settled hand lands without reading text.
 *
 * Both sit on a low note struck at the same instant as the first of the
 * three, which is what stops them sounding like a phone notification: the
 * arpeggio is the announcement, the root underneath is the weight.
 */
export function playSting(win: boolean): void {
  const c = ac()
  const t = c.currentTime
  duckMusic(0.22, 0.24, 1.0, win ? 1.18 : 1)

  const root = c.createOscillator()
  root.type = win ? 'triangle' : 'sawtooth'
  root.frequency.setValueAtTime(win ? 98 : 82.4, t)
  if (!win) root.frequency.exponentialRampToValueAtTime(55, t + 1.3)
  const rootLp = c.createBiquadFilter()
  rootLp.type = 'lowpass'
  rootLp.frequency.value = win ? 700 : 420
  const rootG = c.createGain()
  rootG.gain.setValueAtTime(0.0001, t)
  rootG.gain.exponentialRampToValueAtTime(win ? 0.34 : 0.4, t + 0.03)
  rootG.gain.exponentialRampToValueAtTime(0.0001, t + (win ? 1.3 : 1.8))
  root.connect(rootLp).connect(rootG)
  send(rootG, 0.8)
  root.start(t)
  root.stop(t + (win ? 1.4 : 1.9))

  // Losing gets the tritone; winning gets the fifth.
  const notes = win ? [196, 293.66, 392] : [175, 123.47, 116.54]
  notes.forEach((f, i) => {
    const at = t + i * (win ? 0.115 : 0.16)
    const o = c.createOscillator()
    o.type = win ? 'triangle' : 'sawtooth'
    o.frequency.value = f
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(win ? 0.2 : 0.16, at + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9)
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = win ? 2400 : 900
    o.connect(lp).connect(g)
    send(g, 1.1)
    o.start(at)
    o.stop(at + 0.95)
  })

  // A win rings; a loss thuds.
  if (win) {
    for (const [ratio, level] of [
      [1, 0.09],
      [2.76, 0.035],
    ] as const) {
      const bell = c.createOscillator()
      bell.type = 'sine'
      bell.frequency.value = 784 * ratio
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t + 0.23)
      g.gain.exponentialRampToValueAtTime(level, t + 0.245)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
      bell.connect(g)
      send(g, 1.5)
      bell.start(t + 0.23)
      bell.stop(t + 2.3)
    }
  } else {
    tick(t, 220, 1.1, 0.34, 0.3)
  }
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
