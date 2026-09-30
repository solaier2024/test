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
  /**
   * Multiplier on the third formant, default 1. How bright the sound is, and
   * the one thing about a vowel that is not the vowel.
   *
   * F3 is chest against throat: a sharp intake of breath has a lot up there
   * and a groan out of the bottom of somebody has almost none, and that
   * difference is audible before you can say which vowel either of them is.
   * It became a knob because the room got darker. The conversation is now
   * low-passed at 700-1500Hz to stop it being heard as words, and the
   * measured difference in colour between a gasp and a groan - which had
   * been leaning on the room's own brightness to make up most of it -
   * collapsed from 1.5x to 1.09x. Neither sound had changed. The contrast
   * had been coming from the wrong place, and now it comes from the throat.
   *
   * The values are further apart than they look like they need to be, and
   * that is measured rather than cautious. A reaction is heard over a room
   * that is still going, so what gets measured at the destination is the
   * reaction plus whatever of the room is left under it - and above 1.2kHz
   * the leftovers are almost all of it. Taking the groan's F3 from 1 to 0.55
   * moved its reading from 0.22 to 0.20: nine tenths of that number was the
   * glassware behind it. Small changes here buy nothing, which is also why
   * turning the reactions down 5dB cost the check its margin.
   */
  top?: number
  send: number
}

/**
 * @param into  where the dry signal goes. The sfx bus for a reaction, the
 *        bed's ducking gain for anything that belongs to the room.
 * @param wetTo where the reverb send goes. Anything in the bed has to send
 *        through the bed's own ducked send rather than straight at the
 *        convolver, or hushing the room leaves its reflections running - see
 *        startRoom().
 */
