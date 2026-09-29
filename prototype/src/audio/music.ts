/**
 * The score.
 *
 * Every note is synthesised, so the game still ships no audio files and there
 * is nothing to license. The vocabulary is the spaghetti-western one because
 * that is what the picture is: a lone whistled line, a twanged guitar soaked
 * in slapback, a galloping woodblock, wordless choir, a bell tolling the hour
 * on a dead street.
 *
 * It runs over i - VII - VI - V in D minor. That descent, with the major
 * dominant at the bottom of it, is the harmonic gesture the whole genre sits
 * on; it is a cadence, not anybody's tune.
 *
 * The one thing that is really doing the work: the table's arrangement is
 * driven by how likely the next chamber is to be live. As the cylinder empties
 * the percussion arrives, the guitar starts tremolo picking and the choir
 * climbs, so a hand that is about to kill somebody sounds like one.
 */

import { ac, musicBus, noiseBuffer, reverbIn, softClip } from './engine'

export type Cue = 'none' | 'intro' | 'title' | 'menu' | 'table'

/**
 * How hard each screen plays before the live-chamber odds are added on top.
 *
 * The table's floor is deliberately near the bottom. It used to sit at 0.42,
 * which meant a fresh cylinder already had the gallop, the snare and the
 * choir going, and there was nowhere left to build to - the arrangement was
 * loud the whole time instead of getting loud. From down here the whole range
 * is available and the odds can actually spend it.
 */
const FLOOR: Record<Exclude<Cue, 'none' | 'intro'>, { bpm: number; floor: number }> = {
  title: { bpm: 68, floor: 0.06 },
  menu: { bpm: 80, floor: 0.16 },
  table: { bpm: 100, floor: 0.1 },
}

/** i - VII - VI - V in D minor, one bar each. */
const PROGRESSION = [
  { root: 146.83, third: 174.61, fifth: 220.0 }, // Dm
  { root: 130.81, third: 164.81, fifth: 196.0 }, // C
  { root: 116.54, third: 146.83, fifth: 174.61 }, // Bb
  { root: 110.0, third: 138.59, fifth: 164.81 }, // A, major, and the C# bites
]

/**
 * The tritone above D. Held under the root it is the plainest statement of
 * "this is going to go wrong" that western harmony has, and it is the top of
 * the arrangement: it only appears when the next chamber is probably live.
 */
const TRITONE = 103.83 // G#2

/**
 * The tune, in eighth notes across the four bars. Whistled at the top of the
 * arrangement and doubled an octave down by the guitar once it gets loud.
 */
const LEAD: { at: number; f: number; len: number }[] = [
  { at: 0, f: 880.0, len: 3 }, // A5
  { at: 3, f: 698.46, len: 2 }, // F5
  { at: 5, f: 880.0, len: 3 }, // A5
  { at: 8, f: 783.99, len: 4 }, // G5
  { at: 12, f: 659.25, len: 4 }, // E5
  { at: 16, f: 698.46, len: 3 }, // F5
  { at: 19, f: 587.33, len: 2 }, // D5
  { at: 21, f: 698.46, len: 3 }, // F5
  { at: 24, f: 659.25, len: 3 }, // E5
  { at: 27, f: 554.37, len: 2 }, // C#5
  { at: 29, f: 587.33, len: 3 }, // D5
]

const STEPS = 32
const LOOKAHEAD = 0.18
const TICK_MS = 45

/* ------------------------------------------------------------------ voices */

interface Voice {
  /** Dry path to the music bus. */
  bus: GainNode
  /** The voice's own send into the room, so a release takes the tail with it. */
  room: GainNode
  /** Kept so a cue can be cut short; pruned as they finish. */
  held: { node: AudioScheduledSourceNode; until: number }[]
}

let slap: GainNode | null = null

/**
 * One tape delay, shared. Slapback is most of what makes a clean electric
 * guitar sound like 1966 rather than like a sine wave with a sharp attack.
 */
