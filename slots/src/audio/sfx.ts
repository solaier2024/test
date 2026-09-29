import { ac, duck, noiseBuffer, reverbIn, sfxBus, softClip } from './engine'

/*
 * The machine. Iron, springs, and coins, all synthesised and all sent through
 * the same room the crowd is standing in - a dry click over a picture with a
 * room in it is worse than no sound at all.
 *
 * The only sound in here that is doing a job rather than dressing the picture
 * is reelStop(): the third one has to land hard enough to be the full stop at
 * the end of a pull, because that is the instant the room reacts to.
 */

function bus(send = 0.3): GainNode {
  const c = ac()
  const g = c.createGain()
  g.connect(sfxBus())
  const room = c.createGain()
  room.gain.value = send
  g.connect(room).connect(reverbIn())
  return g
}

function burst(o: {
  at?: number
  freq: number
  q: number
  gain: number
  attack?: number
  decay: number
  type?: BiquadFilterType
  send?: number
}): void {
  const c = ac()
  const at = o.at ?? c.currentTime
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.value = o.freq
  f.Q.value = o.q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(o.gain, at + (o.attack ?? 0.003))
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.decay)
  s.connect(f).connect(g).connect(bus(o.send))
  s.start(at, Math.random() * 1.4)
  s.stop(at + o.decay + 0.05)
}

function tone(o: {
  at?: number
  freq: number
  to?: number
  gain: number
  decay: number
  type?: OscillatorType
  send?: number
}): void {
  const c = ac()
  const at = o.at ?? c.currentTime
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, at)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.decay)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(o.gain, at + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.decay)
  osc.connect(g).connect(bus(o.send ?? 0.28))
  osc.start(at)
  osc.stop(at + o.decay + 0.05)
}

/**
 * The arm coming down: a ratchet paying out faster and faster as the spring
 * winds, then the clutch letting go at the bottom.
 */
export function leverPull(): void {
  const c = ac()
  const now = c.currentTime
  const teeth = 16
  for (let i = 0; i < teeth; i++) {
    // Quadratic spacing, so the ratchet accelerates the way an arm does.
    const t = now + 0.34 * (1 - (1 - i / teeth) ** 2)
    burst({ at: t, freq: 2600 + i * 60, q: 5.5, gain: 0.05, decay: 0.028, send: 0.18 })
  }
  tone({ at: now + 0.35, freq: 190, to: 74, gain: 0.1, decay: 0.16, type: 'triangle' })
  burst({ at: now + 0.35, freq: 420, q: 1.1, gain: 0.07, decay: 0.12 })
  duck(0.14, 0.15, 0.5)
}

/** The arm swinging back up under its spring. */
export function leverReturn(): void {
  const c = ac()
  tone({ at: c.currentTime, freq: 320, to: 620, gain: 0.035, decay: 0.2, type: 'triangle', send: 0.2 })
  burst({ at: c.currentTime + 0.19, freq: 1500, q: 3, gain: 0.05, decay: 0.05 })
}

/** One stop going past the window. Called from the reel loop, not scheduled. */
export function reelTick(speed: number): void {
  burst({ freq: 1500 + speed * 26, q: 6, gain: 0.014 + speed * 0.0008, decay: 0.022, send: 0.1 })
}

/**
 * A band coming to rest. The index makes the last one the heaviest, because it
 * is the one the room is holding its breath for.
 */
export function reelStop(index: number): void {
  const weight = 1 + index * 0.55
  tone({ freq: 150 - index * 14, to: 58, gain: 0.075 * weight, decay: 0.16, type: 'triangle' })
  burst({ freq: 900 + index * 120, q: 2.2, gain: 0.07 * weight, decay: 0.07 })
  burst({ freq: 3400, q: 4, gain: 0.03 * weight, decay: 0.03, send: 0.16 })
  if (index === 2) duck(0.2, 0.1, 0.5)
}

/** Coins into the iron cup. Not a chip: this one rings. */
export function payoutCoins(count: number): void {
  const c = ac()
  const n = Math.min(26, Math.max(2, count))
  for (let i = 0; i < n; i++) {
    const at = c.currentTime + 0.05 + i * (0.055 + Math.random() * 0.05)
    const f = 1750 + Math.random() * 1400
    tone({ at, freq: f, gain: 0.05, decay: 0.24, type: 'sine', send: 0.45 })
    tone({ at, freq: f * 2.76, gain: 0.02, decay: 0.16, type: 'sine', send: 0.45 })
    burst({ at, freq: 5200, q: 3, gain: 0.03, decay: 0.03, send: 0.3 })
  }
  duck(0.16, 0.2 + n * 0.02, 0.8)
}

/**
 * The bell on top of the machine. Struck bronze is not harmonic, so the partial
 * ratios here are the inharmonic ones a real bell has - that ratio set is the
 * entire difference between a bell and a beep.
 */
export function libertyBell(strikes = 3): void {
  const c = ac()
  const partials = [1, 2.0, 2.4, 3.0, 4.5, 5.33]
  const levels = [1, 0.5, 0.62, 0.38, 0.22, 0.14]
  for (let s = 0; s < strikes; s++) {
    const at = c.currentTime + s * 0.42
    const f0 = 620 * (s === 0 ? 1 : 1.002)
    partials.forEach((p, i) => {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f0 * p * (1 + (Math.random() - 0.5) * 0.004)
      const g = c.createGain()
      const decay = 2.2 / (1 + i * 0.55)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.linearRampToValueAtTime(0.05 * levels[i], at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
      o.connect(g).connect(bus(0.6))
      o.start(at)
      o.stop(at + decay + 0.05)
    })
    burst({ at, freq: 4200, q: 1.4, gain: 0.05, decay: 0.05, send: 0.5 })
  }
  duck(0.34, 0.5, 1.4)
}

/** A coin going in. One input, one coin, every time. */
export function coinIn(): void {
  const c = ac()
  tone({ at: c.currentTime, freq: 2400, gain: 0.04, decay: 0.1, send: 0.3 })
  burst({ at: c.currentTime + 0.07, freq: 1800, q: 4, gain: 0.04, decay: 0.05 })
  tone({ at: c.currentTime + 0.1, freq: 700, to: 300, gain: 0.03, decay: 0.12, type: 'triangle' })
}

/** The iron going quiet for the night, when the room shuts it down. */
export function shutDown(): void {
  const c = ac()
  const shaped = softClip(c, 2.0)
  shaped.connect(bus(0.7))
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(150, c.currentTime)
  o.frequency.exponentialRampToValueAtTime(42, c.currentTime + 1.4)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, c.currentTime)
  g.gain.linearRampToValueAtTime(0.14, c.currentTime + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.6)
  o.connect(g).connect(shaped)
  o.start()
  o.stop(c.currentTime + 1.7)
  burst({ freq: 300, q: 0.6, gain: 0.1, decay: 0.7, send: 0.8 })
}

export function click(): void {
  burst({ freq: 1800, q: 4, gain: 0.05, decay: 0.035, send: 0.12 })
}

/** A notch cut into the bar rail: one more pull counted. */
export function notch(): void {
  burst({ freq: 3200, q: 7, gain: 0.03, decay: 0.05, send: 0.2 })
}
