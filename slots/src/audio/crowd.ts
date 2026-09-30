import { ac, duck, noiseBuffer, reverbIn, sfxBus, softClip } from './engine'
import { cardTable } from './cards'
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
 * throat is a buzz through resonances. Fifteen of those, detuned and staggered,
 * with a pitch contour on top and some breath underneath, is a crowd - and the
 * useful part is that the groan and the cheer come out of the SAME numbers with
 * two or three of them changed. That is how you know it is the same room both
 * times, which two separate recordings would have to get lucky to achieve.
 *
 * Keeping it synthesised also keeps the project's rule intact: not one audio
 * file in the repository, nothing to license, and nothing to download before
 * the room has a sound.
 *
 * THIS IS THE THIRD ROOM, and it was rebuilt rather than remixed. A player came
 * back from the preview and said it sounded about the same as the last one, and
 * he was right about every layer he named. The diagnosis for the room is the
 * same shape as the diagnosis for the band: the previous two passes had changed
 * how MUCH of it there was - more talkers, shorter gaps, a different low-pass -
 * and had never changed what it was made of or what it was doing. Two things
 * changed here, and both of them are structural rather than a fader:
 *
 *   THE VOICES ARE NOT SAWTOOTHS ANY MORE. Every throat in this file used to be
 *     a sawtooth through bandpasses, and a sawtooth is a buzz with a -6dB per
 *     octave slope and nothing else to say. A larynx is a valve: it slams shut
 *     once a cycle and is open for rather less than half of it, so the
 *     excitation is a sharp pulse train with a spectrum that is nothing like a
 *     ramp's. glottis() builds that pulse and the whole room now runs on it -
 *     the conversation, the reactions, the laugh at the far end, all of it.
 *
 *   THE CONVERSATION IS CONVERSATIONS. It used to be ten throats each babbling
 *     on a clock of its own, which measures as a crowd and does not sound like
 *     one, because nobody in it was talking TO anybody. It is now six groups of
 *     two or three men, and inside a group only one of them holds the floor: he
 *     says something, somebody else answers a quarter of a second later, a third
 *     agrees over the top of him, and every few turns the group runs out of
 *     subject and pauses. Turn-taking at that timescale is the single most
 *     recognisable thing about overheard speech, and it costs nothing to put in.
 *
 * And a whole layer was added: there is a card game going at the table behind
 * you now, which is in cards.ts.
 */

/** Formants, in Hz: the shape of the mouth, which is what makes it a vowel. */
const VOWEL = {
  /* "aah" - open, bright, what a cheer is */
  a: [730, 1090, 2440],
  /* "aww" - rounder and darker, what a groan is */
  o: [570, 840, 2410],
  /* "uh" - the vowel of not saying anything in particular */
  u: [520, 1190, 2390],
  /* "ohh" - the back vowel a room makes at a near miss, further back and
   * further down than "aww". New, and it is here because the two losing
   * reactions had to stop being the same mouth at two speeds. */
  w: [400, 750, 2400],
} as const

/**
 * The larynx, as one cycle of a wave.
 *
 * This replaced a sawtooth on every voice in the project and it is the reason
 * the room sounds like a different room. A sawtooth is a mathematically
 * convenient buzz: every harmonic present, amplitude 1/n, phases aligned. A
 * vocal fold is a valve with a duty cycle - it opens slowly, snaps shut, and
 * stays shut for the rest of the period - so its flow derivative is a sharp
 * negative spike with a long shallow ramp in front of it. That gives a
 * spectrum with much more weight in its first three or four harmonics, a
 * steeper roll-off above them, and the characteristic grain that makes a buzz
 * read as somebody rather than as electronics.
 *
 * It is computed rather than approximated. The Rosenberg glottal flow model is
 * sampled over a period, differentiated, and transformed into the harmonic
 * coefficients createPeriodicWave wants. Doing the arithmetic properly is
 * cheaper than it sounds - once per context, about fifty thousand multiplies -
 * and it means the shape is the model's rather than something that was tuned
 * until it sounded about right.
 *
 * @param open what fraction of the cycle the glottis is open for. Around 0.6
 *        is a relaxed voice; pushing it down to 0.4 is a pressed, shouted one,
 *        which is why a reaction gets a different value from a conversation.
 */