function slapbackSend(): GainNode {
  if (slap) return slap
  const c = ac()
  const input = c.createGain()
  input.gain.value = 1

  const delay = c.createDelay(0.5)
  delay.delayTime.value = 0.112
  const feedback = c.createGain()
  feedback.gain.value = 0.28
  const tone = c.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 2600
  const out = c.createGain()
  out.gain.value = 0.42

  input.connect(delay)
  delay.connect(tone).connect(feedback).connect(delay)
  delay.connect(out)
  out.connect(musicBus())

  slap = input
  return input
}

function voice(level = 1): Voice {
  const c = ac()
  const bus = c.createGain()
  bus.gain.value = level
  bus.connect(musicBus())
  const room = c.createGain()
  room.gain.value = level
  room.connect(reverbIn())
  return { bus, room, held: [] }
}

/**
 * Puts one note on a voice: dry straight through, wet via the voice's own
 * send. Both have to hang off the voice, or fading a cue out would leave
 * half of it still ringing with no handle to stop it by.
 */
function place(v: Voice, node: AudioNode, room: number): void {
  node.connect(v.bus)
  if (room <= 0) return
  const tap = ac().createGain()
  tap.gain.value = room
  node.connect(tap)
  tap.connect(v.room)
}

function keep(v: Voice, node: AudioScheduledSourceNode, until: number): void {
  v.held.push({ node, until })
  if (v.held.length > 96) {
    const now = ac().currentTime
    v.held = v.held.filter((h) => h.until > now)
  }
}

/** Fades a voice out and stops anything still sounding on it. */
function release(v: Voice): void {
  const c = ac()
  const t = c.currentTime
  for (const g of [v.bus.gain, v.room.gain]) {
    g.cancelScheduledValues(t)
    g.setValueAtTime(Math.max(g.value, 0.0001), t)
    g.exponentialRampToValueAtTime(0.0001, t + 0.5)
  }
  for (const h of v.held) {
    try {
      h.node.stop(t + 0.52)
    } catch {
      /* already finished on its own */
    }
  }
  v.held = []
  window.setTimeout(() => {
    v.bus.disconnect()
    v.room.disconnect()
  }, 700)
}

/* ------------------------------------------------------------ instruments */

/**
 * The lone whistle. A pure tone gets you nowhere; what reads as whistling is
 * the scoop into the note, the vibrato arriving late, and a breath of noise
 * riding on top of it.
 */
function whistle(v: Voice, at: number, freq: number, dur: number, scoop = 0.94): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq * scoop, at)
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.11)

  const vib = c.createOscillator()
  vib.type = 'sine'
  vib.frequency.value = 5.1
  const vibAmount = c.createGain()
  vibAmount.gain.setValueAtTime(0.0001, at)
  vibAmount.gain.linearRampToValueAtTime(freq * 0.011, at + Math.min(0.4, dur * 0.6))
  vib.connect(vibAmount).connect(o.frequency)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.19, at + 0.07)
  g.gain.setValueAtTime(0.19, at + dur * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g)
  place(v, g, 1.1)

  const air = c.createBufferSource()
  air.buffer = noiseBuffer(c, dur + 0.1)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq * 1.02
  bp.Q.value = 14
  const ag = c.createGain()
  ag.gain.setValueAtTime(0.0001, at)
  ag.gain.exponentialRampToValueAtTime(0.05, at + 0.08)
  ag.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  air.connect(bp).connect(ag)
  ag.connect(v.bus)

  o.start(at)
  o.stop(at + dur + 0.05)
  vib.start(at)
  vib.stop(at + dur + 0.05)
  air.start(at)
  air.stop(at + dur + 0.05)
  keep(v, o, at + dur)
  keep(v, vib, at + dur)
  keep(v, air, at + dur)
}

/**
 * Twanged guitar: a sawtooth through a resonant filter that shuts fast.
 *
 * `bite` runs it into a waveshaper on the way out. A clean twang is the sound
 * of the wide shot; the same line pushed into the amp is the sound of the
 * close-up, and having one control for it means the arrangement can get
 * nastier without getting merely louder.
 */
