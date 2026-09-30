import { ac, noiseBuffer, bandBus, stopTheBand } from './engine'

/*
 * The band at the end of the bar. NOT a score, and this is the third attempt
 * at getting it right - each attempt fixed the previous one's actual defect,
 * so all three are worth a line.
 *
 * ONE was a four-bar turnaround - I VI7 II7 V7 in G, stride left hand - going
 * round and round for as long as the table was open. Everything about that
 * was defensible except the thing that matters: a loop has no beginning and
 * no end, and a thing with no beginning and no end is a soundtrack. You
 * cannot walk into a bar halfway through a loop. You can walk into one
 * halfway through a waltz.
 *
 * TWO therefore played NUMBERS - sixteen bars with a tune, a cadence and a
 * ritardando on the way out, then a proper stop of twenty to fifty seconds
 * before somebody started another one. That property is right and it is kept.
 * What was wrong was everything around it: one man on one piano, playing for
 * well under half the evening, in a room the picture shows packed three deep
 * at the bar. A saloon at its loudest hour does not sound like a parlour with
 * somebody practising in it.
 *
 * THREE, here, is a BAND, and it is the bed rather than the event: piano,
 * banjo, an upright bass and somebody's boot on the boards. It plays dance
 * numbers - a two-step you could actually dance to, a waltz, and the slow one
 * for later - it plays most of the time rather than occasionally, and it still
 * ENDS each number and stops. Loud enough to be the floor the room stands on,
 * and still measurably behind both the saloon and the machine, because the
 * brief on this table has always been that the sound of it is the room and
 * the iron.
 *
 * Two smaller things do the rest of the work. The rhythm is a real dance
 * rhythm - bass on the beat, chord and banjo on the offbeat - which is what
 * makes a band read as a band rather than as an arrangement. And the tempo
 * wanders a percent or two a bar and slows at the end of a phrase, because
 * nothing played by hand is on a grid.
 *
 * Every note is synthesised, so there is still not one audio file in this
 * project. The piano is a badly kept saloon upright: a struck string is a
 * handful of slightly stretched partials with a hammer thump on the front,
 * each note is a fixed few cents out and never gets tuned, and it is
 * double-strung slightly apart, which is what "honky-tonk" actually means and
 * is most of why a bar piano sounds like a bar piano.
 */

/** One bar. Bass on the beat, the chord answering off it. */
interface Bar {
  bass: number
  chord: number[]
}
/** One note of the tune: which bar, which beat (fractions allowed). */
interface Note {
  bar: number
  beat: number
  semi: number
  len: number
}
/**
 * Which dance it is, which is the whole arrangement: how many beats to a bar,
 * where the bass goes and whether anybody is stamping.
 */
