import { ac, musicBus, noiseBuffer, pianoBus, reverbIn, stopThePiano } from './engine'

/*
 * The upright in the corner. NOT a score.
 *
 * The sound of this table is the room and the machine. This file is one more
 * thing the room is doing, at the level of the glasses and the boots, and the
 * distinction is load-bearing rather than a matter of taste: a soundtrack is
 * something the player is outside of, and the whole point of the picture is
 * that they are sitting in the bar.
 *
 * Three things keep it furniture. It is on its own bus behind a low-pass at a
 * level measured to sit UNDER the ambience rather than over it (engine.ts).
 * What it plays is the oldest turnaround in the room - I - VI7 - II7 - V7 in
 * G, stride left hand - which is a cadence and not anybody's tune. And the
 * right hand comes and goes: somebody is playing, not something is playing.
 *
 * Every note is synthesised, so there is still not one audio file in this
 * project. The instrument is a badly kept saloon piano: a struck string is a
 * handful of slightly stretched partials with a hammer thump on the front, and
 * the thing that makes it a SALOON piano rather than a piano is that each note
 * is a fixed few cents out and never gets tuned.
 */

const BPM = 96
const STEPS = 16
const LOOKAHEAD = 0.2
const TICK_MS = 45

/** G - E7 - A7 - D7. One bar each. */
const BARS = [
  { root: 98.0, chord: [196.0, 246.94, 293.66] }, // G
  { root: 82.41, chord: [207.65, 246.94, 329.63] }, // E7
  { root: 110.0, chord: [220.0, 277.18, 329.63] }, // A7
  { root: 73.42, chord: [220.0, 293.66, 369.99] }, // D7
]

/** The right hand, in sixteenths across the four bars. Syncopated, barely. */
const TUNE: { at: number; semi: number }[] = [
  { at: 0, semi: 7 }, { at: 3, semi: 11 }, { at: 6, semi: 14 }, { at: 10, semi: 12 },
  { at: 16, semi: 11 }, { at: 19, semi: 8 }, { at: 22, semi: 11 }, { at: 26, semi: 7 },
  { at: 32, semi: 9 }, { at: 35, semi: 12 }, { at: 38, semi: 16 }, { at: 42, semi: 14 },
  { at: 48, semi: 13 }, { at: 51, semi: 11 }, { at: 54, semi: 9 }, { at: 58, semi: 7 },
]

/** How far each pitch class has drifted, in cents. Fixed, because it is one piano. */
const DETUNE = [0, -13, 8, -21, 5, 17, -9, 11, -17, 3, 22, -6]

let timer = 0
let step = 0
let nextAt = 0
let intensity = 0
/** Whether he is playing the tune this time round, or only comping. */
let playing = false
let drone: { osc: OscillatorNode; gain: GainNode } | null = null

const semitone = (base: number, n: number) => base * 2 ** (n / 12)

/** One hammer, one string, one decay. */
function strike(at: number, freq: number, gain: number, seconds: number): void {
  const c = ac()
  const out = pianoBus()
  const cents = DETUNE[Math.round(12 * Math.log2(freq / 27.5)) % 12] ?? 0
  const f = freq * 2 ** (cents / 1200)

  /* Real strings are stretched: the partials run sharp of the harmonics, which
   * is most of why a piano sounds like wire under tension and not like an organ. */
  const partials = [1, 2.003, 3.01, 4.02, 5.04, 6.08]
  const levels = [1, 0.42, 0.24, 0.12, 0.07, 0.04]
  partials.forEach((p, i) => {
    if (f * p > 9000) return
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = f * p
    const g = c.createGain()
    const decay = seconds / (1 + i * 0.7)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain * levels[i], at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + decay + 0.05)
  })

  // The felt hitting the wire, which is the attack you actually hear.
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = Math.min(6000, f * 5)
  bp.Q.value = 0.8
  const hg = c.createGain()
  hg.gain.setValueAtTime(gain * 0.5, at)
  hg.gain.exponentialRampToValueAtTime(0.0001, at + 0.035)
  s.connect(bp).connect(hg).connect(out)
  s.start(at, Math.random())
  s.stop(at + 0.08)
}

function schedule(at: number, i: number): void {
  const bar = Math.floor(i / STEPS) % BARS.length
  const beat = i % STEPS
  const { root, chord } = BARS[bar]
  // Quieter as the room gets interested in you: it is the same room, listening.
  const level = 0.5 - intensity * 0.34

  // Stride: bass on one and three, the chord answering on two and four.
  if (beat === 0 || beat === 8) strike(at, root, 0.13 * level, 1.5)
  if (beat === 4 || beat === 12) {
    chord.forEach((f, n) => strike(at + n * 0.006, f, 0.055 * level, 0.8))
  }
  // The right hand drops out first when the room goes quiet.
  if (playing && intensity < 0.72) {
    const note = TUNE.find((t) => t.at === i % (STEPS * 4))
    if (note) strike(at, semitone(392.0, note.semi - 7), 0.075 * level * (1 - intensity * 0.6), 1.1)
  }
}

function tick(): void {
  const c = ac()
  const spb = 60 / BPM / 4
  while (nextAt < c.currentTime + LOOKAHEAD) {
    schedule(nextAt, step)
    step = (step + 1) % (STEPS * 4)
    /* At the top of each turnaround, decide whether he carries on with the
     * melody or just comps for a while. A right hand that never stops is the
     * single thing that makes this read as a soundtrack instead of as a man
     * at a piano, and it costs one line to fix. */
    if (step === 0) playing = Math.random() < 0.45
    nextAt += spb
  }
}

export function startMusic(): void {
  if (timer) return
  const c = ac()
  nextAt = c.currentTime + 0.1
  step = 0
  timer = window.setInterval(tick, TICK_MS)
}

export function stopMusic(): void {
  window.clearInterval(timer)
  timer = 0
  if (drone) {
    const c = ac()
    drone.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6)
    drone.osc.stop(c.currentTime + 0.8)
    drone = null
  }
}

/**
 * 0 to 1. What it is driven by on this table is the room's attention, not the
 * odds - because the odds here never change, and that is the point of the
 * table. The piano thins out and a low string comes up under the floor.
 */
export function setIntensity(next: number): void {
  intensity = Math.max(0, Math.min(1, next))
  if (!timer) return
  const c = ac()
  if (intensity > 0.3 && !drone) {
    const osc = c.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 49.0
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 220
    const gain = c.createGain()
    gain.gain.value = 0.0001
    osc.connect(lp).connect(gain).connect(musicBus())
    const room = c.createGain()
    room.gain.value = 0.5
    gain.connect(room).connect(reverbIn())
    osc.start()
    drone = { osc, gain }
  }
  if (drone) {
    drone.gain.gain.linearRampToValueAtTime(Math.max(0.0001, (intensity - 0.3) * 0.075), c.currentTime + 1.2)
  }
}

/** Something happened and the piano stopped. */
export const pianoStops = (seconds: number) => stopThePiano(seconds)
