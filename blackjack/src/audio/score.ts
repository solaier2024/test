import { ac, musicBus, noiseBuffer, pianoBus, reverbIn, softClip } from './engine'

/*
 * The score, synthesised in the browser. Nothing here is a recording.
 *
 * The first game's music was a descent - i-VII-VI-V in D minor, the sound of
 * something closing in. This table is not about fate closing in, it is about
 * being played by somebody, so the harmony refuses to go anywhere: the bass is
 * nailed to D and the only thing that actually moves is the third.
 *
 *   F  (174.61 Hz)  minor third  - she is being professional
 *   F# (185.00 Hz)  major third  - she has taken an interest
 *
 * That one semitone is the whole score, and it is bound to what her face is
 * *showing*, never to what she is actually holding. The music is part of her
 * performance, so it is exactly as reliable as she is.
 *
 * Rhythm is habanera - 3+1+2+2 sixteenths, the border's own dance figure and
 * also the canonical sound of being seduced - which is why the grid here is
 * sixteenths (STEPS 64, a step of 15/bpm seconds) rather than eighths.
 */

export type Cue = 'none' | 'intro' | 'title' | 'table'

/** Where the bass falls in a 4/4 bar on the sixteenth grid. */
const HABANERA = [0, 3, 4, 6, 8, 11, 12, 14]
/** Palmas answer off the beat, which is where the push comes from. */
const PALMAS = [2, 6, 10, 14]

const D2 = 73.42
const D3 = 146.83
const THIRD_MINOR = 174.61
const THIRD_MAJOR = 185.0
const FIFTH = 220.0

const STEPS = 64
const BARS = 4
const LOOKAHEAD = 0.2
const TICK_MS = 45

const FLOOR: Record<Exclude<Cue, 'none' | 'intro'>, { bpm: number; floor: number }> = {
  title: { bpm: 58, floor: 0.1 },
  table: { bpm: 72, floor: 0.34 },
}

/**
 * Four four-bar cells rather than one phrase on repeat. Which cell plays next is
 * decided at the seam, and the seam is her shuffle - so the form is longer than
 * what is written, and every reset has a reason on screen.
 */
type Cell = 'A' | 'A2' | 'B' | 'A3'
const CELLS: Cell[] = ['A', 'A2', 'B', 'A3']

interface Voice {
  bus: GainNode
  room: GainNode
  held: { node: AudioScheduledSourceNode; until: number }[]
}

function voice(gain = 1, toPiano = false): Voice {
  const c = ac()
  const bus = c.createGain()
  bus.gain.value = gain
  bus.connect(toPiano ? pianoBus() : musicBus())
  const room = c.createGain()
  room.gain.value = 0.34
  room.connect(reverbIn())
  bus.connect(room)
  return { bus, room, held: [] }
}

function keep(v: Voice, node: AudioScheduledSourceNode, until: number): void {
  v.held.push({ node, until })
}

function prune(v: Voice, now: number): void {
  v.held = v.held.filter((h) => {
    if (h.until > now) return true
    try {
      h.node.stop()
    } catch {
      /* already finished */
    }
    return false
  })
}

function release(v: Voice, seconds = 0.5): void {
  const c = ac()
  v.bus.gain.cancelScheduledValues(c.currentTime)
  v.bus.gain.setValueAtTime(v.bus.gain.value, c.currentTime)
  v.bus.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds)
  v.room.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds * 1.6)
  for (const h of v.held) {
    try {
      h.node.stop(c.currentTime + seconds + 0.1)
    } catch {
      /* already finished */
    }
  }
}

function place(v: Voice, node: AudioNode, pan: number): void {
  const c = ac()
  const p = c.createStereoPanner()
  p.pan.value = pan
  node.connect(p).connect(v.bus)
}

/* ------------------------------------------------------------------ voices */

