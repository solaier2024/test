/**
 * All sound is synthesised at runtime so the prototype ships no audio files.
 * A production build would swap these for recorded foley behind the same API.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)
  }
  return ctx
}

function out(): GainNode {
  ac()
  return master as GainNode
}

export function unlockAudio(): void {
  const c = ac()
  if (c.state === 'suspended') void c.resume()
}

export function setVolume(v: number): void {
  out().gain.value = v
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/** Dry hammer fall on an empty chamber: a hard mechanical tick. */
export function playClick(): void {
  const c = ac()
  const t = c.currentTime
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 0.06)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2600
  bp.Q.value = 1.4
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  src.connect(bp).connect(g).connect(out())
  src.start(t)
  src.stop(t + 0.08)
}

/** Full black-powder report: body thump, crack, and a long room tail. */
export function playGunshot(): void {
  const c = ac()
  const t = c.currentTime

  const crack = c.createBufferSource()
  crack.buffer = noiseBuffer(c, 0.9)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(1800, t)
  hp.frequency.exponentialRampToValueAtTime(180, t + 0.35)
  const cg = c.createGain()
  cg.gain.setValueAtTime(1.0, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.75)
  crack.connect(hp).connect(cg).connect(out())
  crack.start(t)
  crack.stop(t + 0.9)

  const thump = c.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(140, t)
  thump.frequency.exponentialRampToValueAtTime(32, t + 0.22)
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.9, t)
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
  thump.connect(tg).connect(out())
  thump.start(t)
  thump.stop(t + 0.4)
}

/** Cylinder spin: a run of ratchet ticks that slows to a stop. */
export function playSpin(): void {
  const c = ac()
  let t = c.currentTime
  let gap = 0.035
  for (let i = 0; i < 16; i++) {
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c, 0.03)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200 - i * 60
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025)
    src.connect(bp).connect(g).connect(out())
    src.start(t)
    src.stop(t + 0.04)
    t += gap
    gap *= 1.11
  }
}

/** Chips pushed across wood. */
export function playChips(): void {
  const c = ac()
  const t = c.currentTime
  for (let i = 0; i < 5; i++) {
    const at = t + i * 0.035 + Math.random() * 0.02
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c, 0.05)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1400 + Math.random() * 1600
    bp.Q.value = 3
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.22, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
    src.connect(bp).connect(g).connect(out())
    src.start(at)
    src.stop(at + 0.07)
  }
}

/** Hammer being thumbed back before a shot. */
export function playCock(): void {
  const c = ac()
  const t = c.currentTime
  for (let i = 0; i < 2; i++) {
    const at = t + i * 0.09
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c, 0.04)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900 + i * 700
    bp.Q.value = 2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
    src.connect(bp).connect(g).connect(out())
    src.start(at)
    src.stop(at + 0.06)
  }
}

let ambienceStarted = false

/** Low room tone plus a slow crackle so the saloon never sounds dead. */
export function startAmbience(): void {
  if (ambienceStarted) return
  ambienceStarted = true
  const c = ac()

  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 4)
  src.loop = true
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 340
  const g = c.createGain()
  g.gain.value = 0.05
  src.connect(lp).connect(g).connect(out())
  src.start()

  const tick = () => {
    if (!ctx) return
    const at = ctx.currentTime
    const s = ctx.createBufferSource()
    s.buffer = noiseBuffer(ctx, 0.05)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900 + Math.random() * 1800
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.0001, at)
    cg.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.04, at + 0.004)
    cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
    s.connect(bp).connect(cg).connect(out())
    s.start(at)
    s.stop(at + 0.08)
    window.setTimeout(tick, 600 + Math.random() * 2600)
  }
  window.setTimeout(tick, 1200)
}
