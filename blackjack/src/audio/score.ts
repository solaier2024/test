import { ac, musicBus, noiseBuffer, pianoBus, reverbIn, softClip } from './engine'

/*
 * The score, synthesised in the browser. Nothing here is a recording.
 *
 * The first cut of this was a habanera vamp nailed to a single chord: correct on
 * paper, and it came out sounding like a hotel lobby. A cantina on the border at
 * midnight is not ambient, it is a band in the corner playing loud enough that
 * you have to lean in to be heard - so this is norteño: an oom-pah bajo sexto,
 * a button accordion stabbing the offbeats, a guitar rasgueado underneath, and
 * palmas and claves pushed forward instead of buried in the room.
 *
 * Two things from the first version survive because they are load-bearing:
 *
 * 1. THE THIRD FOLLOWS WHAT SHE SHOWS, NEVER WHAT SHE HOLDS. It is a bigger
 *    gesture now - the whole tonic flips between D minor and D major rather than
 *    one note moving - but it is still bound to `shown`, so the music is part of
 *    her performance and exactly as reliable as she is.
 * 2. THE SHUFFLE IS THE SEAM. Her shuffle turns the phrase over, so the form is
 *    longer than what is written and every reset has a reason on screen.
 *
 * Reverb sends are deliberately small on the rhythm section. The previous mix
 * put everything into a 1.35s room, which is what made it sound distant.
 */

export type Cue = 'none' | 'intro' | 'title' | 'table'

/** Sixteenths per bar times four bars: one phrase. */
const STEPS = 64
const LOOKAHEAD = 0.22
const TICK_MS = 40

const FLOOR: Record<Exclude<Cue, 'none' | 'intro'>, { bpm: number; floor: number }> = {
  // Still a band, just one taking it easy while you decide which table to sit at.
  title: { bpm: 96, floor: 0.3 },
  // Polka tempo. The old 72 was the single biggest reason it sounded polite.
  table: { bpm: 116, floor: 0.52 },
}

/* --------------------------------------------------------------- harmony */

const D2 = 73.42
const D3 = 146.83
const A2 = 110.0
const G2 = 98.0

/** i - i - iv - V7 in D. The tonic's quality is the one thing she can move. */
interface Chord {
  /** Bass root, low octave. */
  root: number
  /** The fifth the oom-pah answers with. */
  fifth: number
  /** Semitones above the root for the chord tones the accordion stabs. */
  tones: number[]
  /** True when this bar is the tonic, and therefore hers to colour. */
  tonic: boolean
}

function progression(major: boolean): Chord[] {
  const third = major ? 4 : 3
  return [
    { root: D2, fifth: A2, tones: [0, third, 7], tonic: true },
    { root: D2, fifth: A2, tones: [0, third, 7], tonic: true },
    { root: G2, fifth: D2 * 2, tones: [0, major ? 4 : 3, 7], tonic: false },
    // The dominant is always major, and its C# is the note that pulls home.
    { root: A2, fifth: D3, tones: [0, 4, 7, 10], tonic: false },
  ]
}

/**
 * The accordion line, in sixteenths across the phrase: semitones above D3, or
 * null for a rest. Written in the norteño habit of running up to the beat and
 * sitting on a chord tone, and it is doubled a third below when the shoe is warm,
 * which is the parallel-thirds sound the style is known for.
 */
const LINE: (number | null)[] = [
  // bar 1
  null, null, 0, null, 2, null, 3, null, 5, null, null, 3, 2, null, 0, null,
  // bar 2
  null, null, 5, null, 7, null, 5, null, 3, null, 2, null, 0, null, null, null,
  // bar 3 - over the iv
  null, null, 10, null, 8, null, 7, null, 5, null, null, 7, 8, null, 7, null,
  // bar 4 - over the V7, leaning on the leading note
  null, null, 4, null, 5, null, 7, null, 5, null, 4, null, 2, null, 1, null,
]

/* ---------------------------------------------------------------- voices */

interface Voice {
  bus: GainNode
  room: GainNode
  held: { node: AudioScheduledSourceNode; until: number }[]
}

