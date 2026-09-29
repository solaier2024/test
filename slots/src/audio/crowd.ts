import { ac, duck, noiseBuffer, reverbIn, sfxBus, softClip } from './engine'
import type { Reaction } from '../game/types'

/*
 * The room, synthesised.
 *
 * There is no dealer on this table, so the crowd is the whole opponent: it is
 * the odds readout, the pressure, and the jury on a call. That makes it the one
 * thing here that sounds like it has to be a recording - a dozen men groaning
 * is not an obvious candidate for an oscillator.
 *
 * It is not, though. A crowd is a lot of slightly out of tune throats, and a
 * throat is a buzz through three resonances. Eleven of those, detuned and
 * staggered by a few tens of milliseconds, with a pitch contour on top and some
 * breath underneath, is a crowd - and the useful part is that the groan and the
 * cheer come out of the SAME numbers with two or three of them changed. That is
 * how you know it is the same room both times, which two separate recordings
 * would have to get lucky to achieve.
 *
 * Keeping it synthesised also keeps the project's rule intact: not one audio
 * file in the repository, nothing to license, and nothing to download before
 * the room has a sound.
 */

/** Formants, in Hz: the shape of the mouth, which is what makes it a vowel. */
const VOWEL = {
  /* "aah" - open, bright, what a cheer is */
  a: [730, 1090, 2440],
  /* "aww" - rounder and darker, what a groan is */
  o: [570, 840, 2410],
  /* "uh" - the vowel of not saying anything in particular */
  u: [520, 1190, 2390],
} as const

interface VoiceOpts {
  at: number
  /** Where the throat starts, in Hz. Men in a bar: 110 to 260. */
  f0: number
  /** Multiplier on f0 by the end of the sound. Down is a groan, up is a cheer. */
  glide: number
  vowel: keyof typeof VOWEL
  attack: number
  seconds: number
  gain: number
  /** 0 to 1, how much of it is breath rather than voice. */
  breath: number
  /** Hz, or 0. A laugh is a voice with a tremor on it. */
  tremor: number
  send: number
}

function voice(o: VoiceOpts): void {
  const c = ac()
  const out = c.createGain()
  out.gain.value = 1
  out.connect(sfxBus())
  const room = c.createGain()
  room.gain.value = o.send
  out.connect(room).connect(reverbIn())

  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, o.at)
  env.gain.linearRampToValueAtTime(o.gain, o.at + o.attack)
  env.gain.setValueAtTime(o.gain, o.at + o.attack)
  env.gain.exponentialRampToValueAtTime(0.0001, o.at + o.seconds)
  env.connect(out)

  /* A tremor is the difference between shouting and laughing. */
  if (o.tremor) {
    const lfo = c.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = o.tremor
    const depth = c.createGain()
    depth.gain.value = o.gain * 0.55
    lfo.connect(depth).connect(env.gain)
    lfo.start(o.at)
    lfo.stop(o.at + o.seconds + 0.05)
  }

  const src = c.createOscillator()
  src.type = 'sawtooth'
  src.frequency.setValueAtTime(o.f0, o.at)
  src.frequency.exponentialRampToValueAtTime(Math.max(40, o.f0 * o.glide), o.at + o.seconds)

  const air = c.createBufferSource()
  air.buffer = noiseBuffer(c)
  air.loop = true
  const airGain = c.createGain()
  airGain.gain.value = o.breath * 0.7

  // One band per formant, summed. Three is enough for a vowel to be a vowel.
  VOWEL[o.vowel].forEach((f, i) => {
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = f * (0.94 + Math.random() * 0.12)
    band.Q.value = 7 - i * 1.6
    const lvl = c.createGain()
    lvl.gain.value = [1, 0.55, 0.22][i]
    src.connect(band)
    air.connect(airGain).connect(band)
    band.connect(lvl).connect(env)
  })

  src.start(o.at)
  src.stop(o.at + o.seconds + 0.05)
  air.start(o.at, Math.random() * 1.2)
  air.stop(o.at + o.seconds + 0.05)
}