type Feel = 'twostep' | 'waltz'
interface Number_ {
  name: string
  feel: Feel
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
  feel: 'waltz',
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
  feel: 'waltz',
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

/*
 * The one you could dance to, and the reason this file was rewritten: a
 * D major two-step at a brisk walking tempo, bass on the beat and the banjo
 * answering off it. D is not an accident either - it is where a banjo lives,
 * because two of its strings are already that chord.
 *
 * This is the number the room is for. The waltzes are what the band plays
 * when the floor thins out.
 */
const TWOSTEP: Number_ = {
  name: 'two-step',
  feel: 'twostep',
  bpm: 104,
  tonic: 293.66,
  bars: [
    { bass: 73.42, chord: [220.0, 293.66, 369.99] }, // D
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
    { bass: 110.0, chord: [277.18, 329.63, 392.0] }, // A7
    { bass: 73.42, chord: [220.0, 293.66, 369.99] }, // D
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
    { bass: 98.0, chord: [246.94, 293.66, 392.0] }, // G
    { bass: 110.0, chord: [277.18, 329.63, 392.0] }, // A7
    { bass: 73.42, chord: [220.0, 293.66, 369.99] }, // D
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
    { bass: 110.0, chord: [277.18, 329.63, 392.0] }, // A7
    { bass: 73.42, chord: [220.0, 293.66, 369.99] }, // D
    { bass: 98.0, chord: [246.94, 293.66, 392.0] }, // G
    { bass: 110.0, chord: [277.18, 329.63, 392.0] }, // A7
    { bass: 73.42, chord: [220.0, 293.66, 369.99] }, // D
    { bass: 73.42, chord: [220.0, 293.66, 369.99] },
  ],
  tune: [
    { bar: 0, beat: 0, semi: 0, len: 1 }, { bar: 0, beat: 1, semi: 2, len: 1 },
    { bar: 1, beat: 0, semi: 4, len: 1 }, { bar: 1, beat: 1, semi: 2, len: 1 },
    { bar: 2, beat: 0, semi: 4, len: 1 }, { bar: 2, beat: 1, semi: 7, len: 1 },
    { bar: 3, beat: 0, semi: 4, len: 2 },
    { bar: 4, beat: 0, semi: 0, len: 1 }, { bar: 4, beat: 1, semi: 4, len: 1 },
    { bar: 5, beat: 0, semi: 7, len: 1 }, { bar: 5, beat: 1, semi: 5, len: 1 },
    { bar: 6, beat: 0, semi: 4, len: 1 }, { bar: 6, beat: 1, semi: 2, len: 1 },
    { bar: 7, beat: 0, semi: 0, len: 2 },
    { bar: 8, beat: 0, semi: 7, len: 1 }, { bar: 8, beat: 1, semi: 9, len: 1 },
    { bar: 9, beat: 0, semi: 11, len: 1 }, { bar: 9, beat: 1, semi: 9, len: 1 },
    { bar: 10, beat: 0, semi: 7, len: 1 }, { bar: 10, beat: 1, semi: 4, len: 1 },
    { bar: 11, beat: 0, semi: 4, len: 2 },
    { bar: 12, beat: 0, semi: 5, len: 1 }, { bar: 12, beat: 1, semi: 7, len: 1 },
    { bar: 13, beat: 0, semi: 4, len: 1 }, { bar: 13, beat: 1, semi: 2, len: 1 },
    { bar: 14, beat: 0, semi: 0, len: 2 },
  ],
}

/* The two-step twice as often as either waltz: it is the one the room is
 * dancing to and the others are the band getting its breath back. */
const REPERTOIRE = [TWOSTEP, WALTZ, TWOSTEP, LAMENT]

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
  const out = bandBus()
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

/**
 * A plucked string: the banjo up top, the upright bass underneath.
 *
 * Different from the piano in the two ways that matter. A plucked string has
 * no hammer felt in front of it, so the attack is the string itself and it is
 * instant; and it decays much faster and much less evenly, because there is
 * nothing holding the energy in. The banjo's brightness comes from the top
 * partials being nearly as loud as the fundamental - that is the whole
 * instrument, a drum with strings over it.
 *
 * @param twang 0 for the bass (fundamental and little else), 1 for the banjo
 *        (all partials, and a fingernail on the front).
 */
function pluck(at: number, freq: number, gain: number, seconds: number, twang: number): void {
  const c = ac()
  const out = bandBus()
  const partials = [1, 2.01, 3.02, 4.05, 5.1]
  const levels = [1, 0.3 + twang * 0.5, 0.12 + twang * 0.45, 0.04 + twang * 0.3, 0.02 + twang * 0.2]
  partials.forEach((p, i) => {
    if (freq * p > 9000) return
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq * p * (1 + (Math.random() - 0.5) * 0.002)
    const g = c.createGain()
    /* Higher partials die first, and on a plucked string they die fast. */
    const decay = seconds / (1 + i * (0.5 + twang))
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain * levels[i], at + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + decay + 0.05)
  })
  if (twang > 0.5) {
    // The nail. Very short, very bright, and it is most of "banjo".
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2600
    bp.Q.value = 0.9
    const g = c.createGain()
    g.gain.setValueAtTime(gain * 0.5, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02)
    s.connect(bp).connect(g).connect(out)
    s.start(at, Math.random())
    s.stop(at + 0.06)
  }
}

/**
 * A boot on the boards, on the beat you would step on.
 *
 * There is no drummer in a saloon band and there does not need to be: what
 * keeps a dance together is somebody's heel. Low, short, and never quite the
 * same twice, because a foot is not a machine.
 */
function stamp(at: number, gain: number): void {
  const c = ac()
  const out = bandBus()
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 240 + Math.random() * 90
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain * (0.8 + Math.random() * 0.4), at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.1)
  s.connect(lp).connect(g).connect(out)
  s.start(at, Math.random() * 1.4)
  s.stop(at + 0.15)
}