const glottalCache = new Map<string, PeriodicWave>()
function glottis(c: BaseAudioContext, open: number): PeriodicWave {
  const key = open.toFixed(2)
  const hit = glottalCache.get(key)
  if (hit) return hit

  const N = 512
  const HARMONICS = 40
  /* Rosenberg: a raised cosine opening for two thirds of the open phase, a
   * quarter cosine slamming shut over the remaining third, then nothing. */
  const rise = open * (2 / 3)
  const fall = open - rise
  const flow = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) {
    const t = i / N
    if (t < rise) flow[i] = 0.5 * (1 - Math.cos((Math.PI * t) / rise))
    else if (t < open) flow[i] = Math.cos((Math.PI * (t - rise)) / (2 * fall))
    else flow[i] = 0
  }
  /* The vocal tract is excited by the derivative of the flow, not the flow. */
  const drive = new Float64Array(N)
  for (let i = 0; i < N; i++) drive[i] = flow[i + 1] - flow[i]

  const real = new Float32Array(HARMONICS)
  const imag = new Float32Array(HARMONICS)
  for (let h = 1; h < HARMONICS; h++) {
    let re = 0
    let im = 0
    for (let i = 0; i < N; i++) {
      const w = (2 * Math.PI * h * i) / N
      re += drive[i] * Math.cos(w)
      im -= drive[i] * Math.sin(w)
    }
    real[h] = (2 * re) / N
    imag[h] = (2 * im) / N
  }
  const wave = c.createPeriodicWave(real, imag, { disableNormalization: false })
  glottalCache.set(key, wave)
  return wave
}

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
   * Glottal open quotient - see glottis(). Lower is a harder, more pressed
   * voice with more upper harmonics in it, which is what shouting is.
   * Defaults to a relaxed 0.62.
   */
  press?: number
  /**
   * Multiplier on the third formant, default 1. How bright the sound is, and
   * the one thing about a vowel that is not the vowel.
   *
   * F3 is chest against throat: a sharp intake of breath has a lot up there
   * and a groan out of the bottom of somebody has almost none, and that
   * difference is audible before you can say which vowel either of them is.
   * It became a knob because the room got darker. The conversation is
   * low-passed to stop it being heard as words, and the measured difference in
   * colour between a gasp and a groan - which had been leaning on the room's
   * own brightness to make up most of it - collapsed from 1.5x to 1.09x.
   * Neither sound had changed. The contrast had been coming from the wrong
   * place, and now it comes from the throat.
   *
   * The values are further apart than they look like they need to be, and
   * that is measured rather than cautious. A reaction is heard over a room
   * that is still going, so what gets measured at the destination is the
   * reaction plus whatever of the room is left under it - and above 1.2kHz
   * the leftovers are almost all of it. Taking the groan's F3 from 1 to 0.55
   * moved its reading from 0.22 to 0.20: nine tenths of that number was the
   * glassware behind it. Small changes here buy nothing, which is also why
   * turning the reactions down 5dB cost the check its margin. There is now a
   * card game in the room as well, which is brighter than glassware, so the
   * spread here had to widen again.
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
  src.setPeriodicWave(glottis(c, o.press ?? 0.62))
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
    /*
     * Two filters rather than one, because a cupped hand is a resonator and
     * the old single bandpass was a hand-shaped click with no hand in it. The
     * lowpass is the palm and the peak is the air trapped under it, which is
     * what makes a clap a thud with a snap on it instead of a tick.
     */
    const palm = c.createBiquadFilter()
    palm.type = 'lowpass'
    palm.frequency.value = 2600 + Math.random() * 1800
    const cup = c.createBiquadFilter()
    cup.type = 'peaking'
    cup.frequency.value = 620 + Math.random() * 380
    cup.Q.value = 1.8
    cup.gain.value = 9
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain * (0.5 + Math.random() * 0.7), t + 0.0015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045 + Math.random() * 0.03)
    const room = c.createGain()
    room.gain.value = 0.5
    s.connect(palm).connect(cup).connect(g).connect(sfxBus())
    g.connect(room).connect(reverbIn())
    s.start(t, Math.random() * 1.4)
    s.stop(t + 0.12)
  }
}

/**
 * Two fingers in the mouth, which is the loudest noise a person can make and
 * the one a bar makes when somebody wins real money.
 *
 * New, and it is here because the roar needed something in it that was not a
 * throat. Twelve men shouting the same vowel is a wall of sound with no detail
 * in it, so however loud it got it stayed an undifferentiated blare; a whistle
 * cuts through it because it is the only narrow-band thing in the building.
 * It is also physically the right sound - a Helmholtz resonator driven by an
 * edge tone, so it is nearly a pure tone with a slight breathiness and it
 * swoops, because the tongue moves.
 */
function whistle(at: number, gain: number): void {
  const c = ac()
  const seconds = 0.5 + Math.random() * 0.5
  const hz = 1700 + Math.random() * 900
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(hz * 0.8, at)
  o.frequency.exponentialRampToValueAtTime(hz, at + 0.06)
  /* Up at the end, which is what a cheer-whistle does and what a summoning
   * whistle does not. */
  o.frequency.exponentialRampToValueAtTime(hz * (1.1 + Math.random() * 0.25), at + seconds)
  /* A whistle is never quite steady: the breath wobbles it a few Hz. */
  const wobble = c.createOscillator()
  wobble.type = 'sine'
  wobble.frequency.value = 4.5 + Math.random() * 3
  const width = c.createGain()
  width.gain.value = hz * 0.012
  wobble.connect(width).connect(o.frequency)
  wobble.start(at)
  wobble.stop(at + seconds + 0.1)
  /* And it is driven by air, so there is air in it. */
  const breath = c.createBufferSource()
  breath.buffer = noiseBuffer(c)
  breath.loop = true
  const slot = c.createBiquadFilter()
  slot.type = 'bandpass'
  slot.frequency.value = hz
  slot.Q.value = 3
  const hiss = c.createGain()
  hiss.gain.value = 0.18
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.05)
  g.gain.setValueAtTime(gain, at + seconds * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  const room = c.createGain()
  room.gain.value = 0.5
  o.connect(g).connect(sfxBus())
  breath.connect(slot).connect(hiss).connect(g)
  g.connect(room).connect(reverbIn())
  o.start(at)
  o.stop(at + seconds + 0.05)
  breath.start(at, Math.random() * 1.2)
  breath.stop(at + seconds + 0.05)
}

/**
 * Boots on boards, a lot of them, which is what a room does when it is pleased
 * and what nothing else in this mix does at all.
 *
 * The bottom of the room. Everything else here lives above 400Hz - throats,
 * glasses, cards, the band through its wall - so a jackpot had nothing under
 * it, and a crowd with no floor in it is a crowd on a recording. This is
 * deliberately not on the reverb send as heavily as the rest: low frequencies
 * in a wooden room arrive through the floor rather than through the air.
 */
function stomp(at: number, count: number, seconds: number, gain: number): void {
  const c = ac()
  for (let i = 0; i < count; i++) {
    const t = at + Math.random() * seconds
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const board = c.createBiquadFilter()
    board.type = 'lowpass'
    board.frequency.value = 180 + Math.random() * 120
    /* The board's own note. A plank over a joist rings, briefly and low. */
    const plank = c.createBiquadFilter()
    plank.type = 'peaking'
    plank.frequency.value = 74 + Math.random() * 40
    plank.Q.value = 3.5
    plank.gain.value = 11
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain * (0.6 + Math.random() * 0.7), t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    const room = c.createGain()
    room.gain.value = 0.25
    s.connect(board).connect(plank).connect(g).connect(sfxBus())
    g.connect(room).connect(reverbIn())
    s.start(t, Math.random() * 1.4)
    s.stop(t + 0.22)
  }
}

