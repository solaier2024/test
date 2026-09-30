import { ac, noiseBuffer, bandBus, stopTheBand } from './engine'

/*
 * The band at the end of the bar. NOT a score, and this is the fourth attempt.
 * Each one fixed the previous one's real defect, so all four are worth a line.
 *
 * ONE was a four-bar turnaround going round and round for as long as the table
 * was open. Everything about that was defensible except the thing that
 * matters: a loop has no beginning and no end, and a thing with no beginning
 * and no end is a soundtrack. You cannot walk into a bar halfway through a
 * loop. You can walk into one halfway through a waltz.
 *
 * TWO therefore played NUMBERS - sixteen bars with a tune, a cadence and a
 * ritardando on the way out, then a proper stop before somebody started
 * another one. That property is right and it has been kept ever since. What
 * was wrong was everything around it: one man at one piano, playing for well
 * under half the evening, in a room the picture shows packed three deep.
 *
 * THREE made it a band - piano, banjo, upright bass and a boot on the boards -
 * playing dance numbers most of the time instead of occasionally.
 *
 * FOUR, here, is the same band with A FIDDLE IN FRONT OF IT, and it exists
 * because of the only piece of feedback that no measurement in this project
 * could have produced: a player came back from the preview and said it felt
 * about the same as before. He was right, and three changes to a mix cannot
 * argue with him. What made THREE still sound like TWO is that the tune was
 * still coming out of the same instrument: every melody note in this file was
 * a piano hammer, and a piano hammer is a click and a decay. Put the tune on a
 * bow instead and the band changes completely, because a bowed note is the
 * opposite kind of sound - it starts slowly, it does not decay, it is alive
 * for its whole length, and it has vibrato on it. The banjo and the piano went
 * from being the band to being the rhythm section behind one, which is what a
 * saloon band is and what those instruments are for.
 *
 * The repertoire is new as well, and completely: a REEL in G, a POLKA in A and
 * a slow WALTZ in F, where there used to be a two-step in D, a waltz in C and
 * a lament in A minor. Not one bar survives. That is partly because the tunes
 * were written for a piano to play and a fiddle wants longer lines, and partly
 * because "I changed the band" and "the band plays different tunes" should be
 * the same statement.
 *
 * Every note is synthesised, so there is still not one audio file in this
 * project.
 */

/** One bar of accompaniment. Bass on the beat, the chord answering off it. */
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
type Feel = 'reel' | 'polka' | 'waltz'
interface Number_ {
  name: string
  feel: Feel
  bpm: number
  /** What the tune is measured from, in Hz. */
  tonic: number
  bars: Bar[]
  tune: Note[]
}

/**
 * Lays a phrase down again starting at another bar.
 *
 * A reel is AABB and a polka is not far off, which is a property of the form
 * rather than of these particular tunes: eight bars of material and sixteen
 * bars of playing is what makes one danceable and memorable at the same time.
 * Writing the repeats out by hand would be sixty more lines in which a typo
 * would be invisible, so the repeat is a repeat.
 */
const again = (notes: Note[], at: number): Note[] =>
  notes.map((n) => ({ ...n, bar: n.bar + at }))
const chords = (bars: Bar[], times: number): Bar[] =>
  Array.from({ length: times }, () => bars).flat()

/* ------------------------------------------------------------------ the reel */

/*
 * G major, and it is the number the room is dancing to.
 *
 * A reel is four to the bar, eighth notes almost throughout, and the fiddle
 * does not stop for breath - which is exactly the shape a bow makes and
 * exactly the shape a hammer cannot. G is where it lives: the fiddle's two
 * lowest strings are G and D, so the tonic and the dominant are ringing open
 * strings, and that is why half the dance music of the period is in G or D.
 */
