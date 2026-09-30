import { ac, noiseBuffer, pianoBus, stopThePiano } from './engine'

/*
 * The upright in the corner. NOT a score, and this is the second attempt at
 * making that true.
 *
 * The first one was a four-bar turnaround - I VI7 II7 V7 in G, stride left
 * hand - going round and round for as long as the table was open, with the
 * right hand tossing a coin at the top of each lap to decide whether to play
 * the tune. Everything about that was defensible except the thing that
 * matters: a loop has no beginning and no end, and a thing with no beginning
 * and no end is a soundtrack. You cannot walk into a bar halfway through a
 * loop. You can walk into one halfway through a waltz.
 *
 * So this plays NUMBERS. A number is sixteen bars with a tune, a cadence and
 * a ritardando on the way out, and then the piano stops - properly stops, for
 * twenty to fifty seconds - before somebody starts another one. Two of them,
 * in different keys and different moods, so the second one you hear is not
 * the first one again. Most of the time the table has no music on it at all,
 * which is correct: most of the time a bar does not either.
 *
 * Two smaller things do the rest of the work. It is in 3/4 with an
 * oom-pah-pah left hand, which is the sound of a piano being played by
 * somebody rather than a rhythm section. And the tempo wanders a percent or
 * two a bar and slows at the end of a phrase, because nothing played by hand
 * is on a grid.
 *
 * Every note is synthesised, so there is still not one audio file in this
 * project. The instrument is a badly kept saloon piano: a struck string is a
 * handful of slightly stretched partials with a hammer thump on the front,
 * each note is a fixed few cents out and never gets tuned, and - new here -
 * it is double-strung slightly apart, which is what "honky-tonk" actually
 * means and is most of why a bar piano sounds like a bar piano.
 */

/** One bar. Bass on one, the chord answering on two and three. */
interface Bar {
  bass: number
  chord: number[]
}
/** One note of the tune: which bar, which beat (0-2, fractions allowed). */
interface Note {
  bar: number
  beat: number
  semi: number
  len: number
}
interface Number_ {
  name: string
  bpm: number
  /** What the tune is measured from, in Hz. */
  tonic: number
  bars: Bar[]
  tune: Note[]
}

/*
 * "THE BAND PLAYED ON" was 1895 and this is not it, but it is the same
 * furniture: a plain C major waltz with the minor-iv on the way home, which
 * is the single most period-correct harmonic gesture available and the reason
 * bar twelve is an F minor 6 rather than another F.
 */
const WALTZ: Number_ = {
  name: 'waltz',
  bpm: 142,
  tonic: 261.63,
  bars: [
    { bass: 130.81, chord: [196.0, 261.63, 329.63] }, // C
    { bass: 130.81, chord: [196.0, 261.63, 329.63] },
    { bass: 98.0, chord: [196.0, 246.94, 349.23] }, // G7
    { bass: 98.0, chord: [196.0, 246.94, 349.23] },
    { bass: 98.0, chord: [196.0, 246.94, 349.23] },
    { bass: 98.0, chord: [196.0, 246.94, 349.23] },
    { bass: 130.81, chord: [196.0, 261.63, 329.63] }, // C
    { bass: 130.81, chord: [196.0, 261.63, 329.63] },
    { bass: 130.81, chord: [196.0, 233.08, 329.63] }, // C7
    { bass: 130.81, chord: [196.0, 233.08, 329.63] },
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 87.31, chord: [174.61, 207.65, 293.66] }, // Fm6
    { bass: 130.81, chord: [196.0, 261.63, 329.63] }, // C
    { bass: 98.0, chord: [196.0, 246.94, 349.23] }, // G7
    { bass: 130.81, chord: [196.0, 261.63, 329.63] }, // C
    { bass: 130.81, chord: [196.0, 261.63, 329.63] },
  ],
  tune: [
    { bar: 0, beat: 0, semi: 4, len: 1 }, { bar: 0, beat: 1, semi: 7, len: 1 }, { bar: 0, beat: 2, semi: 12, len: 1 },
    { bar: 1, beat: 0, semi: 11, len: 2 }, { bar: 1, beat: 2, semi: 7, len: 1 },
    { bar: 2, beat: 0, semi: 9, len: 1 }, { bar: 2, beat: 1, semi: 11, len: 1 }, { bar: 2, beat: 2, semi: 14, len: 1 },
    { bar: 3, beat: 0, semi: 11, len: 3 },
    { bar: 4, beat: 0, semi: 14, len: 1 }, { bar: 4, beat: 1, semi: 11, len: 1 }, { bar: 4, beat: 2, semi: 7, len: 1 },
    { bar: 5, beat: 0, semi: 9, len: 2 }, { bar: 5, beat: 2, semi: 5, len: 1 },
    { bar: 6, beat: 0, semi: 4, len: 2 }, { bar: 6, beat: 2, semi: 7, len: 1 },
    { bar: 7, beat: 0, semi: 0, len: 3 },
    { bar: 8, beat: 0, semi: 4, len: 1 }, { bar: 8, beat: 1, semi: 7, len: 1 }, { bar: 8, beat: 2, semi: 10, len: 1 },
    { bar: 9, beat: 0, semi: 10, len: 2 }, { bar: 9, beat: 2, semi: 9, len: 1 },
    { bar: 10, beat: 0, semi: 9, len: 1 }, { bar: 10, beat: 1, semi: 12, len: 1 }, { bar: 10, beat: 2, semi: 17, len: 1 },
    { bar: 11, beat: 0, semi: 8, len: 2 }, { bar: 11, beat: 2, semi: 5, len: 1 },
    { bar: 12, beat: 0, semi: 4, len: 1 }, { bar: 12, beat: 1, semi: 7, len: 1 }, { bar: 12, beat: 2, semi: 4, len: 1 },
    { bar: 13, beat: 0, semi: 2, len: 2 }, { bar: 13, beat: 2, semi: 5, len: 1 },
    { bar: 14, beat: 0, semi: 4, len: 1 }, { bar: 14, beat: 1, semi: 0, len: 2 },
  ],
}