/**
 * What each reaction is, as numbers. Every row is the same instrument - the
 * differences between a groan and a cheer are the pitch, which way it slides,
 * how fast it arrives, how wide the mouth is and how hard the throat is
 * working.
 *
 * THE LEVELS IN THIS TABLE HAVE NOT MOVED, AND THAT IS DELIBERATE. The
 * material has been replaced wholesale - the source is a glottal pulse instead
 * of a sawtooth, the vowels and the pitch ranges are different, two of the six
 * have a tremor they did not have, the roar has a whistle and a floor full of
 * boots in it - but the dB ladder between the rows is the one thing here that
 * was arrived at by measurement, in answer to a specific complaint that the
 * building came apart on every pull. A player asking for different sounds is
 * not asking for that back. So the ladder is held and everything inside it is
 * new, which is also the only way the checks in verify-audio.mjs can tell the
 * difference between a rebuild and a regression.
 *
 * The ladder, for the record. A jackpot is allowed to be the loudest thing in
 * the building; the routine outcomes sit UNDER the machine's own bell and coin
 * fall, which is the honest ordering - most pulls are a thing the machine did
 * and the room barely looks up. Three dials, not one:
 *
 *   - gain, with everything except the roar 5 to 6dB down from the first pass;
 *   - seconds, because a long tail is most of what "over the top" is;
 *   - bed, the depth the room's own muttering ducks to. At 0.85 a routine loss
 *     stopped twenty conversations dead, and a room that holds its breath is
 *     how you say "something happened". It should not be saying that four
 *     times a minute. The gasp keeps its deep duck, because a near miss IS the
 *     room stopping.
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
  /** See VoiceOpts.press. How hard the throat is working, 0.4 to 0.7. */
  press: number
  /** See VoiceOpts.top. Chest against throat, and 1 is neutral. */
  top: number
  spread: number
  clap: [number, number]
  /** Two fingers in the mouth. Count, and how long they are spread over. */
  whistles: [number, number]
  /** Boots. Count, and how long they are spread over. */
  boots: [number, number]
  /** How far the band comes down under it, 0 to 1. */
  duck: number
  /** How far the room's own muttering comes down under it, 0 to 1. */
  bed: number
}> = {
  /* Everything at once, up, and held. The only row here allowed to be louder
   * than the bell - which is the point of it. It fires at twenty coins or
   * more; a player can go a long time without hearing it.
   *
   * The one row that got genuinely bigger rather than just different, and it
   * got bigger by getting WIDER rather than louder: the throats are pressed
   * (0.44, a shout rather than a call), there are two whistles over the top of
   * them and thirty boots under them. Twelve men on the same vowel is a wall
   * with no detail, and the fix for that is not gain. */
  roar: { voices: 12, f0: [200, 335], glide: 1.26, vowel: 'a', attack: 0.045, seconds: 2.2, gain: 0.065, breath: 0.18, tremor: 0, press: 0.44, top: 1.1, spread: 0.1, clap: [18, 1.9], whistles: [2, 0.5], boots: [30, 1.7], duck: 0.35, bed: 0.7 },
  /* A win, but not the one they came to see - so somebody slaps the bar and
   * that is the end of it. Now with a shallow tremor on it, because a cheer
   * from a handful of men is a ragged sound and a smooth one reads as a synth
   * pad with a vowel on it. */
  cheer: { voices: 8, f0: [180, 295], glide: 1.17, vowel: 'a', attack: 0.06, seconds: 1.1, gain: 0.0207, breath: 0.2, tremor: 3.4, press: 0.5, top: 1.15, spread: 0.14, clap: [6, 1.1], whistles: [0, 0], boots: [5, 0.9], duck: 0.16, bed: 0.45 },
  /* The sound of a room taking one breath in together, on the third reel.
   * Breath is nearly all of it, and noise through a formant is far louder than
   * a pulse train through the same one, so this gets the smallest gain and the
   * deepest bed duck: a gasp is not a loud sound, it is twenty conversations
   * stopping at once, and it only reads as one if they actually stop.
   *
   * Eighteen throats, and the reason is the murmur's reason two rows down.
   * This is the SHORTEST sound in the table - a sixth of it is the attack - so
   * it has the least time of anything here to average its own throats out, and
   * peak-hold reads whichever draw of them happened to align. It was the
   * widest row in the file at 4.3dB between firings on CI, against a 4dB
   * limit, while every local run was green. Eighteen of them put it at 1.4dB
   * and moved its median 0.2dB, which is what "more throats is a thicker
   * sound, not a louder one" means. */
  gasp: { voices: 18, f0: [205, 340], glide: 1.42, vowel: 'a', attack: 0.15, seconds: 0.58, gain: 0.0168, breath: 0.88, tremor: 0, press: 0.68, top: 3.6, spread: 0.05, clap: [0, 0], whistles: [0, 0], boots: [0, 0], duck: 0.32, bed: 0.85 },
  /* Down, slow, and it takes a while to stop. Sits in the same octaves as the
   * bed, so it needs the room out of the way more than it needs volume.
   *
   * The most-heard row on the table, because a flat loss is the commonest
   * thing that happens. It is on the new back vowel rather than sharing "aww"
   * with nothing else, its throats are slack (0.7, which is the most relaxed
   * voice in the file and the right one for a man emptying his chest), and it
   * has a slow tremor because a long collective groan wavers. */
  sigh: { voices: 9, f0: [115, 178], glide: 0.76, vowel: 'w', attack: 0.28, seconds: 1.3, gain: 0.025, breath: 0.42, tremor: 2.2, press: 0.7, top: 0.28, spread: 0.24, clap: [0, 0], whistles: [0, 0], boots: [0, 0], duck: 0.1, bed: 0.55 },
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
  murmur: { voices: 12, f0: [112, 175], glide: 0.95, vowel: 'u', attack: 0.24, seconds: 1.0, gain: 0.0115, breath: 0.48, tremor: 0, press: 0.66, top: 0.62, spread: 0.17, clap: [0, 0], whistles: [0, 0], boots: [0, 0], duck: 0.05, bed: 0.18 },
  /* Laughter is the cruellest one in here, so it gets the deepest tremor - and
   * being laughed at does not need to be loud to land, which is why this row
   * came down furthest. Four men at the next table, not the whole bar. The
   * tremor went from 7.2Hz to 5.6, which is the difference between a giggle
   * and a man laughing at you: a syllable rate that fast is a woman's or a
   * child's and there are neither in this picture. */
  jeer: { voices: 7, f0: [150, 240], glide: 0.85, vowel: 'a', attack: 0.045, seconds: 1.15, gain: 0.0176, breath: 0.28, tremor: 5.6, press: 0.52, top: 1, spread: 0.18, clap: [3, 1.0], whistles: [0, 0], boots: [0, 0], duck: 0.2, bed: 0.5 },
}