function voice(o: VoiceOpts, into?: AudioNode, wetTo?: AudioNode): void {
  const c = ac()
  const out = c.createGain()
  out.gain.value = 1
  out.connect(into ?? sfxBus())
  const room = c.createGain()
  room.gain.value = o.send
  out.connect(room).connect(wetTo ?? reverbIn())

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
    lvl.gain.value = [1, 0.55, 0.22 * (o.top ?? 1)][i]
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
 *
 * These have now been turned down once, and the reason is worth keeping: the
 * first pass was tuned against a table that could not be heard reacting at
 * all, so every row was pushed until it cleared the room by 10dB, and the
 * result was a building that came apart on EVERY pull. Played for an hour,
 * a flat loss - which is most pulls - was a howl 20dB over the room with the
 * bar going silent for a second and a half behind it, and a five-coin win was
 * a standing ovation.
 *
 * The repair is a ladder rather than a level. A jackpot is still allowed to be
 * the loudest thing in the building; the routine outcomes now sit UNDER the
 * machine's own bell and coin fall, which is the honest ordering - most pulls
 * are a thing the machine did, and the room barely looks up. Three dials, not
 * one:
 *
 *   - gain, down 5 to 6dB on everything except the roar;
 *   - seconds, because a long tail is most of what "over the top" is;
 *   - bed, the depth the room's own muttering ducks to. This is the one that
 *     was doing the real damage. At 0.85 a routine loss stopped twenty
 *     conversations dead, and a room that holds its breath is how you say
 *     "something happened". It should not be saying that four times a minute.
 *     The gasp keeps its deep duck, because a near miss IS the room stopping.
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
  /** See VoiceOpts.top. Chest against throat, and 1 is neutral. */
  top: number
  spread: number
  clap: [number, number]
  /** How far the piano comes down under it, 0 to 1. */
  duck: number
  /** How far the room's own muttering comes down under it, 0 to 1. */
  bed: number
}> = {
  /* Everything at once, up, and held. Hats in the air, and the only row here
   * allowed to be louder than the bell - which is the point of it, and the
   * reason it is the one row that did not come down. It fires at twenty coins
   * or more; a player can go a long time without hearing it.
   *
   * It went slightly UP, from 0.05, while everything around it came down 4dB,
   * and that is the same decision rather than the opposite one. The jackpot
   * has to beat the bell it is cheering - that was the original defect here,
   * and measured it only cleared it by half a dB, which is inside the margin
   * this reading moves between two machines. What a player hears is still the
   * change that was asked for: a jackpot used to be 2dB above an ordinary
   * losing pull and is now 9. */
  roar: { voices: 12, f0: [190, 320], glide: 1.22, vowel: 'a', attack: 0.05, seconds: 2.2, gain: 0.065, breath: 0.2, tremor: 0, top: 1, spread: 0.09, clap: [18, 1.9], duck: 0.3, bed: 0.7 },
  /* A win, but not the one they came to see - so somebody slaps the bar and
   * that is the end of it. It was nine throats and eleven pairs of hands for
   * five coins, which is an ovation for getting your stake back. */
  cheer: { voices: 8, f0: [175, 285], glide: 1.14, vowel: 'a', attack: 0.07, seconds: 1.1, gain: 0.0207, breath: 0.22, tremor: 0, top: 1, spread: 0.13, clap: [6, 1.1], duck: 0.14, bed: 0.45 },
  /* The sound of a room taking one breath in together, on the third reel.
   * Breath is nearly all of it, and noise through a formant is far louder than
   * a sawtooth through the same one, so this gets the smallest gain and the
   * deepest bed duck: a gasp is not a loud sound, it is twenty conversations
   * stopping at once, and it only reads as one if they actually stop. */
  gasp: { voices: 10, f0: [200, 330], glide: 1.35, vowel: 'a', attack: 0.16, seconds: 0.58, gain: 0.0168, breath: 0.85, tremor: 0, top: 3.2, spread: 0.05, clap: [0, 0], duck: 0.32, bed: 0.85 },
  /* Down, slow, and it takes a while to stop. Sits in the same octaves as the
   * bed, so it needs the room out of the way more than it needs volume.
   *
   * The most-heard row on the table, because a flat loss is the commonest
   * thing that happens, and therefore the row that most needed turning down.
   * It went 0.036 -> 0.045 chasing "a loss is answered as loudly as a win",
   * which got a groan to within 3dB of a jackpot - and a groan within 3dB of
   * a jackpot, four times a minute, with a 1.7s fall and the bar silenced
   * behind it, is a funeral. 0.025 with a shorter tail and a much shallower
   * duck is a room noticing. The brief it was chasing is still met, and now
   * from both sides: a loss is answered well clear of the room, and it does
   * not pretend to be the jackpot. */
  sigh: { voices: 9, f0: [120, 185], glide: 0.79, vowel: 'o', attack: 0.26, seconds: 1.3, gain: 0.025, breath: 0.4, tremor: 0, top: 0.35, spread: 0.22, clap: [0, 0], duck: 0.1, bed: 0.55 },
  /* Barely a reaction at all, and the one row here that is meant to stay close
   * to the room.
   *
   * It has more throats than a cheer does, which looks wrong and is not: a
   * murmur is not a few people reacting, it is most of the room CARRYING ON,
   * and the per-voice gain is divided by the root of the count so more of them
   * is a thicker sound rather than a louder one. It was five, and five voices
   * scattered over 300ms barely overlap, so what came out was one throat with
   * a random gain on it - 6.7dB of spread between firings, enough that a
   * murmur could land louder than the jeer it is supposed to sit under. Twelve
   * of them arriving inside 160ms average each other out instead. */
  murmur: { voices: 12, f0: [115, 180], glide: 0.93, vowel: 'u', attack: 0.22, seconds: 1.0, gain: 0.0115, breath: 0.45, tremor: 0, top: 0.7, spread: 0.16, clap: [0, 0], duck: 0.05, bed: 0.18 },
  /* Laughter is the cruellest one in here, so it gets the tremor - and being
   * laughed at does not need to be loud to land, which is why this row came
   * down furthest. Four men at the next table, not the whole bar. */
  jeer: { voices: 7, f0: [155, 250], glide: 0.88, vowel: 'a', attack: 0.05, seconds: 1.15, gain: 0.0176, breath: 0.25, tremor: 7.2, top: 1, spread: 0.16, clap: [3, 1.0], duck: 0.18, bed: 0.5 },
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
      top: s.top,
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

let bed: { talk: GainNode; duck: GainNode[]; stop: () => void } | null = null

/* ----------------------------------------------------------------- the talkers */

/*
 * Ten conversations at the other end of the room.
 *
 * This layer has now been wrong in two opposite directions, and both of them
 * are worth keeping written down because the second one is the more
 * interesting mistake.
 *
 * It started as a bandpass on a noise buffer: a 520Hz hum with the odd
 * syllable dropped on top. That measured fine on every check in the file and
 * it was a hiss, because a noise bed and a crowd have roughly the same
 * long-term spectrum and nothing that averages over a few seconds can tell
 * them apart. What separates them is how the LEVEL moves - speech turns on
 * and off four or five times a second because that is how fast a mouth can
 * change shape - so each talker became a mouth: a glottal sawtooth through
 * two formants that swept between six vowels, gated into syllables, with a
 * hiss spat on the front of half of them for the consonant.
 *
 * That fixed the measurement and broke the sound. Played back, it was
 * unmistakably somebody ENUNCIATING - and since there is no language in here,
 * what it enunciated was gibberish. A player's word for it was aliens, which
 * is exactly right and is the whole diagnosis:
 *
 *   A crowd two tables away is not a voice you cannot understand. It is a
 *   voice you cannot FOLLOW. The moment one throat is trackable, the ear
 *   starts listening for words, and then their absence is the loudest thing
 *   in the mix.
 *
 * Three things made a throat trackable, and all three are gone:
 *
 *   - The consonants. A 20ms hiss in front of a vowel is heard as an attempt
 *     at a word. Removed outright; at this distance a real one would not
 *     survive the air anyway.
 *   - The formant sweeps. Jumping F1/F2 between six vowels every 150ms is
 *     articulation. A throat now sits on ONE vowel colour - its own - and
 *     only jitters a few percent around it, so what varies within a phrase is
 *     pitch and loudness, which is what carries across a room.
 *   - The intelligibility band. Speech is identifiable as speech between
 *     about 1 and 4kHz; ten metres of air and a wall full of people take
 *     that away. The low-pass is now at 1500Hz coming down to 700, which is
 *     the acoustics doing what the acoustics do.
 *
 * And the fourth thing, which is not per-voice at all: there are ten of them
 * and the gaps between their phrases are short, so five or six are always
 * talking at once. Overlap is what stops any one of them being followable -
 * six talkers with three-second gaps spent most of their time as a solo, and
 * a solo is the alien.
 *
 * What survives is the property the brief asks for and the measurement is
 * about: the composite still turns on and off at a syllable rate, so it is
 * still people rather than a hiss. It is simply people you cannot make out.
 *
 * Cheap on purpose. The nodes are built once per talker and live for the
 * session; a syllable is three scheduled automation events on parameters that
 * already exist, not three new nodes.
 */

/**
 * A throat's own vowel colour, [F1, F2] in Hz. One row per talker rather than
 * one per syllable: this is the shape of somebody's mouth and voice, not a
 * sound they are making.
 */
const THROATS: [number, number][] = [
  [560, 940],
  [640, 1080],
  [490, 820],
  [720, 1150],
  [530, 1010],
  [600, 880],
]

interface Talker {
  /** Fills the schedule with syllables up to `until` on the audio clock. */
  say: (until: number) => void
  stop: () => void
}

/**
 * @param f0   where this throat sits. A bar in 1899 is mostly men, so mostly
 *             low, but a room of one pitch is a chord and not a crowd.
 * @param far  0 near, 1 at the other end of the room: duller and wetter.
 * @param pan  where they are standing.
 */
function talker(into: AudioNode, wetTo: AudioNode, f0: number, far: number, pan: number): Talker {
  const c = ac()

  const out = c.createGain()
  out.gain.value = 1
  /*
   * Distance, and it is doing more work here than it looks. A low-pass this
   * low is not a tone control, it is the reason none of this can be mistaken
   * for words: consonants and the formant detail that separates one vowel
   * from another live above it, and they do not get through.
   */
  const dull = c.createBiquadFilter()
  dull.type = 'lowpass'
  dull.frequency.value = 1500 - far * 800
  const where = c.createStereoPanner()
  where.pan.value = pan
  out.connect(dull).connect(where).connect(into)
  /* And mostly reflections, because that is the other half of "across a
   * room". A dry murmur is somebody muttering next to you. */
  const send = c.createGain()
  send.gain.value = 0.55 + far * 0.45
  where.connect(send).connect(wetTo)

  /** The syllable gate. Everything voiced goes through here. */
  const env = c.createGain()
  env.gain.value = 0.0001
  env.connect(out)

  const src = c.createOscillator()
  src.type = 'sawtooth'
  src.frequency.value = f0

  /*
   * Two resonances and nothing above them. The second one is quieter than it
   * would be on a voice next to you, for the same reason as the low-pass:
   * F2 is where the vowel's identity is, and identifiable vowels in a
   * language nobody speaks is the failure mode this layer had.
   */
  const [F1, F2] = THROATS[Math.floor(Math.random() * THROATS.length)]
  const mouth = [
    { hz: F1, q: 4.5, level: 1 },
    { hz: F2, q: 3.5, level: 0.3 },
  ].map(({ hz, q, level }) => {
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = hz
    band.Q.value = q
    const g = c.createGain()
    g.gain.value = level
    src.connect(band).connect(g).connect(env)
    return band
  })
  src.start()

  const level = 0.05 * (1 - far * 0.3)
  let at = c.currentTime + Math.random() * 1.5

  return {
    stop: () => src.stop(),
    say: (until: number) => {
      while (at < until) {
        /* One phrase: a few syllables at a steady rate, then a breath. Nobody
         * talks in an unbroken stream, and the gaps are what let the glasses
         * and the boots through. */
        const count = 2 + Math.floor(Math.random() * 6)
        const rate = 0.15 + Math.random() * 0.11
        const base = f0 * (0.93 + Math.random() * 0.14)
        /* A question now and then, which rises instead of falling. */
        const rising = Math.random() < 0.18
        for (let i = 0; i < count; i++) {
          const t = at + i * rate
          const held = rate * (0.55 + Math.random() * 0.3)
          /* Declination: a spoken sentence drifts down about a fifth from
           * start to finish, and putting that in is most of the difference
           * between talking and chanting. */
          const arc = rising ? 1 + 0.18 * (i / Math.max(1, count - 1)) : 1 - 0.24 * (i / Math.max(1, count - 1))
          src.frequency.setTargetAtTime(base * arc * (0.96 + Math.random() * 0.08), t, 0.05)
          /* A few percent of wobble on his own vowel, which is a jaw moving,
           * not a different vowel. */
          mouth[0].frequency.setTargetAtTime(F1 * (0.96 + Math.random() * 0.08), t, 0.05)
          mouth[1].frequency.setTargetAtTime(F2 * (0.96 + Math.random() * 0.08), t, 0.05)
          /*
           * Soft edges. The old gate opened in 11ms and shut in 18ms, which
           * is a consonant boundary; 35ms either way is a mouth already open
           * changing what it is doing, and it is the difference between
           * syllables you can count and a burble you cannot.
           */
          const loud = level * (0.6 + Math.random() * 0.6) * (i === 0 ? 1.15 : 1)
          env.gain.setTargetAtTime(loud, t, 0.035)
          env.gain.setTargetAtTime(0.0001, t + held, 0.035)
        }
        at += count * rate + 0.25 + Math.random() * gap()
      }
    },
  }
}

/**
 * How long a talker waits before starting again, which is the only thing
 * density changes.
 *
 * Deliberately not a level. The lesson from the last pass was that you make a
 * background come forward by giving it events rather than gain, and the same
 * thing applies to making it come forward MORE: a room fills up by there
 * being less silence in it, not by everyone shouting.
 *
 * Much shorter than it was, and that is the fix for the alien rather than a
 * separate change of taste. With gaps of up to 3.6s across six talkers the
 * room spent most of its time as one voice in the clear, and one voice in the
 * clear is followable. Ten talkers with gaps under two seconds means five or
 * six are always going at once.
 */
let density = 0.35
const gap = () => 1.9 - density * 1.2

/**
 * Somebody at the far end finds something funny.
 *
 * The one thing in the bed that is allowed to be a whole crowd sound rather
 * than one throat, and it is kept well across the room - dull, wet, and off
 * to one side - because laughter close up reads as a reaction to what YOU
 * just did, and it is not: it is four men at another table.
 */
function laughOver(into: AudioNode, wetTo: AudioNode): void {
  const c = ac()
  const n = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n; i++) {
    voice({
      at: c.currentTime + Math.random() * 0.4,
      f0: 145 + Math.random() * 120,
      glide: 0.86 + Math.random() * 0.22,
      vowel: i % 2 ? 'a' : 'o',
      attack: 0.04,
      seconds: 0.6 + Math.random() * 0.7,
      gain: 0.055,
      breath: 0.32,
      tremor: 6.4 + Math.random() * 2.8,
      send: 0.9,
    }, into, wetTo)
  }
}