/** Hands. Short, bright, and never on the beat. */
function claps(at: number, count: number, seconds: number, gain: number): void {
  const c = ac()
  for (let i = 0; i < count; i++) {
    const t = at + Math.random() * seconds
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 1100 + Math.random() * 2200
    f.Q.value = 0.9
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain * (0.5 + Math.random() * 0.7), t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    const room = c.createGain()
    room.gain.value = 0.5
    s.connect(f).connect(g).connect(sfxBus())
    g.connect(room).connect(reverbIn())
    s.start(t, Math.random() * 1.4)
    s.stop(t + 0.1)
  }
}

/**
 * What each reaction is, as numbers. Every row is the same instrument - the
 * differences between a groan and a cheer are the pitch, which way it slides,
 * how fast it arrives, and how wide the mouth is.
 */
const SHAPE: Record<Reaction, {
  voices: number
  f0: [number, number]
  glide: number
  vowel: keyof typeof VOWEL
  attack: number
  seconds: number
  gain: number
  breath: number
  tremor: number
  spread: number
  clap: [number, number]
  /** How far the piano comes down under it, 0 to 1. */
  duck: number
  /** How far the room's own muttering comes down under it, 0 to 1. */
  bed: number
}> = {
  /* Everything at once, up, and held. Hats in the air, and the loudest thing
   * on the table - louder than the bell, which is the point of it. */
  roar: { voices: 14, f0: [190, 320], glide: 1.22, vowel: 'a', attack: 0.05, seconds: 2.5, gain: 0.05, breath: 0.2, tremor: 0, spread: 0.09, clap: [26, 2.1], duck: 0.3, bed: 0.7 },
  /* A win, but not the one they came to see. */
  cheer: { voices: 9, f0: [175, 285], glide: 1.14, vowel: 'a', attack: 0.07, seconds: 1.5, gain: 0.04, breath: 0.22, tremor: 0, spread: 0.13, clap: [11, 1.2], duck: 0.2, bed: 0.7 },
  /* The sound of a room taking one breath in together, on the third reel.
   * Breath is nearly all of it, and noise through a formant is far louder than
   * a sawtooth through the same one, so this gets the smallest gain and the
   * deepest bed duck: a gasp is not a loud sound, it is twenty conversations
   * stopping at once, and it only reads as one if they actually stop. */
  gasp: { voices: 11, f0: [200, 330], glide: 1.35, vowel: 'a', attack: 0.16, seconds: 0.62, gain: 0.029, breath: 0.85, tremor: 0, spread: 0.05, clap: [0, 0], duck: 0.42, bed: 0.92 },
  /* Down, slow, and it takes a while to stop. Sits in the same octaves as the
   * bed, so it needs the room out of the way more than it needs volume. */
  sigh: { voices: 10, f0: [120, 185], glide: 0.72, vowel: 'o', attack: 0.3, seconds: 1.7, gain: 0.036, breath: 0.4, tremor: 0, spread: 0.22, clap: [0, 0], duck: 0.12, bed: 0.85 },
  /* Somebody says something to somebody else. Barely a reaction at all, and
   * the one row here that is meant to stay close to the room. */
  murmur: { voices: 5, f0: [115, 180], glide: 0.93, vowel: 'u', attack: 0.22, seconds: 1.1, gain: 0.024, breath: 0.45, tremor: 0, spread: 0.3, clap: [0, 0], duck: 0.06, bed: 0.25 },
  /* Laughter is the cruellest one in here, so it gets the tremor. */
  jeer: { voices: 8, f0: [155, 250], glide: 0.88, vowel: 'a', attack: 0.05, seconds: 1.45, gain: 0.034, breath: 0.25, tremor: 7.2, spread: 0.16, clap: [4, 1.1], duck: 0.26, bed: 0.75 },
}