/**
 * What a row of the table above is worth as an amplitude.
 *
 * It is a big number and it has to be. A voice here is a pulse train through
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
      /*
       * Throats are not equally loud, and this is how unequal they are. It
       * was 0.6 to 1.5 - two and a half to one, 8dB - which is a plausible
       * room and an implausible measurement: the loudest voice in the draw
       * sets the peak, so the peak of the sum is a lottery over a handful of
       * tickets, and verify-audio.mjs reads a reaction by peak-hold. Turning
       * the table down made that visible rather than worse, because every
       * ordering it holds now has a few dB to spare instead of a dozen.
       *
       * 0.8 to 1.25 is still a room where nobody matches anybody, and it cuts
       * the spread between firings roughly in half. It keeps the same MEAN of
       * 1.05 that the gain column was tuned against, which is not a detail:
       * the first cut at this was centred on 1.0 and every reaction came out
       * half a decibel quieter, so a fix to a measurement would have turned
       * the whole room down as a side effect. The other half of the repair is
       * the gasp's throat count, above - unequal voices only average out if
       * there are enough of them, and the gasp is the shortest sound here.
       */
      gain: (s.gain / Math.sqrt(n)) * (0.8 + Math.random() * 0.5) * THROAT,
      breath: s.breath,
      tremor: s.tremor ? s.tremor * (0.9 + Math.random() * 0.25) : 0,
      /* Not everybody in a room is pushing equally hard either, and the open
       * quotient is what that is. */
      press: Math.max(0.35, Math.min(0.75, s.press * (0.92 + Math.random() * 0.16))),
      top: s.top,
      send: 0.45,
    })
  }
  if (s.clap[0]) claps(c.currentTime + 0.12, Math.round(s.clap[0] * (0.5 + density)), s.clap[1], 0.05)
  if (s.boots[0]) stomp(c.currentTime + 0.1, Math.round(s.boots[0] * (0.5 + density)), s.boots[1], 0.055)
  for (let i = 0; i < s.whistles[0]; i++) {
    whistle(c.currentTime + 0.18 + Math.random() * s.whistles[1], 0.03)
  }
  duck(s.duck, kind === 'roar' ? 0.5 : 0.2, 0.9)
  /* And the muttering stops, which is most of how a groan gets heard at all -
   * see bedDuck(). The hold is the useful part of the sound; the rest of it is
   * the tail, and the room can start talking again over that. */
  bedDuck(s.bed, s.seconds * 0.55, 0.9)
}

/* ------------------------------------------------------------------- the bed */

let bed: { talk: GainNode; duck: GainNode[]; stop: () => void } | null = null

/* ------------------------------------------------------- the conversations */

/*
 * Six conversations at the other end of the room, and this layer has now been
 * wrong in three different ways. All three are worth keeping written down,
 * because each one measured better than the last and the third still sounded
 * wrong to the only instrument that matters.
 *
 * ONE was a bandpass on a noise buffer: a 520Hz hum with the odd syllable
 * dropped on top. That measured fine on every check in the file and it was a
 * hiss, because a noise bed and a crowd have roughly the same long-term
 * spectrum and nothing that averages over a few seconds can tell them apart.
 *
 * TWO therefore made each talker a mouth - a glottal source through two
 * formants that swept between six vowels, gated into syllables, with a hiss
 * spat on the front of half of them for the consonant. That fixed the
 * measurement and broke the sound: it was unmistakably somebody ENUNCIATING,
 * and since there is no language in here what it enunciated was gibberish. A
 * player's word for it was aliens, which is exactly right:
 *
 *   A crowd two tables away is not a voice you cannot understand. It is a
 *   voice you cannot FOLLOW. The moment one throat is trackable, the ear
 *   starts listening for words, and then their absence is the loudest thing
 *   in the mix.
 *
 * THREE removed everything that made a throat trackable - the consonants, the
 * formant sweeps, and the intelligibility band above 1.5kHz - and put the
 * count up to ten so that five or six were always going at once. That is where
 * the acoustics of this layer are still right, and all of it survives below.
 *
 * FOUR, here, fixes what was left, which is not acoustics at all. Ten throats
 * each running their own independent clock is a crowd in the statistical sense
 * and not in any other: nobody in it was talking TO anybody. The room had the
 * texture of conversation and none of its structure, and structure at the
 * one-second scale is what the ear uses to decide whether a noise is people.
 *
 * So the unit is now a GROUP, not a talker. Two or three men stand together
 * and exactly one of them holds the floor: he says a phrase, and about a
 * quarter of a second later somebody else in his group answers it. Every few
 * turns they run out of subject and there is a real pause before anybody
 * starts again. Two things fall out of that for free and both are audible:
 *
 *   INTERRUPTIONS. About one handover in six is negative - the next man starts
 *     before the last one has finished, which is what actually happens in a
 *     bar and which no arrangement of independent talkers can produce, because
 *     for them every overlap is a coincidence rather than an act.
 *
 *   BACKCHANNELS. While one man is talking, a listener in the same group drops
 *     a single short syllable on top of him - the "mm" that means go on. One
 *     syllable in isolation is the most recognisable thing overheard speech
 *     does, and it only means anything if it lands inside somebody else's
 *     phrase, which requires knowing whose phrase it is.
 *
 * Cheap on purpose, as before. The nodes are built once per throat and live
 * for the session; a syllable is three scheduled automation events on
 * parameters that already exist, not three new nodes.
 */

/**
 * A throat's own vowel colour, [F1, F2] in Hz. One row per man rather than
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

interface Throat {
  /** Says one phrase starting at `at`, and returns when it finished. */
  phrase: (at: number) => number
  /** One syllable of agreement, dropped into somebody else's phrase. */
  agree: (at: number) => void
  stop: () => void
}