function voice(gain = 1, send = 0.12, toPiano = false): Voice {
  const c = ac()
  const bus = c.createGain()
  bus.gain.value = gain
  bus.connect(toPiano ? pianoBus() : musicBus())
  const room = c.createGain()
  room.gain.value = send
  bus.connect(room).connect(reverbIn())
  return { bus, room, held: [] }
}

const keep = (v: Voice, node: AudioScheduledSourceNode, until: number) => v.held.push({ node, until })

function prune(v: Voice, now: number): void {
  v.held = v.held.filter((h) => {
    if (h.until > now) return true
    try {
      h.node.stop()
    } catch {
      /* already done */
    }
    return false
  })
}

function release(v: Voice, seconds = 0.4): void {
  const c = ac()
  v.bus.gain.cancelScheduledValues(c.currentTime)
  v.bus.gain.setValueAtTime(v.bus.gain.value, c.currentTime)
  v.bus.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds)
  v.room.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds * 1.5)
  for (const h of v.held) {
    try {
      h.node.stop(c.currentTime + seconds + 0.1)
    } catch {
      /* already done */
    }
  }
}

function place(v: Voice, node: AudioNode, pan: number): void {
  const c = ac()
  const p = c.createStereoPanner()
  p.pan.value = pan
  node.connect(p).connect(v.bus)
}

/**
 * Button accordion. Three reeds a few cents apart - at 8 to 14 cents the beating
 * lands around 1.2 to 1.4 Hz on A3, which is where the warmth comes from. The
 * filter sits much higher than it used to: this instrument is supposed to be the
 * loudest thing in a cantina, not a pad.
 */
function accordion(v: Voice, at: number, f: number, len: number, gain: number, bite = 1): void {
  const c = ac()
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.linearRampToValueAtTime(gain, at + 0.012 / bite)
  out.gain.setValueAtTime(gain, at + len * 0.7)
  out.gain.linearRampToValueAtTime(0.0001, at + len)

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 4200
  lp.Q.value = 1.1
  // A little presence peak where a reed actually lives.
  const peak = c.createBiquadFilter()
  peak.type = 'peaking'
  peak.frequency.value = 2100
  peak.Q.value = 0.9
  peak.gain.value = 5

  for (const cents of [0, 12, -8]) {
    const o = c.createOscillator()
    o.type = cents === 0 ? 'sawtooth' : 'square'
    o.frequency.value = f * 2 ** (cents / 1200)
    const g = c.createGain()
    g.gain.value = cents === 0 ? 0.5 : 0.26
    o.connect(g).connect(lp)
    o.start(at)
    o.stop(at + len + 0.04)
    keep(v, o, at + len)
  }
  lp.connect(peak).connect(out)
  place(v, out, -0.16)
}

/** Bajo sexto: the oom and the pah. Short, thick, and right up front. */
function bajo(v: Voice, at: number, f: number, gain: number, len: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(f * 1.02, at)
  o.frequency.exponentialRampToValueAtTime(f, at + 0.03)
  const shape = softClip(c, 2.4)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(shape).connect(lp).connect(g)
  place(v, g, 0)
  o.start(at)
  o.stop(at + len + 0.02)
  keep(v, o, at + len)
}

/**
 * Guitar rasgueado. Not a chord: five or six strings struck in a fast sweep, each
 * a few milliseconds and a few cents off the last. The sweep is what gives the
 * offbeat its body, and it is the sound the old arrangement had no answer for.
 */
function rasgueado(v: Voice, at: number, root: number, tones: number[], gain: number, down = true): void {
  const c = ac()
  const strings = [0, 12, 19, 24, 28, 31].map((s, i) => ({
    f: root * 2 ** ((s + tones[i % tones.length]) / 12),
    i,
  }))
  const order = down ? strings : strings.slice().reverse()
  order.forEach(({ f }, n) => {
    const t = at + n * 0.011 + (Math.random() - 0.5) * 0.003
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f * 2 ** (((Math.random() - 0.5) * 9) / 1200)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = Math.min(6000, f * 2.6)
    bp.Q.value = 1.6
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain * (0.7 + n * 0.06), t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(bp).connect(g)
    place(v, g, 0.24)
    o.start(t)
    o.stop(t + 0.2)
    keep(v, o, t + 0.2)
  })
}