/**
 * What a row of the table above is worth as an amplitude.
 *
 * It is a big number and it has to be. A voice here is a sawtooth through
 * three narrow formant bandpasses, and those throw nearly all of it away: only
 * the two or three harmonics that happen to fall inside a 100Hz window survive,
 * and then the pitch glide sweeps them back out of it. The arithmetic is not
 * obvious from the source, which is why this was wrong for so long - measured
 * at the destination, the entire crowd at the old value of 2.4 peaked at
 * -37dBFS against a room tone of -36dBFS. Fourteen men shouting were quieter
 * than the room, and 7dB under the coin fall. Every "the crowd reacted" in the
 * transcript up to that point was really the coins and the bell.
 *
 * The value below comes from sweeping it against those two, which are the
 * things a reaction has to be heard over, and verify-audio.mjs is what stops
 * it drifting back.
 */
const THROAT = 13

/**
 * @param density 0 to 1. How many of them are standing there, which the table
 *        raises as the night gets louder and the room closes in.
 *
 * Note that density moves how MANY throats there are and not how loud the room
 * is: the per-voice gain is divided by the square root of the count, so n
 * incoherent voices come out at roughly the same level however many there are.
 * A fuller room is a thicker sound, not a louder one.
 */
export function react(kind: Reaction, density = 0.6): void {
  const c = ac()
  const s = SHAPE[kind]
  const n = Math.max(3, Math.round(s.voices * (0.55 + density * 0.6)))
  for (let i = 0; i < n; i++) {
    voice({
      // Nobody in a real room starts at the same instant.
      at: c.currentTime + Math.random() * s.spread,
      f0: s.f0[0] + Math.random() * (s.f0[1] - s.f0[0]),
      glide: s.glide * (0.96 + Math.random() * 0.08),
      vowel: s.vowel,
      attack: s.attack * (0.8 + Math.random() * 0.5),
      seconds: s.seconds * (0.82 + Math.random() * 0.36),
      gain: (s.gain / Math.sqrt(n)) * (0.6 + Math.random() * 0.9) * THROAT,
      breath: s.breath,
      tremor: s.tremor ? s.tremor * (0.9 + Math.random() * 0.25) : 0,
      send: 0.45,
    })
  }
  if (s.clap[0]) claps(c.currentTime + 0.12, Math.round(s.clap[0] * (0.5 + density)), s.clap[1], 0.05)
  duck(s.duck, kind === 'roar' ? 0.5 : 0.2, 0.9)
  /* And the muttering stops, which is most of how a groan gets heard at all -
   * see bedDuck(). The hold is the useful part of the sound; the rest of it is
   * the tail, and the room can start talking again over that. */
  bedDuck(s.bed, s.seconds * 0.55, 0.9)
}

/* ------------------------------------------------------------------- the bed */

let bed: { gain: GainNode; duck: GainNode; stop: () => void } | null = null

/**
 * The room when nothing is happening: a dozen conversations two tables away,
 * which is filtered noise with a slow wobble on it and the odd syllable poking
 * through. Without this the saloon sounds like an empty room with a machine in
 * it, and every reaction arrives out of silence.
 */
export function startRoom(): void {
  if (bed) return
  const c = ac()
  const out = c.createGain()
  out.gain.value = 0.0001
  out.connect(sfxBus())
  const room = c.createGain()
  room.gain.value = 0.7
  out.connect(room).connect(reverbIn())
  out.gain.linearRampToValueAtTime(0.1, c.currentTime + 2.5)

  /* Density, hush and duck all want to move the bed's level and they arrive
   * within milliseconds of each other, so they get a node each rather than
   * three sets of automation fighting over one gain. */
  const ducked = c.createGain()
  ducked.gain.value = 1
  ducked.connect(out)

  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 4)
  src.loop = true
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 520
  band.Q.value = 0.85
  const wobble = c.createGain()
  wobble.gain.value = 0.55
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.23
  const depth = c.createGain()
  depth.gain.value = 0.3
  lfo.connect(depth).connect(wobble.gain)
  src.connect(band).connect(wobble).connect(ducked)
  src.start()
  lfo.start()

  // A syllable now and then, so it is people and not weather.
  let alive = true
  const blip = () => {
    if (!alive) return
    /* Not over a reaction. A blip is one man talking at conversational level,
     * and it is the loudest thing the bed does - letting one land in the
     * middle of a groan puts a stray syllable on top of the sound the whole
     * room is supposed to be making together. */
    if (ac().currentTime < quietUntil) {
      window.setTimeout(blip, 600)
      return
    }
    voice({
      at: ac().currentTime,
      f0: 110 + Math.random() * 90,
      glide: 0.9 + Math.random() * 0.2,
      vowel: 'u',
      attack: 0.05,
      seconds: 0.18 + Math.random() * 0.3,
      gain: 0.013,
      breath: 0.5,
      tremor: 0,
      send: 0.7,
    })
    window.setTimeout(blip, 700 + Math.random() * 2600)
  }
  window.setTimeout(blip, 1200)

  bed = {
    gain: out,
    duck: ducked,
    stop: () => {
      alive = false
      src.stop()
      lfo.stop()
    },
  }
}