/**
 * One piece of saloon furniture making a noise: a glass set down, a bottle
 * against a glass, a boot on the boards, a chair going back, the street door.
 *
 * These are what the difference between "a room" and "filtered noise" is made
 * of. The bed on its own is twenty conversations at 520Hz, which reads as a
 * hum; it has no EVENTS in it, and a busy room is mostly events. They are also
 * what keeps the ambience in front of the upright without simply turning the
 * noise up - a hum loud enough to lead the mix is just hiss, while a room with
 * glassware in it reads as busy at a much lower level.
 *
 * Deliberately not on the machine's own sound palette even though the physics
 * overlap: these come up through the bed's ducking gain, so when the room
 * stops to watch a reel, the bar stops with it. A glass landing in the middle
 * of a held breath would be the one thing in the mix that had not noticed.
 */
function clatter(into: AudioNode, wetTo: AudioNode): void {
  const c = ac()
  const at = c.currentTime
  const pick = Math.random()
  const out = c.createGain()
  out.connect(into)
  const room = c.createGain()
  /* Everything in here is across the room, so it is mostly reverb. A dry clink
   * sits in front of the crowd instead of behind it. */
  room.gain.value = 0.8
  out.connect(room).connect(wetTo)

  const ring = (freq: number, gain: number, decay: number) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + decay + 0.05)
  }
  const knock = (freq: number, q: number, gain: number, decay: number) => {
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    s.connect(f).connect(g).connect(out)
    s.start(at, Math.random() * 1.4)
    s.stop(at + decay + 0.05)
  }

  if (pick < 0.24) {
    // A glass down on the bar: the wood first, then what is left ringing in it.
    knock(900, 1.4, 0.05, 0.05)
    ring(1650 + Math.random() * 900, 0.016, 0.28)
  } else if (pick < 0.4) {
    // Bottle against glass, twice, the way pouring sounds from across a room.
    for (let i = 0; i < 2; i++) {
      const t = i * 0.09
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = 2400 + Math.random() * 1400
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, at + t)
      g.gain.linearRampToValueAtTime(0.011, at + t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0001, at + t + 0.2)
      o.connect(g).connect(out)
      o.start(at + t)
      o.stop(at + t + 0.25)
    }
  } else if (pick < 0.62) {
    // Boots on boards. Two or three steps, never evenly spaced.
    const steps = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < steps; i++) {
      const t = i * (0.29 + Math.random() * 0.1)
      const s = c.createBufferSource()
      s.buffer = noiseBuffer(c)
      const f = c.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 320
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, at + t)
      g.gain.linearRampToValueAtTime(0.05, at + t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, at + t + 0.13)
      s.connect(f).connect(g).connect(out)
      s.start(at + t, Math.random() * 1.4)
      s.stop(at + t + 0.2)
    }
  } else if (pick < 0.74) {
    // A chair going back: wood dragging, which is noise with a slope on it.
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(420, at)
    f.frequency.exponentialRampToValueAtTime(760, at + 0.3)
    f.Q.value = 3.2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.03, at + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34)
    s.connect(f).connect(g).connect(out)
    s.start(at, Math.random() * 1.4)
    s.stop(at + 0.4)
  } else if (pick < 0.86) {
    /* Somebody pouring. A bottle emptying is a resonator getting shorter, so
     * the glugs climb - that rise is the whole recognition, and a series of
     * identical blips reads as dripping instead. */
    const glugs = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < glugs; i++) {
      const t = i * (0.1 + Math.random() * 0.05)
      const o = c.createOscillator()
      o.type = 'sine'
      const f = 210 + i * 46 + Math.random() * 30
      o.frequency.setValueAtTime(f, at + t)
      o.frequency.exponentialRampToValueAtTime(f * 1.5, at + t + 0.07)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, at + t)
      g.gain.linearRampToValueAtTime(0.03, at + t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, at + t + 0.09)
      o.connect(g).connect(out)
      o.start(at + t)
      o.stop(at + t + 0.12)
    }
  } else if (pick < 0.95) {
    // Somebody clearing his throat. Voiced, so it is a person and not a prop.
    voice({
      at,
      f0: 105 + Math.random() * 45,
      glide: 0.7,
      vowel: 'o',
      attack: 0.012,
      seconds: 0.22 + Math.random() * 0.14,
      gain: 0.05,
      breath: 0.75,
      tremor: 0,
      send: 0.8,
    }, out, wetTo)
  } else {
    // The street door, and the town for a second, then it shuts.
    knock(140, 0.9, 0.07, 0.22)
    ring(96, 0.02, 0.4)
  }
}