/** Palmas, up front. Hands are never quite together, hence the jitter. */
function palma(v: Voice, at: number, gain: number): void {
  const c = ac()
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1750
  bp.Q.value = 1.1
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 600
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
  s.connect(bp).connect(hp).connect(g)
  place(v, g, 0.36)
  s.start(at, Math.random() * 1.2)
  s.stop(at + 0.09)
  keep(v, s, at + 0.09)
}

/** Claves: two sticks, dry and dead centre, no room at all. */
function clave(v: Voice, at: number, gain: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(2550, at)
  o.frequency.exponentialRampToValueAtTime(2050, at + 0.03)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  o.connect(g)
  place(v, g, -0.3)
  o.start(at)
  o.stop(at + 0.07)
  keep(v, o, at + 0.07)
}

/** Tambora: a rope-tuned drum. A thud and a rim, nothing in between. */
function tambora(v: Voice, at: number, rim: boolean, gain: number): void {
  const c = ac()
  if (rim) {
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3100
    bp.Q.value = 0.9
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
    s.connect(bp).connect(g)
    place(v, g, 0.1)
    s.start(at, Math.random())
    s.stop(at + 0.1)
    keep(v, s, at + 0.1)
    return
  }
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, at)
  o.frequency.exponentialRampToValueAtTime(52, at + 0.11)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
  o.connect(g)
  place(v, g, 0)
  o.start(at)
  o.stop(at + 0.2)
  keep(v, o, at + 0.2)
}

/** Wordless voice, through two formants. Used for the grito and for her line. */
export function hum(v: Voice, at: number, f: number, len: number, gain: number, rise = 0): void {
  const c = ac()
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.linearRampToValueAtTime(gain, at + len * 0.18)
  out.gain.setValueAtTime(gain, at + len * 0.62)
  out.gain.linearRampToValueAtTime(0.0001, at + len)
  for (const hz of [780, 1240]) {
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = 6
    bp.connect(out)
    for (const det of [-7, 0, 8]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f * 2 ** (det / 1200), at)
      if (rise) o.frequency.linearRampToValueAtTime(f * 2 ** ((det + rise) / 1200), at + len * 0.8)
      const g = c.createGain()
      g.gain.value = 0.2
      o.connect(g).connect(bp)
      o.start(at)
      o.stop(at + len + 0.04)
      keep(v, o, at + len)
    }
  }
  place(v, out, -0.22)
}

/** Glass: the same three inharmonic partials a death bell uses, taken up and cut short. */
export function glass(at: number, gain = 0.09): void {
  const c = ac()
  const v = voice(1, 0.4)
  for (const [ratio, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.25]] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = 2600 * ratio
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain * amp, at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
    o.connect(g).connect(v.bus)
    o.start(at)
    o.stop(at + 0.4)
  }
  setTimeout(() => release(v, 0.2), 700)
}

/**
 * A grito. The whoop somebody in the corner lets out when the band lands a turn
 * around, and the single most border-sounding thing in the file. Saved for wins.
 */
export function grito(): void {
  const c = ac()
  const v = voice(1, 0.34)
  const at = c.currentTime + 0.02
  hum(v, at, 330, 0.9, 0.1, 900)
  hum(v, at + 0.42, 494, 0.7, 0.075, -500)
  setTimeout(() => release(v, 0.5), 1800)
}

function pianoNote(v: Voice, at: number, f: number, gain: number): void {
  const c = ac()
  for (const [mult, amp, det] of [[1, 1, 0], [2, 0.3, 9], [3, 0.12, -14]] as const) {
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.value = f * mult * 2 ** (det / 1200)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain * amp, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)
    o.connect(g).connect(v.bus)
    o.start(at)
    o.stop(at + 1.2)
    keep(v, o, at + 1.2)
  }
}

/* --------------------------------------------------------------- the band */

let cue: Cue = 'none'
let band: Voice | null = null
let piano: Voice | null = null
let timer: number | null = null
let step = 0
let nextAt = 0
let phrase = 0
let interlude = false
let seed = 1

let edgeP = 0
let heatP = 0
let warmthP = 0.5