function twang(v: Voice, at: number, freq: number, gain: number, dur = 0.9, bite = 0): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.value = freq

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 7 + bite * 5
  lp.frequency.setValueAtTime(Math.min(freq * 9, 5200), at)
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.6, 180), at + dur * 0.8)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)

  o.connect(lp)
  if (bite > 0.02) {
    const drive = c.createWaveShaper()
    drive.curve = softClip(1 + bite * 7)
    const trim = c.createGain()
    // Distortion raises average level even as it caps the peaks; pull it back.
    trim.gain.value = 1 / (1 + bite * 1.6)
    lp.connect(drive).connect(trim).connect(g)
  } else {
    lp.connect(g)
  }
  place(v, g, 0.45)
  g.connect(slapbackSend())
  o.start(at)
  o.stop(at + dur + 0.05)
  keep(v, o, at + dur)
}

/** Tremolo picking: the same note hammered, which is how tension is played. */
function tremolo(v: Voice, at: number, freq: number, seconds: number, gain: number, bite = 0): void {
  const step = 0.062
  for (let t = 0; t < seconds; t += step) {
    twang(v, at + t, freq, gain * (t % (step * 2) < step ? 1 : 0.7), 0.16, bite)
  }
}

/**
 * The floor dropping out from under a beat. Felt more than heard on a phone
 * speaker, which is the point: it is the part of the arrangement that does
 * not have to compete with the whistle for the same few kilohertz.
 */
function sub(v: Voice, at: number, gain: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(64, at)
  o.frequency.exponentialRampToValueAtTime(28, at + 0.34)
  const shape = c.createWaveShaper()
  shape.curve = softClip(1.4)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.44)
  o.connect(shape).connect(g)
  place(v, g, 0.12)
  o.start(at)
  o.stop(at + 0.5)
  keep(v, o, at + 0.46)
}

/**
 * A rising band of noise that stops dead rather than fading. The hit is the
 * silence it stops into; without the cut it is just a whoosh.
 */
function riser(v: Voice, at: number, dur: number, gain: number): void {
  const c = ac()
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, dur + 0.15)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.5
  bp.frequency.setValueAtTime(200, at)
  bp.frequency.exponentialRampToValueAtTime(4400, at + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + dur)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.05)
  src.connect(bp).connect(g)
  place(v, g, 0.7)
  src.start(at)
  src.stop(at + dur + 0.12)
  keep(v, src, at + dur + 0.1)
}

/** The impact a riser lands on: a long sub drop with the air moving with it. */
function boom(v: Voice, at: number, gain: number): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(92, at)
  o.frequency.exponentialRampToValueAtTime(26, at + 0.6)
  const shape = c.createWaveShaper()
  shape.curve = softClip(1.5)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.014)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.95)
  o.connect(shape).connect(g)
  place(v, g, 0.45)
  o.start(at)
  o.stop(at + 1.05)
  keep(v, o, at + 1)
  hit(v, at, 180, 0.8, gain * 0.55, 0.36, 0.9)
}

/**
 * Root and tritone held together, detuned just enough to beat against each
 * other. This is the top layer of the whole score and it only exists because
 * "the next one will probably kill you" needs a sound of its own.
 */