/**
 * The room when nothing is happening: half a dozen conversations two tables
 * away, the bar going about its business, and somebody laughing at the far
 * end now and then. Without this the saloon is an empty room with a machine
 * in it, and every reaction arrives out of silence.
 *
 * Three things hang off one duck:
 *
 *     six people talking, all at once -.
 *     glasses, boots, a chair, a door -+-> duck -> sfx bus
 *     laughter from the far end -------'        \-> reverb
 *
 * They share the duck because when the room stops to watch a reel it ALL
 * stops - a glass landing in the middle of a held breath would be the one
 * thing in the mix that had not noticed. They do not share a level, because
 * the barman keeps pouring however busy the conversation is.
 */
export function startRoom(): void {
  if (bed) return
  const c = ac()

  /* Density, hush and duck all want to move the bed's level and they arrive
   * within milliseconds of each other, so they get a node each rather than
   * three sets of automation fighting over one gain. */
  const ducked = c.createGain()
  ducked.gain.value = 1
  ducked.connect(sfxBus())
  const room = c.createGain()
  room.gain.value = 0.7
  ducked.connect(room).connect(reverbIn())

  /*
   * And a second ducking gain in front of the reverb, because a talker two
   * tables away is mostly reflections and the amount of reflection is HOW you
   * know they are two tables away. That means per-source sends, and a
   * per-source send aimed at the shared convolver goes round the duck above.
   *
   * Which is exactly what it did. The silence check - the one that asks
   * whether calling the house stops the room - wants 20dB and measured 12:
   * the dry conversation stopped dead and its reflections carried on washing
   * about the building, which is not a room falling silent, it is a room with
   * the speech muted. Everything in the bed sends through here instead.
   */
  const wet = c.createGain()
  wet.gain.value = 1
  wet.connect(reverbIn())

  const talk = c.createGain()
  talk.gain.value = 0.0001
  talk.gain.linearRampToValueAtTime(1, c.currentTime + 2.5)
  talk.connect(ducked)

  /* The bar's own noises, at their own level. Set by ear against the machine
   * and then checked: verify-audio insists the ambience leads an idle table
   * and that a pull is still clearly louder than it. */
  const bar = c.createGain()
  bar.gain.value = 2
  bar.connect(ducked)

  /* And the other end of the room, which only laughter comes from. Dull and
   * far enough back that it never sounds like it is about you. */
  const across = c.createGain()
  across.gain.value = 0.5
  const wall = c.createBiquadFilter()
  wall.type = 'lowpass'
  wall.frequency.value = 1150
  across.connect(wall).connect(ducked)

  /*
   * Ten, and the count is load-bearing. It was six, and six with long gaps
   * between phrases left one throat in the clear most of the time - which the
   * ear follows, fails to get words out of, and reports as gibberish. Ten
   * with short gaps means five or six going at once and no single line to
   * follow, which is what a busy room actually is.
   *
   * Pitches, distances and places in the stereo field are all spread, because
   * a room of one voice repeated is a chorus. Nobody is at far = 0: there is
   * nobody standing next to you in any of these shots, and a near-field
   * talker is the one voice that would be trackable again.
   */
  const talkers = [
    talker(talk, wet, 118, 0.3, -0.55),
    talker(talk, wet, 142, 0.45, 0.35),
    talker(talk, wet, 97, 0.7, -0.15),
    talker(talk, wet, 176, 0.55, 0.7),
    talker(talk, wet, 131, 0.9, 0.1),
    talker(talk, wet, 205, 0.8, -0.8),
    talker(talk, wet, 109, 0.5, 0.55),
    talker(talk, wet, 156, 0.75, -0.35),
    talker(talk, wet, 124, 0.95, 0.85),
    talker(talk, wet, 188, 0.65, -0.05),
  ]

  let alive = true
  /* Two seconds of syllables, topped up four times a second. Scheduling
   * further ahead would be cheaper and would also mean the room carries on
   * talking for two seconds after somebody calls the house. */
  const keepTalking = window.setInterval(() => {
    if (!alive) return
    const until = ac().currentTime + 2
    for (const t of talkers) t.say(until)
  }, 250)

  /* The bar, on its own clock. Nothing lands on top of a reaction, because
   * the room holding its breath has to include the man pouring the drinks. */
  const knockAbout = () => {
    if (!alive) return
    if (ac().currentTime >= quietUntil) clatter(bar, wet)
    /* One every second or so. It was one every two, and the brief for this
     * room is glasses, pouring and chairs as well as talking - at two-second
     * spacing those read as the occasional noise in a quiet bar rather than
     * as a bar doing business. */
    window.setTimeout(knockAbout, 620 + Math.random() * 1500)
  }
  window.setTimeout(knockAbout, 800)

  const laughing = () => {
    if (!alive) return
    if (ac().currentTime >= quietUntil) laughOver(across, wet)
    window.setTimeout(laughing, 9000 + Math.random() * 16000)
  }
  window.setTimeout(laughing, 6000 + Math.random() * 8000)

  bed = {
    talk,
    duck: [ducked, wet],
    stop: () => {
      alive = false
      window.clearInterval(keepTalking)
      for (const t of talkers) t.stop()
    },
  }
}