/**
 * One man in a group.
 *
 * @param f0   where this throat sits. A bar in 1899 is mostly men, so mostly
 *             low, but a room of one pitch is a chord and not a crowd.
 * @param far  0 near, 1 at the other end of the room: duller and wetter.
 * @param pan  where they are standing.
 */
function throat(into: AudioNode, wetTo: AudioNode, f0: number, far: number, pan: number): Throat {
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
  /* A relaxed voice, and a slightly different one per man. Conversation is the
   * one place in this file where nobody is pushing: the open quotients here
   * are all up at the loose end of the range, where a reaction's are down at
   * the pressed end. That difference is most of why a reaction now reads as
   * somebody raising their voice rather than as the same voice turned up. */
  src.setPeriodicWave(glottis(c, 0.6 + Math.round(Math.random() * 4) * 0.02))
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

  /** One gated syllable at `t`, held for `held`, at `loud`. */
  const syllable = (t: number, held: number, loud: number) => {
    /*
     * Soft edges. The old gate opened in 11ms and shut in 18ms, which is a
     * consonant boundary; 35ms either way is a mouth already open changing
     * what it is doing, and it is the difference between syllables you can
     * count and a burble you cannot.
     */
    env.gain.setTargetAtTime(loud, t, 0.035)
    env.gain.setTargetAtTime(0.0001, t + held, 0.035)
  }

  return {
    stop: () => src.stop(),
    agree: (at: number) => {
      /* One syllable, low, short and quiet: it is not a turn, it is a noise
       * that means carry on. Down a little from his own pitch, because that
       * is what a listener's "mm" does. */
      src.frequency.setTargetAtTime(f0 * 0.88, at, 0.04)
      syllable(at, 0.1 + Math.random() * 0.1, level * 0.45)
    },
    phrase: (at: number) => {
      const count = 2 + Math.floor(Math.random() * 6)
      const rate = 0.16 + Math.random() * 0.11
      const base = f0 * (0.93 + Math.random() * 0.14)
      /* A question now and then, which rises instead of falling. */
      const rising = Math.random() < 0.18
      /*
       * And about one phrase in four trails off into creak instead of
       * finishing. A man running out of breath at the end of a sentence drops
       * below the pitch his folds can hold steadily and they start slapping
       * irregularly instead of vibrating - which is a completely
       * characteristic sound, it is most of what a tired man in a bar sounds
       * like, and it is free here: it is the pitch curve, not a new node.
       */
      const creak = !rising && Math.random() < 0.26
      for (let i = 0; i < count; i++) {
        const t = at + i * rate
        const held = rate * (0.55 + Math.random() * 0.3)
        const last = i === count - 1
        /* Declination: a spoken sentence drifts down about a fifth from
         * start to finish, and putting that in is most of the difference
         * between talking and chanting. */
        const arc = rising ? 1 + 0.18 * (i / Math.max(1, count - 1)) : 1 - 0.24 * (i / Math.max(1, count - 1))
        if (creak && last) {
          src.frequency.setTargetAtTime(base * 0.55, t, 0.03)
          /* Irregular, which is the whole point of it. */
          for (let k = 1; k < 4; k++) {
            src.frequency.setTargetAtTime(base * (0.44 + Math.random() * 0.2), t + k * 0.045, 0.012)
          }
        } else {
          src.frequency.setTargetAtTime(base * arc * (0.96 + Math.random() * 0.08), t, 0.05)
        }
        /* A few percent of wobble on his own vowel, which is a jaw moving,
         * not a different vowel. */
        mouth[0].frequency.setTargetAtTime(F1 * (0.96 + Math.random() * 0.08), t, 0.05)
        mouth[1].frequency.setTargetAtTime(F2 * (0.96 + Math.random() * 0.08), t, 0.05)
        syllable(t, held, level * (0.6 + Math.random() * 0.6) * (i === 0 ? 1.15 : 1))
      }
      return at + count * rate
    },
  }
}

interface Group {
  /** Fills the schedule with turns up to `until` on the audio clock. */
  say: (until: number) => void
  stop: () => void
}

/**
 * Two or three men standing together, one of whom is talking.
 *
 * The floor is a single variable and that is the entire idea: at any instant
 * this group emits one phrase, not two or three, so what a listener hears is
 * an exchange rather than a pile. Everything that makes it sound like an
 * exchange - the length of the gap between turns, the fact that the gap is
 * sometimes negative, the pause when the subject runs out - is a property of
 * the group and cannot be written down inside a talker.
 *
 * @param pitches one entry per man, in Hz. Spread, because two men at the
 *        same pitch standing in the same place is one man.
 */
function group(into: AudioNode, wetTo: AudioNode, pitches: number[], far: number, pan: number): Group {
  const men = pitches.map((f0, i) =>
    /* Fanned out slightly around where the group is standing: three men in a
     * huddle are not at one point, and the small spread is what makes the
     * group read as a huddle rather than as a mono source. */
    throat(into, wetTo, f0, far, Math.max(-1, Math.min(1, pan + (i - (pitches.length - 1) / 2) * 0.12))),
  )
  let who = Math.floor(Math.random() * men.length)
  let turns = 0
  /* Staggered, so the six groups are not all pausing together. */
  let at = ac().currentTime + Math.random() * 2.5

  return {
    stop: () => men.forEach((m) => m.stop()),
    say: (until: number) => {
      while (at < until) {
        const end = men[who].phrase(at)
        /* Somebody else in the group agrees, over the top of him. */
        if (men.length > 1 && Math.random() < 0.34) {
          const other = (who + 1 + Math.floor(Math.random() * (men.length - 1))) % men.length
          men[other].agree(at + (end - at) * (0.35 + Math.random() * 0.4))
        }
        /* The handover. Negative about one time in six, which is an
         * interruption, and the thing a room full of independent talkers can
         * never produce on purpose. */
        const over = Math.random() < 0.17
          ? -(0.06 + Math.random() * 0.14)
          : 0.1 + Math.random() * 0.34
        at = end + over
        if (++turns >= 3 + Math.floor(Math.random() * 4)) {
          /* The subject runs out. This is the only real silence the group has
           * and it is what stops the layer being a continuous wash - but it
           * is also why there are six groups rather than three, because the
           * composite must not thin out when one of them stops. */
          at += pause()
          turns = 0
        }
        if (men.length > 1) who = (who + 1 + Math.floor(Math.random() * (men.length - 1))) % men.length
      }
    },
  }
}