function dread(v: Voice, at: number, root: number, dur: number, gain: number): void {
  const c = ac()
  const mix = c.createGain()
  mix.gain.setValueAtTime(0.0001, at)
  mix.gain.exponentialRampToValueAtTime(gain, at + dur * 0.45)
  mix.gain.exponentialRampToValueAtTime(0.0001, at + dur)

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(320, at)
  lp.frequency.linearRampToValueAtTime(900, at + dur * 0.7)
  lp.Q.value = 3
  lp.connect(mix)

  for (const [f, detune] of [
    [root / 2, -4],
    [TRITONE, 5],
    [TRITONE, -9],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = detune
    const og = c.createGain()
    og.gain.value = 0.34
    o.connect(og).connect(lp)
    o.start(at)
    o.stop(at + dur + 0.05)
    keep(v, o, at + dur)
  }
  place(v, mix, 0.9)
}

/** Wordless choir. Three detuned saws behind two formants, arriving slowly. */
function choir(v: Voice, at: number, freq: number, dur: number, gain: number): void {
  const c = ac()
  const mix = c.createGain()
  mix.gain.setValueAtTime(0.0001, at)
  mix.gain.exponentialRampToValueAtTime(gain, at + dur * 0.35)
  mix.gain.exponentialRampToValueAtTime(0.0001, at + dur)

  for (const [f, q, level] of [
    [700, 5, 1],
    [1180, 7, 0.55],
  ] as const) {
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = f
    band.Q.value = q
    const bg = c.createGain()
    bg.gain.value = level
    band.connect(bg).connect(mix)

    for (const detune of [-7, 0, 7]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      o.detune.value = detune
      const og = c.createGain()
      og.gain.value = 0.33
      o.connect(og).connect(band)
      o.start(at)
      o.stop(at + dur + 0.05)
      keep(v, o, at + dur)
    }
  }
  place(v, mix, 1.3)
}

/** A bell with inharmonic partials, for the hour nobody is coming back from. */
function bell(v: Voice, at: number, freq: number, gain: number): void {
  const c = ac()
  for (const [ratio, level, decay] of [
    [1, 1, 3.4],
    [2.76, 0.4, 2.1],
    [5.4, 0.18, 1.3],
  ] as const) {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq * ratio
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain * level, at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    o.connect(g)
    place(v, g, 1.4)
    o.start(at)
    o.stop(at + decay + 0.05)
    keep(v, o, at + decay)
  }
}

/** Bass: a plucked low string with the body left in. */
function bass(v: Voice, at: number, freq: number, gain: number, dur = 0.5): void {
  const c = ac()
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.value = freq
  const drive = c.createWaveShaper()
  drive.curve = softClip(1.6)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 520
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(drive).connect(lp).connect(g)
  place(v, g, 0.3)
  o.start(at)
  o.stop(at + dur + 0.05)
  keep(v, o, at + dur)
}

/**
 * Short filtered noise: the building block for everything percussive.
 *
 * The room amount is a parameter rather than a constant because percussion
 * is where reverb turns into mud fastest - a shaker sent hard into a 1.25s
 * saloon is just hiss, and there is one of them on every eighth note.
 */
function hit(
  v: Voice,
  at: number,
  freq: number,
  q: number,
  gain: number,
  dur: number,
  room = 0.25,
): void {
  const c = ac()
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, dur + 0.02)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(bp).connect(g)
  place(v, g, room)
  src.start(at)
  src.stop(at + dur + 0.05)
  keep(v, src, at + dur)
}

/** Hoof on hard ground: a woodblock crack with a pitch drop under it. */
function clop(v: Voice, at: number, gain: number): void {
  const c = ac()
  hit(v, at, 1750, 9, gain * 0.7, 0.04, 0.2)
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(420, at)
  o.frequency.exponentialRampToValueAtTime(150, at + 0.05)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
  o.connect(g)
  place(v, g, 0.22)
  o.start(at)
  o.stop(at + 0.1)
  keep(v, o, at + 0.08)
}

function snare(v: Voice, at: number, gain: number): void {
  hit(v, at, 1900, 1.1, gain, 0.12, 0.5)
  hit(v, at, 340, 2.4, gain * 0.5, 0.07, 0.3)
}

const shaker = (v: Voice, at: number, gain: number) => hit(v, at, 7200, 4, gain, 0.03, 0.08)

/**
 * A hard, dry wood tick. Reserved for the one state the player cannot argue
 * with - every chamber left is live - where the arrangement stops building
 * and starts counting.
 */
const clock = (v: Voice, at: number, gain: number) => hit(v, at, 2600, 12, gain, 0.022, 0.05)

/* ------------------------------------------------------------- the loop */

let cue: Cue = 'none'
let bed: Voice | null = null
let timer = 0
let step = 0
let stepAt = 0
let intensity = 0
let tempoScale = 1
let phrase = 0

/** Eighth notes, so a 32-step phrase is four bars. */
const stepSeconds = (bpm: number) => 30 / bpm

/**
 * Jitter in [-1, 1], seeded rather than random. Percussion sitting exactly on
 * the grid reads as a drum machine instead of as something played, and the
 * gallop is the most exposed part of the arrangement. Seeding it keeps a
 * render reproducible, so the measurements taken off one stay comparable.
 */