/**
 * A button accordion. Two or three reeds a few cents apart, which is where the
 * warmth comes from: at 8-14 cents the beating lands around 1.2-1.4 Hz on A3.
 * The instrument reached northern Mexico and Texas with German and Czech
 * immigrants in these decades, and nothing else says "border" this fast.
 */
function accordion(v: Voice, at: number, f: number, len: number, gain = 0.1): void {
  const c = ac()
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, at)
  // A bellows, not a key: slow in, a small swell, slow out.
  out.gain.linearRampToValueAtTime(gain, at + 0.08)
  out.gain.linearRampToValueAtTime(gain * 1.14, at + len * 0.45)
  out.gain.linearRampToValueAtTime(gain * 0.9, at + len * 0.8)
  out.gain.linearRampToValueAtTime(0.0001, at + len)

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2200
  lp.Q.value = 0.6

  for (const cents of [0, 11, -7]) {
    const o = c.createOscillator()
    o.type = cents === 0 ? 'sawtooth' : 'square'
    o.frequency.value = f * 2 ** (cents / 1200)
    const g = c.createGain()
    g.gain.value = cents === 0 ? 0.5 : 0.24
    o.connect(g).connect(lp)
    o.start(at)
    o.stop(at + len + 0.05)
    keep(v, o, at + len)
  }
  lp.connect(out)
  place(v, out, -0.12)
}

/** Bajo sexto: a thick nylon low string through a soft knee. */
function bajo(v: Voice, at: number, f: number, gain: number, len: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.value = f
  const shape = softClip(c, 1.9)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 520
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(shape).connect(lp).connect(g)
  place(v, g, 0)
  o.start(at)
  o.stop(at + len + 0.02)
  keep(v, o, at + len)
}

/** Requinto: a single nylon-string line, close and unhurried. */
function requinto(v: Voice, at: number, f: number, gain: number, len: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(f * 0.995, at)
  o.frequency.linearRampToValueAtTime(f, at + 0.05)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 5
  lp.frequency.setValueAtTime(f * 6, at)
  lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 1.5), at + len * 0.7)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  o.connect(lp).connect(g)
  place(v, g, 0.22)
  o.start(at)
  o.stop(at + len + 0.02)
  keep(v, o, at + len)
}

/** Wordless voice: detuned saws through two formants. */
function hum(v: Voice, at: number, f: number, len: number, gain: number): void {
  const c = ac()
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.linearRampToValueAtTime(gain, at + len * 0.3)
  out.gain.linearRampToValueAtTime(0.0001, at + len)
  for (const hz of [700, 1180]) {
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = 7
    bp.connect(out)
    for (const det of [-6, 0, 7]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f * 2 ** (det / 1200)
      const g = c.createGain()
      g.gain.value = 0.2
      o.connect(g).connect(bp)
      o.start(at)
      o.stop(at + len + 0.05)
      keep(v, o, at + len)
    }
  }
  place(v, out, -0.3)
}

/** Palmas. Hands are never quite together, hence the seeded jitter. */
function palma(v: Voice, at: number, gain: number): void {
  const c = ac()
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1600
  bp.Q.value = 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.055)
  s.connect(bp).connect(g)
  place(v, g, 0.34)
  s.start(at, Math.random() * 1.2)
  s.stop(at + 0.08)
  keep(v, s, at + 0.08)
}

/**
 * Glass. The same three inharmonic partials the other game rang a death bell
 * with (1 : 2.76 : 5.4), taken up two and a half octaves and cut short: the
 * code is identical, the numbers make it punctuation instead of doom.
 */
export function glass(at: number, gain = 0.09): void {
  const c = ac()
  const v = voice(1)
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
  v.room.gain.value = 0.5
  setTimeout(() => release(v, 0.2), 700)
}

/** The out-of-tune upright in the next room, on its own bus so it can be shut up. */
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

/* --------------------------------------------------------------- the score */