/** The room pressing in, as a level. Driven by heat and by the last reaction. */
export function setRoomDensity(density: number): void {
  if (!bed) return
  const c = ac()
  bed.gain.gain.linearRampToValueAtTime(0.07 + density * 0.16, c.currentTime + 0.8)
}

/** Until when the bed is under a reaction, on the audio clock. */
let quietUntil = 0

/**
 * The muttering stops while the room reacts.
 *
 * This is not polish, it is the difference between the brief being met and
 * not. The bed is conversation at 520Hz and a groan is an "aww" gliding down
 * through 130Hz with its formants at 570 and 840 - they are the same sound in
 * the same octaves, so the bed masks it almost exactly. Measured at the
 * destination before this existed, a win added 2.4x as much energy above
 * 1.2kHz as below it and was 8dB clear of the room, while a groan added 0.001
 * in three bands and a gasp was not distinguishable from the room at all. The
 * table cheered a win and said nothing you could hear about a loss, which is
 * half the brief missing and none of it visible in the source.
 *
 * A real room does this anyway: twenty conversations stop when something
 * happens at the table, and start again while the groan is still fading.
 */
function bedDuck(amount: number, hold: number, release: number): void {
  if (!bed || amount <= 0) return
  const c = ac()
  const g = bed.duck.gain
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(1 - amount, now + 0.07)
  g.setValueAtTime(1 - amount, now + 0.07 + hold)
  g.linearRampToValueAtTime(1, now + 0.07 + hold + release)
  quietUntil = Math.max(quietUntil, now + 0.07 + hold)
}

export function stopRoom(): void {
  bed?.stop()
  bed = null
}

/**
 * Everything stops. Used when the count is called - the oldest gesture in the
 * genre and the only moment on this table where the room is silent.
 */
export function hush(seconds: number): void {
  const c = ac()
  if (!bed) return
  const g = bed.gain.gain
  g.cancelScheduledValues(c.currentTime)
  g.setValueAtTime(g.value, c.currentTime)
  g.linearRampToValueAtTime(0.0001, c.currentTime + 0.14)
  g.setValueAtTime(0.0001, c.currentTime + seconds)
  g.linearRampToValueAtTime(0.12, c.currentTime + seconds + 1.2)
}

/** One man, close, saying it out loud, over the top of everything. */
export function callOut(): void {
  const c = ac()
  const shaped = softClip(c, 2.4)
  const room = c.createGain()
  room.gain.value = 0.6
  shaped.connect(sfxBus())
  shaped.connect(room).connect(reverbIn())
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(150, c.currentTime)
  o.frequency.exponentialRampToValueAtTime(96, c.currentTime + 0.55)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 700
  band.Q.value = 3
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, c.currentTime)
  g.gain.linearRampToValueAtTime(0.2, c.currentTime + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6)
  o.connect(band).connect(g).connect(shaped)
  o.start()
  o.stop(c.currentTime + 0.7)
  duck(0.5, 0.35, 1.0)
}