/*
 * The other one, for later in the evening: A minor, slower, and it leans on
 * the dominant instead of resolving off it. Nothing clever - the point of a
 * second number is only that there IS a second number.
 */
const LAMENT: Number_ = {
  name: 'lament',
  bpm: 108,
  tonic: 440.0,
  bars: [
    { bass: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
    { bass: 110.0, chord: [220.0, 261.63, 329.63] },
    { bass: 82.41, chord: [207.65, 246.94, 293.66] }, // E7
    { bass: 82.41, chord: [207.65, 246.94, 293.66] },
    { bass: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
    { bass: 110.0, chord: [220.0, 261.63, 329.63] },
    { bass: 146.83, chord: [174.61, 220.0, 293.66] }, // Dm
    { bass: 146.83, chord: [174.61, 220.0, 293.66] },
    { bass: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
    { bass: 82.41, chord: [207.65, 246.94, 293.66] }, // E7
    { bass: 110.0, chord: [220.0, 261.63, 329.63] }, // Am
    { bass: 110.0, chord: [220.0, 261.63, 329.63] },
  ],
  tune: [
    { bar: 0, beat: 0, semi: 0, len: 1 }, { bar: 0, beat: 1, semi: 3, len: 1 }, { bar: 0, beat: 2, semi: 7, len: 1 },
    { bar: 1, beat: 0, semi: 5, len: 2 }, { bar: 1, beat: 2, semi: 3, len: 1 },
    { bar: 2, beat: 0, semi: 2, len: 3 },
    { bar: 3, beat: 0, semi: 2, len: 1 }, { bar: 3, beat: 1, semi: -1, len: 2 },
    { bar: 4, beat: 0, semi: 0, len: 2 }, { bar: 4, beat: 2, semi: 2, len: 1 },
    { bar: 5, beat: 0, semi: 3, len: 3 },
    { bar: 6, beat: 0, semi: 5, len: 1 }, { bar: 6, beat: 1, semi: 8, len: 1 }, { bar: 6, beat: 2, semi: 12, len: 1 },
    { bar: 7, beat: 0, semi: 8, len: 2 }, { bar: 7, beat: 2, semi: 5, len: 1 },
    { bar: 8, beat: 0, semi: 3, len: 2 }, { bar: 8, beat: 2, semi: 0, len: 1 },
    { bar: 9, beat: 0, semi: 2, len: 2 }, { bar: 9, beat: 2, semi: -1, len: 1 },
    { bar: 10, beat: 0, semi: 0, len: 3 },
  ],
}

const REPERTOIRE = [WALTZ, LAMENT]

/** How far each pitch class has drifted, in cents. Fixed, because it is one piano. */
const DETUNE = [0, -13, 8, -21, 5, 17, -9, 11, -17, 3, 22, -6]

const LOOKAHEAD = 0.25
const TICK_MS = 60

let timer = 0
let intensity = 0
/** The number being played, or null while nobody is at the piano. */
let piece: Number_ | null = null
let last = -1
/** Beat index within the number, and when the next beat falls. */
let beat = 0
let nextAt = 0
/** When somebody sits down again, on the audio clock. */
let resumeAt = 0

const semitone = (base: number, n: number) => base * 2 ** (n / 12)

/**
 * One hammer, two strings, one decay.
 *
 * The two strings are the honky-tonk: a piano that has not been tuned since
 * it was carried in has its unison pairs a few cents apart, which is what
 * produces the slow beating that makes the instrument sound like it is in a
 * bar and not in a parlour. The second string is cheaper than the first -
 * three partials rather than six - because the beating is an interference
 * pattern in the fundamental and nobody can hear which partials are in it.
 */
function strike(at: number, freq: number, gain: number, seconds: number): void {
  const c = ac()
  const out = pianoBus()
  const cents = DETUNE[Math.round(12 * Math.log2(freq / 27.5)) % 12] ?? 0
  const f = freq * 2 ** (cents / 1200)

  /* Real strings are stretched: the partials run sharp of the harmonics, which
   * is most of why a piano sounds like wire under tension and not like an organ. */
  const partials = [1, 2.003, 3.01, 4.02, 5.04, 6.08]
  const levels = [1, 0.42, 0.24, 0.12, 0.07, 0.04]
  const string = (detune: number, take: number, share: number) => {
    partials.slice(0, take).forEach((p, i) => {
      if (f * p > 9000) return
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * p * detune
      const g = c.createGain()
      const decay = seconds / (1 + i * 0.7)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.linearRampToValueAtTime(gain * levels[i] * share, at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + decay + 0.05)
    })
  }
  string(1, 6, 0.62)
  string(1 + (6 + (Math.abs(cents) % 5)) / 1200, 3, 0.45)

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

/** Picks the next number, never the one just played. */
function sitDown(): void {
  const choice = REPERTOIRE.length === 1 ? 0 : (last + 1 + Math.floor(Math.random() * (REPERTOIRE.length - 1))) % REPERTOIRE.length
  last = choice
  piece = REPERTOIRE[choice]
  beat = 0
}

function playBeat(at: number, i: number): void {
  if (!piece) return
  const bar = Math.floor(i / 3)
  const b = i % 3
  const { bass, chord } = piece.bars[bar]
  /* Quieter as the room gets interested in you: it is the same room, listening. */
  const level = 0.52 - intensity * 0.36
  const spb = 60 / piece.bpm

  // Oom on one, pah-pah on two and three.
  if (b === 0) strike(at, bass, 0.14 * level, 1.4)
  else chord.forEach((f, n) => strike(at + n * 0.007, f, 0.05 * level, 0.7))

  /* The right hand drops out first when the room goes quiet, and the last bar
   * of a number is left to the left hand so the cadence lands on its own. */
  if (intensity > 0.72 || bar >= piece.bars.length - 1) return
  for (const note of piece.tune) {
    if (note.bar !== bar || Math.floor(note.beat) !== b) continue
    strike(
      at + (note.beat - b) * spb,
      semitone(piece.tonic, note.semi),
      0.08 * level * (1 - intensity * 0.6),
      note.len * spb * 0.9,
    )
  }
}

function tick(): void {
  const c = ac()
  while (nextAt < c.currentTime + LOOKAHEAD) {
    if (!piece) {
      /* Nobody at the piano. Come back when the wait is up; the table is not
       * silent while this is true, it is a room with people in it. */
      if (c.currentTime < resumeAt) {
        nextAt = c.currentTime + 0.2
        return
      }
      sitDown()
      nextAt = Math.max(nextAt, c.currentTime + 0.05)
    }
    const p = piece!
    playBeat(nextAt, beat)
    const bar = Math.floor(beat / 3)
    /* A percent or two either way every bar, and a proper slowing over the
     * last two - which is the cue that tells a listener a piece has ENDED
     * rather than been faded out. */
    const home = bar >= p.bars.length - 2 ? 1 + (bar - (p.bars.length - 3)) * 0.07 : 1
    nextAt += (60 / p.bpm) * home * (0.99 + Math.random() * 0.025)
    beat++
    if (beat >= p.bars.length * 3) {
      piece = null
      /* Long enough that the room is what you are listening to - a number
       * runs about twenty seconds, so the piano is absent for most of the
       * evening. Longer when the table has the room's attention, because a
       * man watching a count being called is not playing the piano. */
      resumeAt = c.currentTime + 14 + Math.random() * 16 + intensity * 12
      return
    }
  }
}

export function startMusic(): void {
  if (timer) return
  const c = ac()
  nextAt = c.currentTime + 0.1
  /* It does not open on a number. The first thing the player hears is the
   * room, and somebody sits down at the piano a little while later. */
  piece = null
  resumeAt = c.currentTime + 6 + Math.random() * 10
  timer = window.setInterval(tick, TICK_MS)
}

export function stopMusic(): void {
  window.clearInterval(timer)
  timer = 0
  piece = null
}

/**
 * 0 to 1. What it is driven by on this table is the room's attention, not the
 * odds - because the odds here never change, and that is the point of the
 * table. The playing thins to the left hand, and between numbers the gap gets
 * longer.
 *
 * There used to be a low sawtooth drone here that came up under the floor as
 * this rose. It was the one thing on the table with no source in the picture
 * - nothing in a saloon makes that sound - and it has gone. The room pressing
 * in is the room pressing in: see setRoomDensity() in crowd.ts.
 */
export function setIntensity(next: number): void {
  intensity = Math.max(0, Math.min(1, next))
}

/** Something happened and the piano stopped. */
export const pianoStops = (seconds: number) => stopThePiano(seconds)