let cue: Cue = 'none'
let bed: Voice | null = null
let piano: Voice | null = null
let timer: number | null = null
let step = 0
let nextAt = 0
let cellIdx = 0
let bars = 0
/** Set for one pass when she shuffles, so the phrase turns over on the seam. */
let interlude = false
let phraseSeed = 1

let edgeP = 0
let heatP = 0
let warmthP = 0.5

/** A tiny seeded generator so a rendered phrase is reproducible offline. */
function rnd(): number {
  phraseSeed = (phraseSeed * 1103515245 + 12345) >>> 0
  return phraseSeed / 4294967296
}

const stepSeconds = (bpm: number) => 15 / bpm

function level(): number {
  if (cue === 'none' || cue === 'intro') return 0
  const { floor } = FLOOR[cue]
  return Math.min(1, floor + edgeP * (1 - floor))
}

/** F or F#, and this is the only thing in the score that her mood can move. */
const third = () => (warmthP >= 0.6 ? THIRD_MAJOR : THIRD_MINOR)

/** The melodic cell, in scale degrees over the tonic, one entry per sixteenth. */
const LINES: Record<Cell, (number | null)[]> = {
  A: [0, null, null, 2, null, null, 4, null, 3, null, null, 2, null, null, 0, null],
  A2: [4, null, null, 3, null, null, 2, null, 0, null, null, 2, null, null, 3, null],
  B: [7, null, null, 5, null, null, 4, null, 3, null, 2, null, 0, null, null, null],
  A3: [0, null, 2, null, 4, null, null, 5, null, null, 4, null, 2, null, 0, null],
}

/** Degrees of the D minor/major-third scale this score uses, in Hz above D3. */
function degree(n: number): number {
  const semis = [0, 2, warmthP >= 0.6 ? 4 : 3, 5, 7, 8, 10, 12]
  return D3 * 2 ** (semis[Math.min(semis.length - 1, Math.max(0, n))] / 12)
}

function scheduleStep(v: Voice, s: number, at: number, bpm: number): void {
  const L = level()
  const spb = stepSeconds(bpm)
  const inBar = s % 16
  const cell = CELLS[cellIdx]

  // The bass never leaves D, and the habanera figure is always there.
  if (HABANERA.includes(inBar)) {
    const strong = inBar === 0 || inBar === 8
    bajo(v, at, inBar === 6 || inBar === 14 ? D2 * 1.5 : D2, strong ? 0.3 : 0.17, spb * (strong ? 3 : 1.6))
  }

  // The chord, stated softly on the downbeat. Here is the third.
  if (inBar === 0) accordion(v, at, third(), spb * 12, 0.05 + L * 0.075)
  if (inBar === 8 && L > 0.4) accordion(v, at, FIFTH, spb * 6, 0.035 + L * 0.05)

  // Palmas come in with the shoe, and thicken as it turns your way.
  if (L > 0.42 && PALMAS.includes(inBar)) {
    const jitter = (rnd() - 0.5) * 0.03
    if (inBar !== 10 || L > 0.62) palma(v, at + jitter, 0.05 + L * 0.06)
  }

  // The line itself, on the requinto. Interludes drop it so the seam is audible.
  if (!interlude && L > 0.3) {
    const deg = LINES[cell][inBar]
    if (deg !== null) requinto(v, at, degree(deg), 0.05 + L * 0.07, spb * 3.2)
  }

  // Her voice, only when she is being warm about it.
  if (warmthP > 0.7 && L > 0.5 && inBar === 0) hum(v, at, third() / 2, spb * 14, 0.03 + L * 0.03)

  // The room noticing you is a low beating under everything.
  if (heatP > 0.25 && inBar === 0) {
    bajo(v, at, D2 * 2 ** (-12 / 1200), heatP * 0.12, spb * 15)
  }

  // The interlude is the only place the harmony actually moves.
  if (interlude && (inBar === 0 || inBar === 8)) {
    const away = inBar === 0 ? D2 * 2 ** (-2 / 12) : D2 * 2 ** (-4 / 12)
    bajo(v, at, away, 0.26, spb * 7)
    accordion(v, at, away * 4, spb * 7, 0.07)
  }
}