/** Picks the next number, never the one just played. */
function sitDown(): void {
  const choice = REPERTOIRE.length === 1 ? 0 : (last + 1 + Math.floor(Math.random() * (REPERTOIRE.length - 1))) % REPERTOIRE.length
  last = choice
  piece = REPERTOIRE[choice]
  beat = 0
}

/** Beats to a bar. The only thing the two feels disagree about structurally. */
const beatsPerBar = (p: Number_) => (p.feel === 'waltz' ? 3 : 2)

function playBeat(at: number, i: number): void {
  if (!piece) return
  const perBar = beatsPerBar(piece)
  const bar = Math.floor(i / perBar)
  const b = i % perBar
  const { bass, chord } = piece.bars[bar]
  /* Quieter as the room gets interested in you: it is the same room, listening. */
  const level = 0.52 - intensity * 0.36
  const spb = 60 / piece.bpm

  if (piece.feel === 'waltz') {
    // Oom on one, pah-pah on two and three: one pair of hands, no band.
    if (b === 0) {
      strike(at, bass, 0.14 * level, 1.4)
      pluck(at, bass / 2, 0.1 * level, 0.9, 0)
    } else {
      chord.forEach((f, n) => strike(at + n * 0.007, f, 0.05 * level, 0.7))
    }
  } else {
    /*
     * The two-step, which is the whole point of having a band. Bass walks
     * root-fifth on the beats; the chord and the banjo both answer halfway
     * between them, and that offbeat is what makes it danceable rather than
     * merely fast. The heel lands on the second beat.
     */
    pluck(at, b === 0 ? bass : bass * 1.5, 0.13 * level, 0.5, 0)
    const off = at + spb * 0.5
    chord.forEach((f, n) => strike(off + n * 0.006, f, 0.035 * level, 0.35))
    chord.forEach((f, n) => pluck(off + 0.004 + n * 0.009, f * 2, 0.022 * level, 0.3, 1))
    if (b === perBar - 1) stamp(at, 0.07 * level)
  }

  /* The tune drops out first when the room goes quiet, and the last bar of a
   * number is left to the rhythm so the cadence lands on its own. */
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
    const perBar = beatsPerBar(p)
    const bar = Math.floor(beat / perBar)
    /* A percent or two either way every bar, and a proper slowing over the
     * last two - which is the cue that tells a listener a piece has ENDED
     * rather than been faded out. */
    const home = bar >= p.bars.length - 2 ? 1 + (bar - (p.bars.length - 3)) * 0.07 : 1
    nextAt += (60 / p.bpm) * home * (0.99 + Math.random() * 0.025)
    beat++
    if (beat >= p.bars.length * perBar) {
      piece = null
      /*
       * Between numbers, and this is the one number in the file that the
       * brief moved. It was 14 to 30 seconds, chosen so that the room was
       * what you were listening to for most of the evening - correct when
       * the music was one man at an upright, and wrong for a room the
       * picture shows packed three deep. A dance band takes as long to get
       * its breath back as it takes somebody to call the next tune.
       *
       * The property being protected is not the length of the gap, it is
       * that there IS one: a number ends, and something with an end is not a
       * soundtrack. Longer when the table has the room's attention, because
       * a band watching a count being called is not playing.
       */
      resumeAt = c.currentTime + 5 + Math.random() * 7 + intensity * 14
      return
    }
  }
}

export function startMusic(): void {
  if (timer) return
  const c = ac()
  nextAt = c.currentTime + 0.1
  /*
   * It opens mid-number, which is a reversal. The old comment here said the
   * first thing the player hears is the room and somebody sits down at the
   * piano a little while later, and it waited six to sixteen seconds - which
   * is longer than the entire opening film, so the opening had no music on it
   * at all. The first shot of that film is a saloon at its loudest with a man
   * visibly playing the upright in the left of frame, so silence there was
   * not restraint, it was a contradiction of the picture.
   *
   * A short delay, not none: the room fades up first, and the band arriving a
   * beat after it is how you walk into a building.
   */
  piece = null
  resumeAt = c.currentTime + 0.6
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
export const bandStops = (seconds: number) => stopTheBand(seconds)