const REEL_A: Note[] = [
  { bar: 0, beat: 0, semi: 7, len: 0.5 }, { bar: 0, beat: 0.5, semi: 12, len: 0.5 },
  { bar: 0, beat: 1, semi: 11, len: 0.5 }, { bar: 0, beat: 1.5, semi: 12, len: 0.5 },
  { bar: 0, beat: 2, semi: 14, len: 0.5 }, { bar: 0, beat: 2.5, semi: 12, len: 0.5 },
  { bar: 0, beat: 3, semi: 11, len: 0.5 }, { bar: 0, beat: 3.5, semi: 9, len: 0.5 },
  { bar: 1, beat: 0, semi: 9, len: 0.5 }, { bar: 1, beat: 0.5, semi: 5, len: 0.5 },
  { bar: 1, beat: 1, semi: 9, len: 0.5 }, { bar: 1, beat: 1.5, semi: 12, len: 0.5 },
  { bar: 1, beat: 2, semi: 11, len: 0.5 }, { bar: 1, beat: 2.5, semi: 9, len: 0.5 },
  { bar: 1, beat: 3, semi: 7, len: 0.5 }, { bar: 1, beat: 3.5, semi: 5, len: 0.5 },
  { bar: 2, beat: 0, semi: 4, len: 0.5 }, { bar: 2, beat: 0.5, semi: 7, len: 0.5 },
  { bar: 2, beat: 1, semi: 12, len: 0.5 }, { bar: 2, beat: 1.5, semi: 11, len: 0.5 },
  { bar: 2, beat: 2, semi: 12, len: 0.5 }, { bar: 2, beat: 2.5, semi: 14, len: 0.5 },
  { bar: 2, beat: 3, semi: 16, len: 0.5 }, { bar: 2, beat: 3.5, semi: 14, len: 0.5 },
  { bar: 3, beat: 0, semi: 11, len: 0.5 }, { bar: 3, beat: 0.5, semi: 9, len: 0.5 },
  { bar: 3, beat: 1, semi: 7, len: 1 }, { bar: 3, beat: 2, semi: 12, len: 2 },
]
/* The turn: the same tune an octave up, which is what a fiddler does on the
 * repeat and what the B part of a reel is for. */
const REEL_B: Note[] = [
  { bar: 0, beat: 0, semi: 19, len: 0.5 }, { bar: 0, beat: 0.5, semi: 16, len: 0.5 },
  { bar: 0, beat: 1, semi: 19, len: 0.5 }, { bar: 0, beat: 1.5, semi: 21, len: 0.5 },
  { bar: 0, beat: 2, semi: 19, len: 0.5 }, { bar: 0, beat: 2.5, semi: 16, len: 0.5 },
  { bar: 0, beat: 3, semi: 14, len: 0.5 }, { bar: 0, beat: 3.5, semi: 12, len: 0.5 },
  { bar: 1, beat: 0, semi: 17, len: 0.5 }, { bar: 1, beat: 0.5, semi: 14, len: 0.5 },
  { bar: 1, beat: 1, semi: 17, len: 0.5 }, { bar: 1, beat: 1.5, semi: 19, len: 0.5 },
  { bar: 1, beat: 2, semi: 16, len: 0.5 }, { bar: 1, beat: 2.5, semi: 14, len: 0.5 },
  { bar: 1, beat: 3, semi: 12, len: 0.5 }, { bar: 1, beat: 3.5, semi: 11, len: 0.5 },
  { bar: 2, beat: 0, semi: 12, len: 0.5 }, { bar: 2, beat: 0.5, semi: 16, len: 0.5 },
  { bar: 2, beat: 1, semi: 19, len: 0.5 }, { bar: 2, beat: 1.5, semi: 16, len: 0.5 },
  { bar: 2, beat: 2, semi: 14, len: 0.5 }, { bar: 2, beat: 2.5, semi: 12, len: 0.5 },
  { bar: 2, beat: 3, semi: 11, len: 0.5 }, { bar: 2, beat: 3.5, semi: 9, len: 0.5 },
  { bar: 3, beat: 0, semi: 7, len: 0.5 }, { bar: 3, beat: 0.5, semi: 11, len: 0.5 },
  { bar: 3, beat: 1, semi: 14, len: 0.5 }, { bar: 3, beat: 1.5, semi: 12, len: 0.5 },
  { bar: 3, beat: 2, semi: 12, len: 2 },
]
const G: Bar = { bass: 98.0, chord: [196.0, 246.94, 293.66] }
const C: Bar = { bass: 87.31, chord: [174.61, 261.63, 329.63] }
const D7: Bar = { bass: 73.42, chord: [185.0, 220.0, 293.66] }
const REEL: Number_ = {
  name: 'reel',
  feel: 'reel',
  bpm: 112,
  tonic: 392.0,
  bars: [...chords([G, C, G, D7], 4), G],
  tune: [...REEL_A, ...again(REEL_A, 4), ...again(REEL_B, 8), ...again(REEL_B, 12)],
}

/* ----------------------------------------------------------------- the polka */

/*
 * A major, two to the bar, and the one with the bounce in it. A polka is a
 * reel that has been told to stop hurrying: the same eighth notes, but the
 * phrase lands on the downbeat every two bars instead of running on.
 */