function schedulePiano(at: number, bpm: number): void {
  if (!piano) return
  const spb = stepSeconds(bpm)
  // Four bars of an idle vamp, deliberately a little out of tune and a little
  // out of time with the band, because it is coming through a wall.
  const notes = [0, 7, 3, 5, 0, 7, 5, 3]
  for (let i = 0; i < notes.length; i++) {
    pianoNote(piano, at + i * spb * 8 + (rnd() - 0.5) * 0.05, degree(notes[i]) / 2, 0.06)
  }
}

function tick(): void {
  const c = ac()
  if (cue === 'none' || cue === 'intro' || !bed) return
  const bpm = FLOOR[cue].bpm
  const spb = stepSeconds(bpm)

  prune(bed, c.currentTime)
  if (piano) prune(piano, c.currentTime)

  while (nextAt < c.currentTime + LOOKAHEAD) {
    if (nextAt < c.currentTime) nextAt = c.currentTime + 0.02
    scheduleStep(bed, step, nextAt, bpm)
    if (step === 0) schedulePiano(nextAt, bpm)

    step = (step + 1) % STEPS
    nextAt += spb
    if (step === 0) {
      bars += BARS
      // The seam. An interlude plays once and then hands over to a different
      // cell, so nothing repeats in the same order for long.
      if (interlude) {
        interlude = false
        cellIdx = (cellIdx + 2) % CELLS.length
      } else {
        cellIdx = (cellIdx + 1) % CELLS.length
      }
    }
  }
}

export function setCue(next: Cue): void {
  if (next === cue) return
  const wasNone = cue === 'none' || cue === 'intro'
  cue = next

  if (next === 'none' || next === 'intro') {
    if (bed) release(bed, 0.7)
    if (piano) release(piano, 0.7)
    bed = null
    piano = null
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    return
  }

  const c = ac()
  if (!bed) {
    bed = voice(1)
    piano = voice(1, true)
    step = 0
    bars = 0
    cellIdx = 0
    nextAt = c.currentTime + 0.12
  } else if (wasNone) {
    nextAt = c.currentTime + 0.12
  }
  if (timer === null) timer = window.setInterval(tick, TICK_MS)
  tick()
}

/**
 * The three knobs. Deliberately few: the reason a hook like this works at all is
 * that it stays simple, and every layer is additive over a bed that is always
 * playing, so no combination can make the arrangement fall apart.
 */
export function setMood(p: { edge?: number; heat?: number; warmth?: number }): void {
  if (p.edge !== undefined) edgeP = Math.max(0, Math.min(1, p.edge))
  if (p.heat !== undefined) heatP = Math.max(0, Math.min(1, p.heat))
  if (p.warmth !== undefined) warmthP = Math.max(0, Math.min(1, p.warmth))
}