/**
 * The room pressing in. Driven by heat and by the last reaction.
 *
 * It buys less silence rather than more volume - see gap(). The level moves a
 * little too, but only a little: the audible change between a quiet bar and a
 * busy one is that nobody is ever not talking, not that everybody is shouting.
 */
export function setRoomDensity(next: number): void {
  density = Math.max(0, Math.min(1, next))
  if (!bed) return
  const c = ac()
  bed.talk.gain.linearRampToValueAtTime(0.8 + density * 0.45, c.currentTime + 0.8)
}

/** Until when the bed is under a reaction, on the audio clock. */
let quietUntil = 0

/**
 * The muttering stops while the room reacts.
 *
 * This is not polish, it is the difference between the brief being met and
 * not. The bed is six men talking and a groan is an "aww" gliding down
 * through 130Hz with its formants at 570 and 840 - literally the same
 * instrument in the same octaves, so the bed masks it almost exactly, and
 * more so now the bed is voices in earnest. Measured at the
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
  const now = c.currentTime
  /* Both of them, dry and send, on one curve - see startRoom(). */
  for (const node of bed.duck) {
    const g = node.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(1 - amount, now + 0.07)
    g.setValueAtTime(1 - amount, now + 0.07 + hold)
    g.linearRampToValueAtTime(1, now + 0.07 + hold + release)
  }
  quietUntil = Math.max(quietUntil, now + 0.07 + hold)
}