const POLKA_A: Note[] = [
  { bar: 0, beat: 0, semi: 12, len: 0.5 }, { bar: 0, beat: 0.5, semi: 12, len: 0.5 },
  { bar: 0, beat: 1, semi: 11, len: 0.5 }, { bar: 0, beat: 1.5, semi: 9, len: 0.5 },
  { bar: 1, beat: 0, semi: 7, len: 0.5 }, { bar: 1, beat: 0.5, semi: 9, len: 0.5 },
  { bar: 1, beat: 1, semi: 11, len: 1 },
  { bar: 2, beat: 0, semi: 4, len: 0.5 }, { bar: 2, beat: 0.5, semi: 7, len: 0.5 },
  { bar: 2, beat: 1, semi: 12, len: 0.5 }, { bar: 2, beat: 1.5, semi: 11, len: 0.5 },
  { bar: 3, beat: 0, semi: 9, len: 0.5 }, { bar: 3, beat: 0.5, semi: 7, len: 0.5 },
  { bar: 3, beat: 1, semi: 4, len: 1 },
]
const POLKA_B: Note[] = [
  { bar: 0, beat: 0, semi: 14, len: 0.5 }, { bar: 0, beat: 0.5, semi: 16, len: 0.5 },
  { bar: 0, beat: 1, semi: 17, len: 0.5 }, { bar: 0, beat: 1.5, semi: 16, len: 0.5 },
  { bar: 1, beat: 0, semi: 12, len: 0.5 }, { bar: 1, beat: 0.5, semi: 14, len: 0.5 },
  { bar: 1, beat: 1, semi: 16, len: 1 },
  { bar: 2, beat: 0, semi: 11, len: 0.5 }, { bar: 2, beat: 0.5, semi: 14, len: 0.5 },
  { bar: 2, beat: 1, semi: 19, len: 0.5 }, { bar: 2, beat: 1.5, semi: 16, len: 0.5 },
  { bar: 3, beat: 0, semi: 12, len: 1.5 },
]
const A_: Bar = { bass: 110.0, chord: [220.0, 277.18, 329.63] }
const E7: Bar = { bass: 82.41, chord: [207.65, 246.94, 329.63] }
const D_: Bar = { bass: 73.42, chord: [220.0, 293.66, 369.99] }
const POLKA: Number_ = {
  name: 'polka',
  feel: 'polka',
  bpm: 118,
  tonic: 440.0,
  bars: [A_, E7, A_, E7, D_, A_, E7, A_, A_, E7, A_, E7, D_, A_, E7, A_, A_],
  tune: [...POLKA_A, ...again(POLKA_A, 4), ...again(POLKA_B, 8), ...again(POLKA_B, 12)],
}

/* ----------------------------------------------------------------- the waltz */

/*
 * F major, slow, for later in the evening when the floor has thinned out.
 * Long bowed notes and the minor-iv on the way home, which is the single most
 * period-correct harmonic gesture available and the reason bar ten is a B flat
 * minor rather than another B flat.
 */