/**
 * How long a group is quiet between subjects, which is the only thing density
 * changes.
 *
 * Deliberately not a level. The lesson from two passes ago was that you make a
 * background come forward by giving it events rather than gain, and the same
 * thing applies to making it come forward MORE: a room fills up by there being
 * less silence in it, not by everyone shouting.
 */
let density = 0.35
const pause = () => 0.5 + (1.5 - density * 1.1) * Math.random()

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
      f0: 140 + Math.random() * 110,
      glide: 0.84 + Math.random() * 0.2,
      vowel: i % 2 ? 'a' : 'o',
      attack: 0.04,
      seconds: 0.6 + Math.random() * 0.7,
      gain: 0.055,
      breath: 0.32,
      /* Slower than it was, for the same reason as the jeer: above about 6Hz
       * a laugh stops being a man's. */
      tremor: 5 + Math.random() * 2.4,
      press: 0.54,
      send: 0.9,
    }, into, wetTo)
  }
}

/**
 * One piece of saloon furniture making a noise: a mug set down, a match
 * struck, beer drawn, small change on the wood, a chair going back, boots,
 * the street door.
 *
 * These are what the difference between "a room" and "filtered noise" is made
 * of. The bed on its own is a dozen conversations under 1.5kHz, which reads as
 * a hum; it has no EVENTS in it, and a busy room is mostly events. They are
 * also what keeps the ambience in front of the band without simply turning the
 * conversation up - a hum loud enough to lead the mix is just hiss, while a
 * room with glassware in it reads as busy at a much lower level.
 *
 * THE PALETTE IS NEW. It was a shot glass, a bottle against a glass, boots, a
 * chair, a pour, a throat being cleared and the door. The shot glass and the
 * bottle-clink were the two most-heard events in the mix and they were both
 * short bright clicks with a sine ringing after them, which is to say they
 * were the same sound twice; a bar heard for twenty minutes needs its common
 * events to be the ones with the most character, not the fewest. So the
 * common cases are now a heavy beer mug on wood, a match struck, and beer
 * being drawn from a tap - all three of which have an envelope rather than
 * just a decay - and there is a coin on the bar as well, which is the one
 * sound in a gambling house that means something.
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

  /** A struck body's note, with a decay. */
  const ring = (freq: number, gain: number, decay: number, delay = 0) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at + delay)
    g.gain.linearRampToValueAtTime(gain, at + delay + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, at + delay + decay)
    o.connect(g).connect(out)
    o.start(at + delay)
    o.stop(at + delay + decay + 0.05)
  }
  /** The impact itself: filtered noise with no pitch to it. */
  const knock = (freq: number, q: number, gain: number, decay: number, delay = 0) => {
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at + delay)
    g.gain.linearRampToValueAtTime(gain, at + delay + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + delay + decay)
    s.connect(f).connect(g).connect(out)
    s.start(at + delay, Math.random() * 1.4)
    s.stop(at + delay + decay + 0.05)
  }

  if (pick < 0.2) {
    /*
     * A beer mug down on the mahogany, which is the commonest sound in a bar
     * and was the one most in need of replacing.
     *
     * A thick glass mug with an inch of beer left in it is a very different
     * object from the shot glass this used to be: it is heavy, so the wood
     * takes most of the energy and there is a real thud; it is thick, so its
     * note is low and does not ring for long; and the liquid in it damps the
     * note further and slops afterwards. All four of those are here, and the
     * slop is what makes it a mug of something rather than an empty one.
     */
    knock(230, 1.1, 0.075, 0.07)
    ring(520 + Math.random() * 140, 0.02, 0.1)
    ring(1180 + Math.random() * 220, 0.008, 0.06)
    const slop = c.createBufferSource()
    slop.buffer = noiseBuffer(c)
    const wet = c.createBiquadFilter()
    wet.type = 'bandpass'
    wet.frequency.value = 340
    wet.Q.value = 1.2
    const sg = c.createGain()
    sg.gain.setValueAtTime(0.0001, at + 0.02)
    sg.gain.linearRampToValueAtTime(0.012, at + 0.05)
    sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    slop.connect(wet).connect(sg).connect(out)
    slop.start(at + 0.02, Math.random() * 1.4)
    slop.stop(at + 0.3)
  } else if (pick < 0.34) {
    /*
     * A match struck, and it is in the common cases because it is the most
     * recognisable two-part sound in a nineteenth-century room: a hard fast
     * scrape, then a soft flare that arrives AFTER it and lasts ten times as
     * long. The delay between the two is the whole recognition - a scrape and
     * a flare at the same instant is a firework.
     */
    const scrape = c.createBufferSource()
    scrape.buffer = noiseBuffer(c)
    const grit = c.createBiquadFilter()
    grit.type = 'bandpass'
    grit.frequency.setValueAtTime(2600, at)
    grit.frequency.exponentialRampToValueAtTime(1500, at + 0.05)
    grit.Q.value = 0.8
    const sg = c.createGain()
    sg.gain.setValueAtTime(0.0001, at)
    sg.gain.linearRampToValueAtTime(0.03, at + 0.006)
    sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
    scrape.connect(grit).connect(sg).connect(out)
    scrape.start(at, Math.random() * 1.4)
    scrape.stop(at + 0.08)
    /* The flame catching: broadband, rising, then settling into a quiet
     * flutter as it burns. */
    const flare = c.createBufferSource()
    flare.buffer = noiseBuffer(c)
    flare.loop = true
    const soft = c.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.setValueAtTime(3000, at + 0.05)
    soft.frequency.exponentialRampToValueAtTime(900, at + 0.5)
    const fg = c.createGain()
    fg.gain.setValueAtTime(0.0001, at + 0.05)
    fg.gain.linearRampToValueAtTime(0.024, at + 0.09)
    fg.gain.exponentialRampToValueAtTime(0.0001, at + 0.55)
    flare.connect(soft).connect(fg).connect(out)
    flare.start(at + 0.05, Math.random() * 1.2)
    flare.stop(at + 0.62)
  } else if (pick < 0.46) {
    /*
     * Beer drawn from a tap into a mug, which is a pitch that FALLS - the
     * column of air above the beer gets shorter as the mug fills, so the
     * resonance climbs while the splash noise it is filtering drops away.
     * This replaced a bottle emptying, whose glugs climbed. Two sounds that
     * are each other backwards is about as far apart as two sounds can be
     * while remaining the same event.
     */
    const flow = c.createBufferSource()
    flow.buffer = noiseBuffer(c)
    flow.loop = true
    const column = c.createBiquadFilter()
    column.type = 'bandpass'
    column.frequency.setValueAtTime(420, at)
    column.frequency.exponentialRampToValueAtTime(1150, at + 1.1)
    column.Q.value = 2.4
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.028, at + 0.12)
    g.gain.setValueAtTime(0.028, at + 0.8)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.15)
    flow.connect(column).connect(g).connect(out)
    flow.start(at, Math.random() * 1.2)
    flow.stop(at + 1.2)
    /* And the head, which is thousands of bubbles and therefore a quiet hiss
     * that outlives the pour. */
    const foam = c.createBufferSource()
    foam.buffer = noiseBuffer(c)
    foam.loop = true
    const fizz = c.createBiquadFilter()
    fizz.type = 'highpass'
    fizz.frequency.value = 3200
    const fg = c.createGain()
    fg.gain.setValueAtTime(0.0001, at + 0.3)
    fg.gain.linearRampToValueAtTime(0.006, at + 0.7)
    fg.gain.exponentialRampToValueAtTime(0.0001, at + 1.8)
    foam.connect(fizz).connect(fg).connect(out)
    foam.start(at + 0.3, Math.random() * 1.2)
    foam.stop(at + 1.9)
  } else if (pick < 0.62) {
    /*
     * Boots on boards. Two or three steps, never evenly spaced, and with the
     * plank's own low note in them now rather than just a lowpassed thump -
     * a board over a joist rings around 80Hz and that is the difference
     * between a floor and a cushion.
     */
    const steps = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < steps; i++) {
      const t = i * (0.3 + Math.random() * 0.11)
      const s = c.createBufferSource()
      s.buffer = noiseBuffer(c)
      const board = c.createBiquadFilter()
      board.type = 'lowpass'
      board.frequency.value = 300
      const plank = c.createBiquadFilter()
      plank.type = 'peaking'
      plank.frequency.value = 78 + Math.random() * 34
      plank.Q.value = 3
      plank.gain.value = 10
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, at + t)
      g.gain.linearRampToValueAtTime(0.05, at + t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, at + t + 0.15)
      s.connect(board).connect(plank).connect(g).connect(out)
      s.start(at + t, Math.random() * 1.4)
      s.stop(at + t + 0.22)
      /* The heel and the sole are two impacts, about 30ms apart. One of them
       * is a stick. */
      if (Math.random() < 0.6) knock(1400, 1.2, 0.01, 0.02, t + 0.03)
    }
  } else if (pick < 0.73) {
    /* Small change on the bar: two or three coins dropped, and one of them
     * spins. The spin-down is the recognition and it is the only accelerating
     * sound in the room. */
    const coins = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < coins; i++) {
      const t = i * (0.05 + Math.random() * 0.07)
      ring(2600 + Math.random() * 1200, 0.014, 0.12, t)
      knock(3600, 1.6, 0.012, 0.01, t)
    }
    if (Math.random() < 0.5) {
      /* A coin settling: the contact rate climbs as the angle drops, which is
       * a rattle that speeds up and then stops dead. */
      let t = 0.25
      let step = 0.07
      while (step > 0.008) {
        knock(3000 + Math.random() * 1500, 2.2, 0.006, 0.008, t)
        t += step
        step *= 0.86
      }
    }
  } else if (pick < 0.83) {
    /* A chair going back: wood dragging over wood, which is a rising scrape
     * with stick-slip chatter in it. The chatter is new and is most of what
     * makes it wood rather than wind. */
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(380, at)
    f.frequency.exponentialRampToValueAtTime(820, at + 0.34)
    f.Q.value = 3.6
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.032, at + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.36)
    s.connect(f).connect(g).connect(out)
    s.start(at, Math.random() * 1.4)
    s.stop(at + 0.42)
    for (let i = 0; i < 7; i++) knock(700 + Math.random() * 900, 4, 0.007, 0.012, 0.03 + Math.random() * 0.3)
    /* And it ends by being put down. */
    knock(210, 1.2, 0.03, 0.06, 0.38)
  } else if (pick < 0.93) {
    /* A cork out of a bottle: the squeak of it turning, then the pop, then the
     * bottle's own note as the air goes in. Three events in 300ms, and the
     * order of them is the whole sound. */
    const squeak = c.createOscillator()
    squeak.type = 'sawtooth'
    squeak.frequency.setValueAtTime(310, at)
    squeak.frequency.linearRampToValueAtTime(430, at + 0.18)
    const thin = c.createBiquadFilter()
    thin.type = 'bandpass'
    thin.frequency.value = 900
    thin.Q.value = 6
    const sg = c.createGain()
    sg.gain.setValueAtTime(0.0001, at)
    sg.gain.linearRampToValueAtTime(0.01, at + 0.05)
    sg.gain.setValueAtTime(0.01, at + 0.15)
    sg.gain.linearRampToValueAtTime(0.0001, at + 0.19)
    squeak.connect(thin).connect(sg).connect(out)
    squeak.start(at)
    squeak.stop(at + 0.22)
    knock(900, 0.7, 0.055, 0.02, 0.2)
    ring(180 + Math.random() * 60, 0.022, 0.2, 0.2)
  } else {
    /* The street door, and the town for a second, then it shuts. The gap
     * between the hinge and the latch is what makes it a door. */
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    s.loop = true
    const outside = c.createBiquadFilter()
    outside.type = 'bandpass'
    outside.frequency.value = 700
    outside.Q.value = 0.6
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.016, at + 0.1)
    g.gain.setValueAtTime(0.016, at + 0.5)
    g.gain.linearRampToValueAtTime(0.0001, at + 0.62)
    s.connect(outside).connect(g).connect(out)
    s.start(at, Math.random() * 1.2)
    s.stop(at + 0.7)
    knock(150, 0.9, 0.06, 0.2, 0.6)
    knock(2200, 2.4, 0.018, 0.03, 0.64)
    ring(92, 0.018, 0.4, 0.6)
  }
}