export function stopRoom(): void {
  bed?.stop()
  bed = null
}

/**
 * The conversation on its own, for verify-audio.mjs.
 *
 * Handed over because the claim being checked is specifically about THIS
 * layer - that it is people and not a noise generator - and the sfx bus has
 * the glasses, the boots and the machine on it too. Measuring the mixture
 * would leave the interesting part provable only by elimination.
 */
export const talkBus = () => bed?.talk ?? null

/**
 * Everything stops. Used when the count is called - the oldest gesture in the
 * genre and the only moment on this table where the room is silent.
 *
 * On the ducks rather than on the conversation, because EVERYTHING means the
 * barman too, and the reflections as well as the sound that caused them.
 * Hushing one layer at a time has failed this check twice now, 8dB short when
 * the glasses were outside the duck and 12dB short when the talkers' reverb
 * sends were. quietUntil then stops anything new from starting during it.
 */
export function hush(seconds: number): void {
  const c = ac()
  if (!bed) return
  for (const node of bed.duck) {
    const g = node.gain
    g.cancelScheduledValues(c.currentTime)
    g.setValueAtTime(g.value, c.currentTime)
    g.linearRampToValueAtTime(0.0001, c.currentTime + 0.14)
    g.setValueAtTime(0.0001, c.currentTime + seconds)
    g.linearRampToValueAtTime(1, c.currentTime + seconds + 1.2)
  }
  quietUntil = Math.max(quietUntil, c.currentTime + seconds)
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