const WALTZ: Number_ = {
  name: 'waltz',
  feel: 'waltz',
  bpm: 98,
  tonic: 349.23,
  bars: [
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 87.31, chord: [174.61, 220.0, 261.63] },
    { bass: 130.81, chord: [196.0, 233.08, 261.63] }, // C7
    { bass: 130.81, chord: [196.0, 233.08, 261.63] },
    { bass: 116.54, chord: [174.61, 233.08, 293.66] }, // Bb
    { bass: 116.54, chord: [174.61, 233.08, 293.66] },
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 130.81, chord: [196.0, 233.08, 261.63] }, // C7
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 146.83, chord: [174.61, 220.0, 293.66] }, // Dm
    { bass: 116.54, chord: [174.61, 220.0, 277.18] }, // Bbm6
    { bass: 130.81, chord: [196.0, 233.08, 261.63] }, // C7
    { bass: 87.31, chord: [174.61, 220.0, 261.63] }, // F
    { bass: 87.31, chord: [174.61, 220.0, 261.63] },
  ],
  tune: [
    { bar: 0, beat: 0, semi: 0, len: 1 }, { bar: 0, beat: 1, semi: 4, len: 1 }, { bar: 0, beat: 2, semi: 7, len: 1 },
    { bar: 1, beat: 0, semi: 12, len: 2 }, { bar: 1, beat: 2, semi: 7, len: 1 },
    { bar: 2, beat: 0, semi: 11, len: 1 }, { bar: 2, beat: 1, semi: 9, len: 1 }, { bar: 2, beat: 2, semi: 7, len: 1 },
    { bar: 3, beat: 0, semi: 9, len: 3 },
    { bar: 4, beat: 0, semi: 5, len: 1 }, { bar: 4, beat: 1, semi: 9, len: 1 }, { bar: 4, beat: 2, semi: 12, len: 1 },
    { bar: 5, beat: 0, semi: 14, len: 2 }, { bar: 5, beat: 2, semi: 12, len: 1 },
    { bar: 6, beat: 0, semi: 11, len: 1 }, { bar: 6, beat: 1, semi: 7, len: 1 }, { bar: 6, beat: 2, semi: 4, len: 1 },
    { bar: 7, beat: 0, semi: 7, len: 3 },
    { bar: 8, beat: 0, semi: 0, len: 1 }, { bar: 8, beat: 1, semi: 4, len: 1 }, { bar: 8, beat: 2, semi: 7, len: 1 },
    { bar: 9, beat: 0, semi: 9, len: 2 }, { bar: 9, beat: 2, semi: 12, len: 1 },
    { bar: 10, beat: 0, semi: 14, len: 1 }, { bar: 10, beat: 1, semi: 12, len: 1 }, { bar: 10, beat: 2, semi: 8, len: 1 },
    { bar: 11, beat: 0, semi: 11, len: 2 }, { bar: 11, beat: 2, semi: 7, len: 1 },
    { bar: 12, beat: 0, semi: 0, len: 3 },
  ],
}

/* The two fast ones twice as often as the waltz: they are what the room is
 * dancing to and the waltz is the band getting its breath back. */
const REPERTOIRE = [REEL, POLKA, REEL, WALTZ, POLKA, REEL]

/**
 * How far each pitch class has drifted, in cents. Fixed, because it is one
 * piano and nobody has tuned it since it came off the wagon.
 *
 * Different numbers from the last piano, and that is the point rather than a
 * detail: a piano's particular wrongness is most of what makes it that piano.
 */
const DETUNE = [0, 9, -18, 6, -11, 21, -4, -24, 14, -8, 17, 2]

const LOOKAHEAD = 0.25
const TICK_MS = 60

let timer = 0
let intensity = 0
/** The number being played, or null while the band is between tunes. */
let piece: Number_ | null = null
let last = -1
/** Beat index within the number, and when the next beat falls. */
let beat = 0
let nextAt = 0
/** When the band starts the next one, on the audio clock. */
let resumeAt = 0

const semitone = (base: number, n: number) => base * 2 ** (n / 12)

/* -------------------------------------------------------------- the fiddle */

/**
 * A bowed string, and the reason this file was rewritten.
 *
 * Everything else in this project is a struck or plucked thing: energy goes in
 * at one instant and leaks out afterwards, so the sound is an attack followed
 * by a decay. A bow is the opposite arrangement - it pours energy in for as
 * long as the arm is moving - and that single difference is most of what the
 * ear uses to tell a fiddle from a piano, ahead of anything about the
 * spectrum. So the envelope here has a real SUSTAIN in it, and the attack is
 * slow enough to hear: 40ms of the hair catching the string rather than the
 * 4ms of a hammer.
 *
 * Three more things, in the order they matter:
 *
 *   VIBRATO, and it is late. A fiddler puts the finger down first and starts
 *     the wrist afterwards, so the wobble fades in over the first fifth of a
 *     note - about 5.5Hz and about 15 cents wide. Vibrato from the first
 *     sample is a synthesiser patch; vibrato that arrives is a player.
 *
 *   THE BODY. A violin is not a resonator that colours everything equally -
 *     it has two big low modes (the air inside it near 280Hz, the top plate
 *     near 460) and a broad rise between 2 and 4kHz that every violinist
 *     calls the bridge hill. Those three, in that order of size, are the
 *     difference between a bowed string and a sawtooth with a filter on it.
 *
 *   ROSIN. A bow is a stick-slip oscillator and it is noisy: there is a scrape
 *     under the note the whole time, loudest at the start of the stroke. It is
 *     quiet and taking it out makes the instrument sound instantly synthetic.
 *
 * @param up which way the bow is going. Only changes how hard the note starts,
 *        which is enough to keep a run of eighth notes from sounding stamped
 *        out by a machine.
 */
