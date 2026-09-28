import { ac, duck, noiseBuffer, reverbIn, sfxBus, softClip } from './engine'

/*
 * Table sounds, synthesised. Every one of them is sent through the same room
 * convolution the score uses, because a dry click over a picture with a room in
 * it is worse than no sound at all.
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

function burst(opts: {
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
  const at = opts.at ?? c.currentTime
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = opts.type ?? 'bandpass'
  f.frequency.value = opts.freq
  f.Q.value = opts.q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(opts.gain, at + (opts.attack ?? 0.004))
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)
  s.connect(f).connect(g).connect(bus(opts.send))
  s.start(at, Math.random() * 1.4)
  s.stop(at + opts.decay + 0.05)
}

function tone(opts: { at?: number; freq: number; to?: number; gain: number; decay: number; type?: OscillatorType }): void {
  const c = ac()
  const at = opts.at ?? c.currentTime
  const o = c.createOscillator()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(opts.freq, at)
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, at + opts.decay)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(opts.gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)
  o.connect(g).connect(bus(0.25))
  o.start(at)
  o.stop(at + opts.decay + 0.05)
}

/** A card whisked across baize: broadband, soft, no click. */
export function cardSlide(): void {
  burst({ freq: 2600, q: 0.7, gain: 0.1, attack: 0.03, decay: 0.16, send: 0.22 })
  burst({ freq: 700, q: 0.9, gain: 0.05, attack: 0.04, decay: 0.2, send: 0.3 })
}

/** A card turned over: one sharp edge, then the felt. */
export function cardFlip(): void {
  burst({ freq: 3800, q: 1.6, gain: 0.13, decay: 0.07 })
  burst({ freq: 1200, q: 0.8, gain: 0.07, attack: 0.012, decay: 0.12 })
  duck(0.08, 0.12, 0.5)
}

/** Clay chips: a couple of bodies knocking, not a coin. */
export function chips(n = 3): void {
  const c = ac()
  for (let i = 0; i < n; i++) {
    const at = c.currentTime + i * (0.018 + Math.random() * 0.02)
    burst({ at, freq: 2200 + Math.random() * 700, q: 2.4, gain: 0.085, decay: 0.06 })
    tone({ at, freq: 420 + Math.random() * 90, gain: 0.03, decay: 0.05, type: 'triangle' })
  }
  duck(0.06, 0.1, 0.4)
}

/** The shoe: wood, a spring, and a card leaving. */
export function shoeClick(): void {
  burst({ freq: 900, q: 3.2, gain: 0.08, decay: 0.05 })
  tone({ freq: 240, to: 150, gain: 0.05, decay: 0.07, type: 'triangle' })
}

/** The riffle. Long, and the only sound that says a new shoe is coming. */
export function riffle(seconds = 1.2): void {
  const c = ac()
  const n = Math.round(seconds * 34)
  for (let i = 0; i < n; i++) {
    const t = i / n
    burst({
      at: c.currentTime + t * seconds + (Math.random() - 0.5) * 0.008,
      freq: 2400 + Math.sin(t * Math.PI) * 1400,
      q: 1.1,
      gain: 0.035 + Math.sin(t * Math.PI) * 0.03,
      decay: 0.035,
      send: 0.28,
    })
  }
}

/**
 * Her hands giving something away. Deliberately faint and short - it is a
 * corroborating signal, never the readout, because the visual flicker has to
 * stand on its own for a muted or deaf player.
 */
export function tellWhisper(): void {
  burst({ freq: 5200, q: 3.4, gain: 0.055, attack: 0.008, decay: 0.09, send: 0.15 })
}

/** You say it out loud, and the room goes quiet. */
export function callOut(): void {
  const c = ac()
  const shaped = softClip(c, 2.6)
  shaped.connect(bus(0.55))
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(180, c.currentTime)
  o.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.5)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, c.currentTime)
  g.gain.linearRampToValueAtTime(0.16, c.currentTime + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6)
  o.connect(g).connect(shaped)
  o.start()
  o.stop(c.currentTime + 0.65)
  burst({ freq: 1400, q: 0.6, gain: 0.1, decay: 0.25, send: 0.6 })
}

/** Leaning over her hands: the room narrows. */
export function leanIn(on: boolean): void {
  burst({ freq: on ? 320 : 520, q: 0.7, gain: 0.05, attack: 0.05, decay: on ? 0.4 : 0.22, send: 0.4 })
}

export function sting(good: boolean): void {
  const c = ac()
  const notes = good ? [293.66, 349.23, 440] : [293.66, 277.18, 233.08]
  notes.forEach((f, i) => {
    tone({ at: c.currentTime + i * 0.075, freq: f, gain: 0.07, decay: 0.5, type: 'triangle' })
  })
  duck(0.12, 0.2, 0.7)
}

export function click(): void {
  burst({ freq: 1800, q: 4, gain: 0.05, decay: 0.035, send: 0.12 })
}