function rnd(): number {
  seed = (seed * 1103515245 + 12345) >>> 0
  return seed / 4294967296
}

const stepSeconds = (bpm: number) => 15 / bpm

function level(): number {
  if (cue === 'none' || cue === 'intro') return 0
  const { floor } = FLOOR[cue]
  return Math.min(1, floor + edgeP * (1 - floor))
}

/** Major when she is being warm about it. This is the third, still bound to `shown`. */
const isMajor = () => warmthP >= 0.6

export const currentThird = () => (isMajor() ? 185.0 : 174.61)

function scheduleStep(v: Voice, s: number, at: number, bpm: number): void {
  const L = level()
  const spb = stepSeconds(bpm)
  const bar = Math.floor(s / 16)
  const inBar = s % 16
  const chords = progression(isMajor())
  const chord = chords[bar]
  const swap = phrase % 2 === 1

  /*
   * The oom-pah. Root on the beat, fifth on the two: this is the engine of the
   * whole style and it never stops, whatever the arrangement is doing above it.
   */
  if (inBar === 0) bajo(v, at, chord.root, 0.34, spb * 2.6)
  if (inBar === 8) bajo(v, at, chord.fifth, 0.27, spb * 2.2)
  if (inBar === 4 && L > 0.6) bajo(v, at, chord.root, 0.14, spb * 1.4)
  // A walk-up into the next chord on the last beat of the bar.
  if (inBar === 14 && L > 0.5) {
    const next = chords[(bar + 1) % 4]
    bajo(v, at, (chord.root + next.root) / 2, 0.16, spb * 1.4)
  }

  // And the pah: accordion and guitar hit the offbeats together.
  if (inBar === 4 || inBar === 12) {
    const strong = inBar === 4
    for (const semis of chord.tones) {
      accordion(v, at, D3 * 2 ** (semis / 12) * (chord.tonic ? 1 : chord.root / D2 / 2), spb * 2.2,
        (strong ? 0.052 : 0.042) + L * 0.03)
    }
    rasgueado(v, at, chord.root * 2, chord.tones, 0.036 + L * 0.028, inBar === 4)
  }

  // Claves keep the eighths honest and sit dry in the middle.
  if (L > 0.45 && inBar % 4 === 0) clave(v, at, 0.046 + L * 0.03)

  // Palmas answer off the beat, and thicken as the shoe turns your way.
  if (L > 0.5) {
    for (const p of swap ? [2, 6, 10, 14] : [6, 14]) {
      if (inBar !== p) continue
      palma(v, at + (rnd() - 0.5) * 0.024, 0.062 + L * 0.05)
    }
  }

  // Tambora: thud on one and three, rim on the offbeats.
  if (inBar === 0 || inBar === 8) tambora(v, at, false, 0.11 + L * 0.06)
  if (L > 0.58 && (inBar === 4 || inBar === 12)) tambora(v, at, true, 0.05 + L * 0.04)

  /*
   * The tune, on the accordion, doubled a third below once the count is good -
   * parallel thirds being the sound the style is known for.
   */
  const deg = LINE[s]
  if (deg !== null && L > 0.34) {
    const semis = [0, 2, isMajor() ? 4 : 3, 5, 7, 9, 10, 11, 12, 14, 16, 17]
    const pick = (n: number) => D3 * 2 ** (semis[Math.max(0, Math.min(semis.length - 1, n))] / 12)
    const f = pick(deg === 0 ? 0 : Math.min(11, Math.round(deg / 2) + (deg % 2)))
    accordion(v, at, f * 2, spb * 2.4, 0.05 + L * 0.055, 1.6)
    if (L > 0.68) accordion(v, at, f * 2 * 2 ** (-(isMajor() ? 4 : 3) / 12), spb * 2.2, 0.03 + L * 0.03, 1.6)
  }

  // The room noticing you is a slow beating under the band.
  if (heatP > 0.25 && inBar === 0) bajo(v, at, chord.root * 2 ** (-14 / 1200), heatP * 0.14, spb * 13)

  // Her voice, only when she is being warm about it, and only at the top.
  if (warmthP > 0.75 && L > 0.6 && s === 0) {
    hum(v, at, currentThird() / 2, spb * 12, 0.032 + L * 0.026, 120)
  }

  /*
   * The interlude: a turnaround that actually leaves home. Four bars of V of V
   * into the dominant, the way a norteño band signals the next verse.
   */
  if (interlude) {
    if (inBar === 0) {
      const away = bar % 2 === 0 ? G2 * 2 ** (2 / 12) : A2
      bajo(v, at, away, 0.3, spb * 3)
      for (const semis of [0, 4, 7, 10]) accordion(v, at, away * 4 * 2 ** (semis / 12), spb * 6, 0.05)
      rasgueado(v, at, away * 2, [0, 4, 7], 0.05, bar % 2 === 0)
    }
    if (inBar === 8) clave(v, at, 0.07)
  }
}