function bow(at: number, freq: number, gain: number, seconds: number, up: boolean): void {
  const c = ac()
  const out = bandBus()

  /* The body, shared by the string and the rosin. */
  const body = c.createGain()
  const air = c.createBiquadFilter()
  air.type = 'peaking'
  air.frequency.value = 280
  air.Q.value = 1.6
  air.gain.value = 7
  const plate = c.createBiquadFilter()
  plate.type = 'peaking'
  plate.frequency.value = 460
  plate.Q.value = 2.2
  plate.gain.value = 5
  const hill = c.createBiquadFilter()
  hill.type = 'peaking'
  hill.frequency.value = 2900
  hill.Q.value = 0.7
  hill.gain.value = 6
  /* And the top end has to go. An unfiltered sawtooth is a buzzer; a fiddle
   * heard across a crowded room has almost nothing above 5kHz left. */
  const dull = c.createBiquadFilter()
  dull.type = 'lowpass'
  dull.frequency.value = 5200
  body.connect(air).connect(plate).connect(hill).connect(dull).connect(out)

  const env = c.createGain()
  const attack = up ? 0.052 : 0.036
  const peak = gain * (up ? 0.92 : 1)
  env.gain.setValueAtTime(0.0001, at)
  env.gain.linearRampToValueAtTime(peak, at + attack)
  /* A bowed note swells slightly and then holds, which is an arm rather than
   * an envelope generator. */
  env.gain.linearRampToValueAtTime(peak * 1.06, at + Math.min(seconds * 0.5, attack + 0.09))
  env.gain.setValueAtTime(peak * 1.06, at + Math.max(attack, seconds - 0.05))
  env.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.05)
  env.connect(body)

  const string = c.createOscillator()
  string.type = 'sawtooth'
  string.frequency.setValueAtTime(freq, at)
  /* The finger arriving: a few cents of scoop into the note, which is what
   * stops a run of them sounding quantised. */
  string.frequency.setValueAtTime(freq * (up ? 0.994 : 1.005), at)
  string.frequency.linearRampToValueAtTime(freq, at + 0.03)
  string.connect(env)

  const wrist = c.createOscillator()
  wrist.type = 'sine'
  wrist.frequency.value = 5.2 + Math.random() * 0.9
  const width = c.createGain()
  width.gain.setValueAtTime(0.0001, at)
  width.gain.linearRampToValueAtTime(freq * 0.009, at + Math.min(0.28, seconds * 0.45))
  wrist.connect(width).connect(string.frequency)
  wrist.start(at)
  wrist.stop(at + seconds + 0.1)

  const rosin = c.createBufferSource()
  rosin.buffer = noiseBuffer(c)
  rosin.loop = true
  const scrape = c.createBiquadFilter()
  scrape.type = 'bandpass'
  scrape.frequency.value = 2200
  scrape.Q.value = 0.6
  const grip = c.createGain()
  grip.gain.setValueAtTime(gain * 0.5, at)
  grip.gain.exponentialRampToValueAtTime(Math.max(1e-4, gain * 0.05), at + 0.09)
  grip.gain.setValueAtTime(Math.max(1e-4, gain * 0.05), at + Math.max(0.1, seconds - 0.05))
  grip.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.05)
  rosin.connect(scrape).connect(grip).connect(body)

  string.start(at)
  string.stop(at + seconds + 0.12)
  rosin.start(at, Math.random() * 1.2)
  rosin.stop(at + seconds + 0.12)
}

/* ------------------------------------------------------- the rhythm section */

/**
 * One hammer, two strings, one decay.
 *
 * The two strings are the honky-tonk: a piano that has not been tuned since it
 * was carried in has its unison pairs a few cents apart, and the slow beating
 * that produces is most of why a bar piano sounds like a bar piano. It is the
 * rhythm section now rather than the lead - chords on the offbeat - so it has
 * lost a partial and most of its level, which is the arrangement doing what an
 * arrangement does.
 */