function wobble(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

/** Layer thresholds are on this, not on the raw odds. */
function level(): number {
  if (cue === 'none' || cue === 'intro') return 0
  const { floor } = FLOOR[cue]
  return Math.min(1, floor + intensity * (1 - floor))
}

/**
 * Where the whole bed sits. Adding layers alone does not read as a build -
 * the ear hears new instruments but the same loudness - so the bus comes up
 * with them, and the difference between a fresh cylinder and a nearly empty
 * one is a real crescendo rather than a change of instrumentation.
 *
 * Curved rather than straight, and started low. A linear ride from a high
 * floor spent most of its travel between "loud" and "slightly louder"; the
 * exponent holds the bottom of the range down so there is somewhere for the
 * top of it to go, which measures as roughly nine decibels across the odds
 * a player actually sees instead of six.
 */
const bedLevel = () => 0.24 + 0.76 * level() ** 1.2

/** Follows the intensity rather than jumping, or every chamber would click. */
function rideBed(seconds = 1.1): void {
  if (!bed) return
  const c = ac()
  const target = bedLevel()
  for (const g of [bed.bus.gain, bed.room.gain]) {
    g.cancelScheduledValues(c.currentTime)
    g.setValueAtTime(Math.max(g.value, 0.0001), c.currentTime)
    g.linearRampToValueAtTime(target, c.currentTime + seconds)
  }
}

/** The table leans forward as it gets worse. Gentle: 100bpm becomes 111. */
const tempoFor = (base: number) => base * tempoScale * (1 + level() * 0.11)

/**
 * How far past a threshold the arrangement currently is, 0 to 1. Layers fade
 * in over their first stretch rather than switching on at full level, so a
 * cylinder emptying one chamber at a time is a ramp and not a staircase.
 */
const over = (L: number, from: number, span = 0.14) => Math.min(1, Math.max(0, (L - from) / span))

function scheduleStep(v: Voice, s: number, at: number, bpm: number): void {
  const L = level()
  const bar = Math.floor(s / 8)
  const chord = PROGRESSION[bar]
  const inBar = s % 8
  const spb = stepSeconds(bpm)
  /** Drives the waveshapers. Nothing is dirty until the odds are bad. */
  const bite = over(L, 0.55, 0.45)

  // Bass. Always there; it is what the rest is nailed to.
  if (inBar === 0) bass(v, at, chord.root / 2, 0.3, spb * 3)
  if (inBar === 3) bass(v, at, chord.root / 2, 0.19, spb * 1.6)
  if (inBar === 6) bass(v, at, chord.fifth / 2, 0.17, spb * 1.6)

  // Guitar states the chord on the downbeat from the very quietest layer up.
  if (inBar === 0) twang(v, at, chord.root, 0.1 + L * 0.16, spb * 3.4, bite)

  /*
   * The gallop, pushed and pulled a few milliseconds either side of the beat.
   * Dead on the grid it was a drum machine; this is the single change that
   * makes it sound like hooves.
   */
  const seed = phrase * STEPS + s
  const hoof = over(L, 0.18)
  if (hoof > 0) {
    const accent = inBar % 2 === 0
    const gain = (accent ? 0.16 : 0.085) * (0.35 + L) * hoof * (1 + wobble(seed + 91) * 0.12)
    clop(v, at + wobble(seed) * 0.009, gain)
  }
  if (L > 0.34 && inBar === 4) snare(v, at + wobble(seed + 5) * 0.006, 0.12 * over(L, 0.34))
  if (L > 0.46) shaker(v, at + spb * 0.5 + wobble(seed + 17) * 0.007, 0.04 * over(L, 0.46))
  if (L > 0.66 && inBar === 6) snare(v, at + spb * 0.5, 0.08 * over(L, 0.66))
  // Double time. The hooves break into a run rather than merely getting loud.
  if (L > 0.86) clop(v, at + spb * 0.5 + wobble(seed + 43) * 0.007, 0.07 * over(L, 0.86, 0.1))

  /*
   * The tune. Every other pass the guitar takes the back half of it off the
   * whistle, so hearing the loop twice is not the same as hearing it twice.
   */
  if (L > 0.26) {
    const note = LEAD.find((n) => n.at === s)
    if (note) {
      const whistled = phrase % 2 === 0 || s < 16
      if (whistled) whistle(v, at, note.f, note.len * spb * 0.95)
      if (!whistled || L > 0.52) {
        twang(v, at, note.f / 2, (whistled ? 0.11 : 0.21) * L, note.len * spb, bite)
      }
      if (L > 0.74) tremolo(v, at, note.f / 2, note.len * spb * 0.8, 0.06 * over(L, 0.74), bite)
    }
  }

  // Choir underneath the back half of each bar, once it is properly tense.
  if (L > 0.58 && inBar === 0) choir(v, at, chord.third, spb * 7, 0.065 * over(L, 0.58))

  // A bell on the turn of the phrase, alternating where it falls. Sparse.
  if (L > 0.64 && s === (phrase % 2 === 0 ? 24 : 28)) {
    bell(v, at, phrase % 2 === 0 ? 587.33 : 880.0, 0.08 * over(L, 0.64))
  }

  // A three-hit turnaround out of every second pass, to hand the loop over.
  if (L > 0.6 && phrase % 2 === 1 && s >= 29) snare(v, at, 0.05 + (s - 29) * 0.032)

  /*
   * The danger tier. Everything above this point is the arrangement telling
   * the player what the odds panel is telling them, and it is deliberately
   * the only part of the score that is dissonant.
   */
  if (L > 0.72 && inBar % 4 === 0) sub(v, at, 0.3 * over(L, 0.72, 0.2))
  if (L > 0.8 && inBar === 0) dread(v, at, chord.root, spb * 8, 0.085 * over(L, 0.8, 0.18))
  // Every chamber left is live. The music stops building and starts counting.
  if (L > 0.97) clock(v, at + spb * 0.5, 0.07)
}

function pump(): void {
  if (cue === 'none' || cue === 'intro' || !bed) return
  const c = ac()
  const bpm = tempoFor(FLOOR[cue as Exclude<Cue, 'none' | 'intro'>].bpm)
  const spb = stepSeconds(bpm)

  while (stepAt < c.currentTime + LOOKAHEAD) {
    // A tab that has been in the background has a clock far in the past;
    // catching up note by note would fire hundreds of them at once.
    if (stepAt < c.currentTime - 0.5) stepAt = c.currentTime + 0.05
    scheduleStep(bed, step, stepAt, bpm)
    step += 1
    if (step === STEPS) {
      step = 0
      phrase += 1
    }
    stepAt += spb
  }
}

/**
 * Lays a cue's steps onto an offline timeline. This is the only way to hear
 * the score outside a browser tab: the live loop is driven by the wall clock
 * and an offline context does not have one. scripts/render-score.mjs uses it
 * to bounce the arrangement to a file for listening and for measurement.
 */
export function renderLoop(
  which: Exclude<Cue, 'none' | 'intro'>,
  at: number,
  seconds: number,
): void {
  cue = which
  intensity = at
  // Matching the live bus level, or the render would measure the arrangement
  // without the crescendo that is most of what the intensity actually does.
  const v = voice(bedLevel())
  const bpm = tempoFor(FLOOR[which].bpm)
  const spb = stepSeconds(bpm)
  phrase = 0
  let s = 0
  for (let t = 0.05; t < seconds; t += spb) {
    scheduleStep(v, s % STEPS, t, bpm)
    s += 1
    if (s % STEPS === 0) phrase += 1
  }
}

/* --------------------------------------------------------------- control */

export function setCue(next: Cue): void {
  if (next === cue) return
  const wasLooping = cue !== 'none' && cue !== 'intro'
  cue = next

  if (next === 'intro') {
    if (wasLooping) stopLoop()
    return
  }
  stopIntroScore()

  if (next === 'none') {
    stopLoop()
    return
  }

  ac()
  if (!bed) {
    bed = voice(bedLevel())
    step = 0
    phrase = 0
    stepAt = ac().currentTime + 0.08
  } else {
    rideBed(0.6)
  }
  if (!timer) timer = window.setInterval(pump, TICK_MS)
  pump()
}

function stopLoop(): void {
  window.clearInterval(timer)
  timer = 0
  if (bed) release(bed)
  bed = null
}

/**
 * How live the next chamber is, 0 to 1. Everything above the bass line is
 * gated on this, so the arrangement tightens as the cylinder empties.
 */
export function setIntensity(next: number): void {
  const clamped = Math.max(0, Math.min(1, next))
  if (clamped === intensity) return
  intensity = clamped
  rideBed()
}

/** Faster tables get a faster score; the mapping is deliberately gentle. */
export function setTempoScale(pacing: number): void {
  tempoScale = 1 + (1 - pacing) * 0.34
}

/* ------------------------------------------------------------- the opening */

let opening: Voice | null = null

/**
 * The cinematic's own score, cut to its five shots rather than looped: empty
 * street, empty chair, the gun being loaded, and then the two people who are
 * going to use it. Takes an offset because audio is often still blocked when
 * the film starts, and it should join at the right bar rather than the top.
 */
export function startIntroScore(from = 0): void {
  stopIntroScore()
  const c = ac()
  const v = voice(1)
  opening = v
  const t0 = c.currentTime - from

  /** True for anything the film has not already played past. */
  const due = (when: number) => when >= from - 0.05

  /*
   * The arc. The film now starts close to inaudible and ends with the whole
   * band; before this the cue held one loudness for eleven seconds and merely
   * changed instruments, which is why the last shot did not land.
   */
  const ARC: [number, number][] = [
    [0, 0.3],
    [2.9, 0.42],
    [5.6, 0.62],
    [7.0, 0.82],
    [8.5, 1.0],
  ]
  const arcAt = (when: number): number => {
    let value = ARC[0][1]
    for (const [mark, level] of ARC) {
      if (when < mark) break
      value = level
    }
    return value
  }
  for (const g of [v.bus.gain, v.room.gain]) {
    g.setValueAtTime(arcAt(from), c.currentTime)
    for (const [when, level] of ARC) {
      if (due(when) && t0 + when > c.currentTime) g.linearRampToValueAtTime(level, t0 + when)
    }
  }

  // Wind over the whole thing, and a drone under it.
  const wind = c.createBufferSource()
  wind.buffer = noiseBuffer(c, 4)
  wind.loop = true
  const windFilter = c.createBiquadFilter()
  windFilter.type = 'bandpass'
  windFilter.frequency.value = 480
  windFilter.Q.value = 0.7
  const windLfo = c.createOscillator()
  windLfo.frequency.value = 0.09
  const windDepth = c.createGain()
  windDepth.gain.value = 220
  windLfo.connect(windDepth).connect(windFilter.frequency)
  const windGain = c.createGain()
  windGain.gain.setValueAtTime(0.0001, c.currentTime)
  windGain.gain.linearRampToValueAtTime(0.05, c.currentTime + 1.4)
  wind.connect(windFilter).connect(windGain)
  windGain.connect(v.bus)
  wind.start()
  windLfo.start()
  keep(v, wind, t0 + 12)
  keep(v, windLfo, t0 + 12)

  const drone = c.createOscillator()
  drone.type = 'sawtooth'
  drone.frequency.value = 73.42 // D2
  const droneLp = c.createBiquadFilter()
  droneLp.type = 'lowpass'
  droneLp.frequency.value = 210
  const droneGain = c.createGain()
  droneGain.gain.setValueAtTime(0.0001, c.currentTime)
  droneGain.gain.linearRampToValueAtTime(0.1, c.currentTime + 2)
  droneGain.gain.setValueAtTime(0.1, Math.max(t0 + 9.2, c.currentTime + 0.1))
  droneGain.gain.linearRampToValueAtTime(0.0001, Math.max(t0 + 10.4, c.currentTime + 0.2))
  drone.connect(droneLp).connect(droneGain)
  place(v, droneGain, 0.6)
  drone.start()
  drone.stop(t0 + 10.6)
  keep(v, drone, t0 + 10.5)

  /*
   * Shot by shot, and each cut is now a hit rather than a change of texture:
   * a riser into the cut and a sub drop on it. The gun goes into the cylinder
   * at 5.8s, which is where the gallop starts; the two faces arrive at 7.2
   * and 8.6, which is where the choir and then the whole band do.
   */
  const events: [number, () => void][] = [
    [0.15, () => bell(v, t0 + 0.15, 587.33, 0.11)],
    [0.7, () => whistle(v, t0 + 0.7, 587.33, 1.5)],
    [2.3, () => whistle(v, t0 + 2.3, 698.46, 1.0)],

    // Cut to the empty chair.
    [2.1, () => riser(v, t0 + 2.1, 0.8, 0.1)],
    [2.9, () => boom(v, t0 + 2.9, 0.34)],
    [3.2, () => twang(v, t0 + 3.2, 146.83, 0.17, 2.2)],
    [3.3, () => bass(v, t0 + 3.3, 73.42, 0.3, 1.4)],
    [3.5, () => whistle(v, t0 + 3.5, 880.0, 1.3)],
    [4.7, () => bass(v, t0 + 4.7, 73.42, 0.22, 1.0)],
    [5.0, () => whistle(v, t0 + 5.0, 783.99, 0.85)],

    // Cut to the cylinder being loaded.
    [4.85, () => riser(v, t0 + 4.85, 0.75, 0.13)],
    [5.6, () => boom(v, t0 + 5.6, 0.4)],
    [5.8, () => twang(v, t0 + 5.8, 130.81, 0.2, 2.0, 0.3)],
    [6.5, () => whistle(v, t0 + 6.5, 698.46, 0.8)],

    // Cut to Calloway.
    [6.3, () => riser(v, t0 + 6.3, 0.7, 0.15)],
    [7.0, () => boom(v, t0 + 7.0, 0.46)],
    [7.2, () => choir(v, t0 + 7.2, 146.83, 3.0, 0.09)],
    [7.25, () => twang(v, t0 + 7.25, 116.54, 0.22, 1.8, 0.4)],
    [7.3, () => bass(v, t0 + 7.3, 58.27, 0.32, 1.2)],
    [7.4, () => tremolo(v, t0 + 7.4, 349.23, 1.1, 0.08, 0.35)],

    // Cut to La Viuda, and the tritone arrives with her.
    [7.8, () => riser(v, t0 + 7.8, 0.75, 0.19)],
    [8.5, () => boom(v, t0 + 8.5, 0.54)],
    [8.5, () => dread(v, t0 + 8.5, 146.83, 2.6, 0.12)],
    [8.6, () => twang(v, t0 + 8.6, 110.0, 0.27, 1.9, 0.55)],
    [8.62, () => bass(v, t0 + 8.62, 55.0, 0.38, 1.6)],
    [8.64, () => choir(v, t0 + 8.64, 138.59, 1.9, 0.11)],
    [8.7, () => tremolo(v, t0 + 8.7, 554.37, 1.0, 0.09, 0.5)],
    [9.5, () => bell(v, t0 + 9.5, 554.37, 0.13)],
    [9.55, () => snare(v, t0 + 9.55, 0.18)],
    [9.58, () => whistle(v, t0 + 9.58, 587.33, 1.3)],
  ]

  // The gallop under the second half, riding the arc up with everything else.
  for (let i = 0; i < 26; i++) {
    const when = 5.85 + i * 0.185
    if (when > 9.6) break
    events.push([when, () => clop(v, t0 + when, i % 2 === 0 ? 0.16 : 0.09)])
  }
  for (let i = 0; i < 8; i++) {
    const when = 8.55 + i * 0.155
    events.push([when, () => snare(v, t0 + when, 0.045 + i * 0.018)])
  }
  // A pulse under the last two shots, so the run-in is felt as well as heard.
  for (let i = 0; i < 5; i++) {
    const when = 7.0 + i * 0.75
    events.push([when, () => sub(v, t0 + when, 0.2 + i * 0.05)])
  }

  for (const [when, fire] of events) if (due(when)) fire()

  // Let the tail ring past the cut rather than chopping it.
  window.setTimeout(
    () => {
      if (opening === v) stopIntroScore()
    },
    Math.max(600, (11.6 - from) * 1000),
  )
}

export function stopIntroScore(): void {
  if (!opening) return
  release(opening)
  opening = null
}