function schedulePiano(at: number, bpm: number): void {
  if (!piano) return
  const spb = stepSeconds(bpm)
  const notes = [0, 7, 3, 5, 0, 7, 5, 3]
  const semis = [0, 2, isMajor() ? 4 : 3, 5, 7, 9, 10, 12]
  for (let i = 0; i < notes.length; i++) {
    pianoNote(piano, at + i * spb * 8 + (rnd() - 0.5) * 0.05, (D3 * 2 ** (semis[notes[i]] / 12)) / 2, 0.055)
  }
}

function tick(): void {
  const c = ac()
  if (cue === 'none' || cue === 'intro' || !band) return
  const bpm = FLOOR[cue as Exclude<Cue, 'none' | 'intro'>].bpm
  const spb = stepSeconds(bpm)

  prune(band, c.currentTime)
  if (piano) prune(piano, c.currentTime)

  while (nextAt < c.currentTime + LOOKAHEAD) {
    if (nextAt < c.currentTime) nextAt = c.currentTime + 0.02
    scheduleStep(band, step, nextAt, bpm)
    if (step === 0) schedulePiano(nextAt, bpm)

    step = (step + 1) % STEPS
    nextAt += spb
    if (step === 0) {
      phrase += 1
      if (interlude) {
        interlude = false
        phrase += 1
      }
    }
  }
}

export function setCue(next: Cue): void {
  if (next === cue) return
  const wasSilent = cue === 'none' || cue === 'intro'
  cue = next

  if (next === 'none' || next === 'intro') {
    if (band) release(band, 0.5)
    if (piano) release(piano, 0.5)
    band = null
    piano = null
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    return
  }

  const c = ac()
  if (!band) {
    band = voice(1, 0.11)
    piano = voice(1, 0.5, true)
    step = 0
    phrase = 0
    nextAt = c.currentTime + 0.1
  } else if (wasSilent) {
    nextAt = c.currentTime + 0.1
  }
  if (timer === null) timer = window.setInterval(tick, TICK_MS)
  tick()
}

/**
 * The three knobs. Deliberately few: a hook like this works because it stays
 * simple, and every layer is additive over a rhythm section that never stops, so
 * no combination can make the arrangement fall apart.
 */
export function setMood(p: { edge?: number; heat?: number; warmth?: number }): void {
  if (p.edge !== undefined) edgeP = Math.max(0, Math.min(1, p.edge))
  if (p.heat !== undefined) heatP = Math.max(0, Math.min(1, p.heat))
  if (p.warmth !== undefined) warmthP = Math.max(0, Math.min(1, p.warmth))
}

export function moodSnapshot(): {
  edge: number
  heat: number
  warmth: number
  third: number
  major: boolean
  phrase: number
  bpm: number
} {
  return {
    edge: edgeP,
    heat: heatP,
    warmth: warmthP,
    third: currentThird(),
    major: isMajor(),
    phrase,
    bpm: cue === 'none' || cue === 'intro' ? 0 : FLOOR[cue as Exclude<Cue, 'none' | 'intro'>].bpm,
  }
}

/** Called when she shuffles: the next pass is the turnaround. */
export function shuffleSeam(): void {
  interlude = true
}

/* ----------------------------------------------------------- the opening */

let opening: Voice | null = null

export function stopIntroScore(): void {
  if (opening) release(opening, 0.6)
  opening = null
}