function strike(at: number, freq: number, gain: number, seconds: number): void {
  const c = ac()
  const out = bandBus()
  const cents = DETUNE[Math.round(12 * Math.log2(freq / 27.5)) % 12] ?? 0
  const f = freq * 2 ** (cents / 1200)

  /* Real strings are stretched: the partials run sharp of the harmonics, which
   * is most of why a piano sounds like wire under tension and not an organ. */
  const partials = [1, 2.003, 3.01, 4.02, 5.04]
  const levels = [1, 0.4, 0.2, 0.09, 0.05]
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
  string(1, 5, 0.62)
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
 * keeps a dance together is somebody's heel.
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

/* ------------------------------------------------------------- the playing */

/** Picks the next number, never the one just played. */
function sitDown(): void {
  const choice = REPERTOIRE.length === 1 ? 0 : (last + 1 + Math.floor(Math.random() * (REPERTOIRE.length - 1))) % REPERTOIRE.length
  last = choice
  piece = REPERTOIRE[choice]
  beat = 0
}

/** Beats to a bar. The only thing the three feels disagree about structurally. */
const beatsPerBar = (p: Number_) => (p.feel === 'waltz' ? 3 : p.feel === 'reel' ? 4 : 2)

/** Which way the bow is going, from the note's place in the bar. */
let bowUp = false

function playBeat(at: number, i: number): void {
  if (!piece) return
  const perBar = beatsPerBar(piece)
  const bar = Math.floor(i / perBar)
  const b = i % perBar
  const { bass, chord } = piece.bars[bar]
  /* Quieter as the room gets interested in you: it is the same room, listening. */
  const level = 0.52 - intensity * 0.36
  const spb = 60 / piece.bpm
  const off = at + spb * 0.5

  if (piece.feel === 'waltz') {
    // Oom on one, pah-pah on two and three.
    if (b === 0) {
      pluck(at, bass, 0.12 * level, 0.8, 0)
      strike(at, bass * 2, 0.05 * level, 1.1)
    } else {
      chord.forEach((f, n) => strike(at + n * 0.007, f, 0.045 * level, 0.7))
    }
  } else if (piece.feel === 'polka') {
    /* Bass on the beat, everything else between them, and the heel on two.
     * A polka is an oom-pah with the pah slightly late, which is the whole
     * bounce of it. */
    pluck(at, b === 0 ? bass : bass * 1.5, 0.12 * level, 0.45, 0)
    chord.forEach((f, n) => strike(off + n * 0.006, f, 0.032 * level, 0.3))
    chord.forEach((f, n) => pluck(off + 0.004 + n * 0.009, f * 2, 0.02 * level, 0.26, 1))
    if (b === perBar - 1) stamp(at, 0.065 * level)
  } else {
    /*
     * The reel. Bass walks root-fifth on one and three; the banjo answers on
     * every offbeat, which at this tempo is eight strokes to the bar and is
     * what a reel actually sounds like from across a room. The piano only
     * takes two and four, so it is punctuation rather than an accompaniment.
     */
    if (b % 2 === 0) pluck(at, b === 0 ? bass : bass * 1.5, 0.115 * level, 0.4, 0)
    else chord.forEach((f, n) => strike(at + n * 0.006, f, 0.026 * level, 0.26))
    chord.forEach((f, n) => pluck(off + 0.004 + n * 0.008, f * 2, 0.016 * level, 0.2, 1))
    if (b === 1 || b === 3) stamp(at, 0.05 * level)
  }

  /* The tune drops out first when the room goes quiet, and the last bar of a
   * number is left to the rhythm so the cadence lands on its own. */
  if (intensity > 0.72 || bar >= piece.bars.length - 1) return
  for (const note of piece.tune) {
    if (note.bar !== bar || Math.floor(note.beat) !== b) continue
    bowUp = !bowUp
    bow(
      at + (note.beat - b) * spb,
      semitone(piece.tonic, note.semi),
      0.055 * level * (1 - intensity * 0.6),
      /* Slightly short of its written length, because a bow lifts. Legato
       * would be one continuous note and the phrasing would vanish. */
      note.len * spb * 0.88,
      bowUp,
    )
  }
}

function tick(): void {
  const c = ac()
  while (nextAt < c.currentTime + LOOKAHEAD) {
    if (!piece) {
      /* Nobody playing. Come back when the wait is up; the table is not silent
       * while this is true, it is a room with people in it. */
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
       * Between numbers. The property being protected is not the length of
       * the gap, it is that there IS one: a number ends, and something with
       * an end is not a soundtrack. Longer when the table has the room's
       * attention, because a band watching a count being called is not
       * playing.
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
   * A short delay, not none. The room fades up first and the band arriving a
   * beat after it is how you walk into a building - but only a beat: this used
   * to wait six to sixteen seconds, which is longer than the entire opening
   * film, so the opening had no music on it at all.
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
 * table. The fiddle drops out first, then the playing thins to the rhythm, and
 * between numbers the gap gets longer.
 */
export function setIntensity(next: number): void {
  intensity = Math.max(0, Math.min(1, next))
}

/** Something happened and the band stopped. */
export const bandStops = (seconds: number) => stopTheBand(seconds)