/**
 * The room when nothing is happening: half a dozen conversations two tables
 * away, a card game behind you, the bar going about its business, and somebody
 * laughing at the far end now and then. Without this the saloon is an empty
 * room with a machine in it, and every reaction arrives out of silence.
 *
 * Four things hang off one duck:
 *
 *     six groups of men talking to each other -.
 *     the card game: shuffles, deals, chips ---+
 *     mugs, matches, beer, coins, the door ----+-> duck -> sfx bus
 *     laughter from the far end ---------------'        \-> reverb
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

  /*
   * The card game, and it is on its own gain and behind its own filter rather
   * than sharing the bar's.
   *
   * Two reasons, and neither is taste. It is across the room from the machine
   * where the bar is under the player's elbow, so it has to be duller and
   * wetter than the glassware. And it is by far the brightest layer in the
   * building - a riffle is a train of clicks with most of its energy between
   * 1 and 4kHz - which matters to the measurements as well as to the ear: a
   * reaction is read as the colour it ADDS over the room, so an unfiltered
   * card table would lend its brightness to every reaction measured on top of
   * it and a groan would come out reading like a gasp.
   */
  const felt = c.createGain()
  felt.gain.value = 1.1
  const across = c.createBiquadFilter()
  across.type = 'lowpass'
  across.frequency.value = 3400
  felt.connect(across).connect(ducked)

  /* And the other end of the room, which only laughter comes from. Dull and
   * far enough back that it never sounds like it is about you. */
  const away = c.createGain()
  away.gain.value = 0.5
  const wall = c.createBiquadFilter()
  wall.type = 'lowpass'
  wall.frequency.value = 1150
  away.connect(wall).connect(ducked)

  /*
   * Six groups, fifteen men, and both counts are load-bearing.
   *
   * SIX GROUPS because only one man in a group talks at a time. Ten
   * independent talkers had five or six going at once by accident; six groups
   * have three or four going at once by construction, which is thinner, so
   * the count went up to keep the composite from ever dropping into the clear.
   * One voice in the clear is a voice the ear tries to get words out of, and
   * that is the failure this layer spent two rewrites escaping.
   *
   * TWO OR THREE MEN because that is the size a standing conversation is, and
   * because a group of one cannot take a turn, interrupt anybody or agree
   * with them - it is just a talker again. There is one pair of two at the
   * front of the room and the rest are threes.
   *
   * Pitches, distances and places in the stereo field are all spread, because
   * a room of one voice repeated is a chorus. Nobody is at far = 0: there is
   * nobody standing next to you in any of these shots, and a near-field
   * talker is the one voice that would be trackable again.
   */
  const groups = [
    group(talk, wet, [118, 171], 0.3, -0.55),
    group(talk, wet, [142, 99, 188], 0.45, 0.4),
    group(talk, wet, [106, 160, 127], 0.7, -0.2),
    group(talk, wet, [176, 133, 92], 0.55, 0.7),
    group(talk, wet, [124, 205], 0.9, 0.05),
    group(talk, wet, [151, 113, 196], 0.8, -0.8),
  ]

  let alive = true
  /* Two seconds of turns, topped up four times a second. Scheduling further
   * ahead would be cheaper and would also mean the room carries on talking
   * for two seconds after somebody calls the house. */
  const keepTalking = window.setInterval(() => {
    if (!alive) return
    const until = ac().currentTime + 2
    for (const g of groups) g.say(until)
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

  /*
   * And the game, faster than the bar, because a hand of cards is a
   * continuous stream of small events where a bar is an occasional one. This
   * is the layer that makes the room sound like somewhere people are DOING
   * something rather than somewhere they are standing about.
   */
  const playing = () => {
    if (!alive) return
    if (ac().currentTime >= quietUntil) cardTable(felt, wet)
    window.setTimeout(playing, 480 + Math.random() * 1100)
  }
  window.setTimeout(playing, 1400)

  const laughing = () => {
    if (!alive) return
    if (ac().currentTime >= quietUntil) laughOver(away, wet)
    window.setTimeout(laughing, 9000 + Math.random() * 16000)
  }
  window.setTimeout(laughing, 6000 + Math.random() * 8000)

  bed = {
    talk,
    duck: [ducked, wet],
    stop: () => {
      alive = false
      window.clearInterval(keepTalking)
      for (const g of groups) g.stop()
    },
  }
}

/**
 * The room pressing in. Driven by heat and by the last reaction.
 *
 * It buys less silence rather than more volume - see pause(). The level moves a
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
 * not. The bed is a dozen men talking and a groan is an "ohh" gliding down
 * through 130Hz with its formants at 400 and 750 - literally the same
 * instrument in the same octaves, so the bed masks it almost exactly.
 * Measured at the destination before this existed, a win added 2.4x as much
 * energy above 1.2kHz as below it and was 8dB clear of the room, while a
 * groan added 0.001 in three bands and a gasp was not distinguishable from
 * the room at all. The table cheered a win and said nothing you could hear
 * about a loss, which is half the brief missing and none of it visible in the
 * source.
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
 * the cards, the glasses, the boots and the machine on it too. Measuring the
 * mixture would leave the interesting part provable only by elimination.
 */
export const talkBus = () => bed?.talk ?? null

/**
 * Everything stops. Used when the count is called - the oldest gesture in the
 * genre and the only moment on this table where the room is silent.
 *
 * On the ducks rather than on the conversation, because EVERYTHING means the
 * barman and the card players too, and the reflections as well as the sound
 * that caused them. Hushing one layer at a time has failed this check twice
 * now, 8dB short when the glasses were outside the duck and 12dB short when
 * the talkers' reverb sends were. quietUntil then stops anything new from
 * starting during it.
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
  /* The pressed end of the range: this is a man shouting across a room, which
   * is the hardest his larynx works anywhere in this project. */
  o.setPeriodicWave(glottis(c, 0.4))
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