/**
 * Twelve seconds, written to the six shots rather than looped. It takes an offset
 * because the browser usually has not unlocked audio when the opening starts, so
 * a player who turns the sound on halfway joins at the right bar instead of
 * hearing it from the top. The last bars are the table's, so walking in is seamless.
 */
export function startIntroScore(from = 0): void {
  stopIntroScore()
  const c = ac()
  const v = voice(1, 0.2)
  opening = v
  const t0 = c.currentTime - from
  const live = (when: number) => when >= from - 0.05

  // Street tone under the first two shots.
  const air = c.createBufferSource()
  air.buffer = noiseBuffer(c, 4)
  air.loop = true
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 440
  bp.Q.value = 0.8
  const airGain = c.createGain()
  airGain.gain.setValueAtTime(0.0001, c.currentTime)
  airGain.gain.linearRampToValueAtTime(0.04, c.currentTime + 1.4)
  airGain.gain.setValueAtTime(0.04, Math.max(t0 + 5.4, c.currentTime + 0.1))
  airGain.gain.linearRampToValueAtTime(0.008, Math.max(t0 + 7.0, c.currentTime + 0.2))
  air.connect(bp).connect(airGain)
  airGain.connect(v.bus)
  air.start()
  keep(v, air, t0 + 12.6)

  const spb = stepSeconds(116)
  const chords = progression(false)

  /*
   * Shot by shot. A lone accordion in the doorway, the band coming up as the
   * camera gets inside at 2.2, full norteño from her hands at 5.8, and the title
   * at 9.8 arriving in the major - she has taken an interest.
   */
  if (live(0.4)) accordion(v, t0 + 0.4, 174.61, 2.4, 0.09)
  if (live(1.4)) accordion(v, t0 + 1.4, 220.0, 1.4, 0.07)
  if (live(1.9)) glass(t0 + 1.9, 0.05)

  // From inside the room on, the rhythm section plays properly.
  for (let bar = 0; bar < 7; bar++) {
    const barAt = 2.2 + bar * spb * 16
    if (barAt > 11.8) break
    const chord = chords[bar % 4]
    const thin = bar < 2
    const push = (when: number, fire: () => void) => {
      if (when <= 11.9 && live(when)) fire()
    }
    push(barAt, () => {
      bajo(v, t0 + barAt, chord.root, 0.32, spb * 2.6)
      tambora(v, t0 + barAt, false, thin ? 0.07 : 0.12)
    })
    push(barAt + spb * 8, () => {
      bajo(v, t0 + barAt + spb * 8, chord.fifth, 0.25, spb * 2.2)
      tambora(v, t0 + barAt + spb * 8, false, thin ? 0.05 : 0.1)
    })
    for (const off of [4, 12]) {
      push(barAt + spb * off, () => {
        const at = t0 + barAt + spb * off
        for (const semis of chord.tones) accordion(v, at, D3 * 2 ** (semis / 12), spb * 2, thin ? 0.04 : 0.062)
        rasgueado(v, at, chord.root * 2, chord.tones, thin ? 0.026 : 0.044, off === 4)
      })
    }
    if (!thin) {
      for (const p of [6, 14]) push(barAt + spb * p, () => palma(v, t0 + barAt + spb * p, 0.07))
      push(barAt, () => clave(v, t0 + barAt, 0.05))
      push(barAt + spb * 8, () => clave(v, t0 + barAt + spb * 8, 0.05))
    }
  }

  // Her hands, cutting. A grito lands on the cut.
  if (live(5.9)) {
    hum(v, t0 + 5.9, 330, 0.85, 0.09, 850)
    glass(t0 + 7.5, 0.06)
  }

  // The title, in the major.
  if (live(9.8)) {
    for (const semis of [0, 4, 7]) accordion(v, t0 + 9.8, D3 * 2 ** (semis / 12), 2.2, 0.1)
    bajo(v, t0 + 9.8, D2, 0.34, 2.0)
    hum(v, t0 + 9.8, 185.0, 2.2, 0.055, 60)
    rasgueado(v, t0 + 9.8, D2 * 2, [0, 4, 7], 0.05, true)
  }
}