export function moodSnapshot(): { edge: number; heat: number; warmth: number; third: number; cell: Cell; bars: number } {
  return { edge: edgeP, heat: heatP, warmth: warmthP, third: third(), cell: CELLS[cellIdx], bars }
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
 * Twelve seconds, written to the six shots rather than looped. It takes an
 * offset because the browser usually has not unlocked audio when the opening
 * starts, so a player who turns the sound on halfway should join at the right
 * bar instead of hearing it from the top.
 *
 * The last bar is the table's first bar, so walking in is seamless.
 */
export function startIntroScore(from = 0): void {
  stopIntroScore()
  const c = ac()
  const v = voice(1)
  opening = v
  const t0 = c.currentTime - from
  const at = (when: number): number | null =>
    when < from - 0.05 ? null : Math.max(t0 + when, c.currentTime)

  // Street tone under the whole thing, and the tonic underneath that.
  const air = c.createBufferSource()
  air.buffer = noiseBuffer(c, 4)
  air.loop = true
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 420
  bp.Q.value = 0.8
  const airGain = c.createGain()
  airGain.gain.setValueAtTime(0.0001, c.currentTime)
  airGain.gain.linearRampToValueAtTime(0.045, c.currentTime + 1.6)
  airGain.gain.setValueAtTime(0.045, Math.max(t0 + 9.6, c.currentTime + 0.1))
  airGain.gain.linearRampToValueAtTime(0.012, Math.max(t0 + 11.4, c.currentTime + 0.2))
  air.connect(bp).connect(airGain)
  airGain.connect(v.bus)
  air.start()
  keep(v, air, t0 + 12.4)

  const drone = c.createOscillator()
  drone.type = 'sawtooth'
  drone.frequency.value = D2
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 200
  const dg = c.createGain()
  dg.gain.setValueAtTime(0.0001, c.currentTime)
  dg.gain.linearRampToValueAtTime(0.1, c.currentTime + 2.2)
  drone.connect(lp).connect(dg)
  place(v, dg, 0.5)
  drone.start()
  drone.stop(t0 + 12.4)
  keep(v, drone, t0 + 12.3)

  /*
   * Shot by shot. The window at 0.0, the room at 2.0, her look up at 3.8, her
   * hands cutting at 5.8 - which is where the habanera starts, because that is
   * the shot the game is actually about - the card at 7.4, the title at 9.6.
   */
  const events: [number, () => void][] = [
    [0.3, () => accordion(v, t0 + 0.3, THIRD_MINOR / 2, 2.6, 0.075)],
    [1.5, () => glass(t0 + 1.5, 0.05)],

    [2.0, () => bajo(v, t0 + 2.0, D2, 0.26, 1.4)],
    [2.0, () => accordion(v, t0 + 2.0, FIFTH / 2, 1.8, 0.07)],
    [2.9, () => palma(v, t0 + 2.9, 0.06)],
    [3.2, () => palma(v, t0 + 3.2, 0.05)],

    [3.8, () => requinto(v, t0 + 3.8, D3 * 2 ** (7 / 12), 0.1, 1.5)],
    [4.4, () => bajo(v, t0 + 4.4, D2, 0.22, 1.1)],
    [5.0, () => requinto(v, t0 + 5.0, THIRD_MINOR, 0.09, 1.2)],
  ]

  // From the cutting shot on, the habanera figure runs under everything.
  const spb = stepSeconds(72)
  for (let bar = 0; bar < 4; bar++) {
    const barAt = 5.8 + bar * spb * 16
    for (const s of HABANERA) {
      const when = barAt + s * spb
      if (when > 11.9) continue
      const strong = s === 0 || s === 8
      events.push([when, () => bajo(v, t0 + when, s === 6 || s === 14 ? D2 * 1.5 : D2, strong ? 0.28 : 0.15, spb * 2.6)])
    }
    for (const s of PALMAS) {
      const when = barAt + s * spb
      if (when > 11.9 || when < 7.0) continue
      events.push([when, () => palma(v, t0 + when, 0.055)])
    }
  }

  events.push([7.4, () => requinto(v, t0 + 7.4, degree(4), 0.11, 1.6)])
  events.push([7.4, () => glass(t0 + 7.42, 0.07)])
  // The title, and the third finally turns major: she has taken an interest.
  events.push([9.6, () => accordion(v, t0 + 9.6, THIRD_MAJOR, 2.4, 0.12)])
  events.push([9.6, () => hum(v, t0 + 9.6, THIRD_MAJOR / 2, 2.4, 0.05)])
  events.push([9.6, () => bajo(v, t0 + 9.6, D2, 0.3, 2.2)])

  for (const [when, fire] of events) {
    if (at(when) === null) continue
    fire()
  }
}
