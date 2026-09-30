import { ac, noiseBuffer } from './engine'

/*
 * The card game at the table behind you.
 *
 * This layer did not exist, and its absence was a specific hole rather than a
 * missing nicety. The room in this saloon is the opponent - it is the odds
 * readout, the pressure and the jury - so it has to sound like somewhere that
 * would still be busy if the machine were unplugged. What it had was talking,
 * glasses and boots, which is a bar. A frontier saloon is a bar with a game
 * going in it, and a game is the one thing in a room that makes a sound on a
 * rhythm of its own: shuffle, deal, a pause while everybody looks, then chips.
 *
 * It is also the layer with the most recognisable sounds in the building. A
 * riffle shuffle and a stack of clay chips being riffled in one hand are both
 * instantly identifiable at any level, and neither of them is confusable with
 * anything else here - which is what an ambience needs, because a bed made of
 * unidentifiable noises is heard as noise however carefully it is built.
 *
 * WHY IT IS DARKER THAN THE REAL THING. Cards and chips are bright: the useful
 * part of a riffle is a train of clicks with most of their energy between 1 and
 * 4kHz. Everything here is rolled off above about 3.4kHz and sent heavily to
 * the convolver, and that is the acoustics rather than the mix being timid -
 * the player is at the bar with his hand on a lever and the game is behind him
 * across a room full of people. It also matters to the measurements: a reaction
 * is read as the colour it ADDS over the room, and a bar with a bright layer in
 * it lends its brightness to everything measured on top of it, which is how a
 * groan ends up reading like a gasp. See VoiceOpts.top in crowd.ts.
 *
 * Every sound in here is built from the same two primitives, because they are
 * the same two physical events. A card is paper under tension: a short slip of
 * broadband noise, no ring. A chip is a small stiff clay disc: a click with a
 * genuine pitch to it, and an inharmonic one, because a disc's modes are not a
 * harmonic series. Getting that distinction right is most of what makes a
 * table read as cards AND money rather than as a generic rattle.
 */

/** Where the game sits and where its reflections go. Set up by table(). */
interface Table {
  dry: AudioNode
  wet: AudioNode
}

/**
 * A card's click: paper slipping off paper, which is noise and nothing else.
 *
 * No resonance at all, and that is the whole character. A playing card is far
 * too small and too damped to ring - anything ringing in a shuffle is the table
 * it is landing on - so the only things that vary between one of these and the
 * next are how bright it is and how fast it dies.
 */
function slip(t: Table, at: number, hz: number, gain: number, decay: number): void {
  const c = ac()
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const edge = c.createBiquadFilter()
  edge.type = 'bandpass'
  edge.frequency.value = hz
  edge.Q.value = 1.1
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.0015)
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  s.connect(edge).connect(g).connect(t.dry)
  g.connect(t.wet)
  s.start(at, Math.random() * 1.4)
  s.stop(at + decay + 0.02)
}

/**
 * A clay chip: a click with a note in it, and the note is not a harmonic one.
 *
 * A thin disc's bending modes go roughly as 1 : 2.08 : 3.41 rather than
 * 1 : 2 : 3, and that inharmonicity is audible even at a 60ms decay - it is the
 * difference between a chip and a woodblock. Three modes is enough; anything
 * higher up is gone before the ear has it.
 */
function chip(t: Table, at: number, hz: number, gain: number): void {
  const c = ac()
  const decay = 0.045 + Math.random() * 0.03
  ;[1, 2.08, 3.41].forEach((mult, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz * mult * (0.99 + Math.random() * 0.02)
    const g = c.createGain()
    const level = gain * [1, 0.42, 0.18][i]
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(level, at + 0.001)
    /* Higher modes are more heavily damped, which is why a chip is a click
     * that becomes a tone rather than a tone with a click on it. */
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay / (1 + i * 0.7))
    o.connect(g).connect(t.dry)
    g.connect(t.wet)
    o.start(at)
    o.stop(at + decay + 0.02)
  })
  /* And the clack of the collision itself, which is what makes it a hard
   * object rather than a bell. */
  slip(t, at, 2400 + Math.random() * 900, gain * 0.5, 0.008)
}

/**
 * A riffle shuffle, and the reason this file exists.
 *
 * The recognition is entirely in the TIMING and not in the sound of any one
 * click. A riffle is two thumbs releasing packets of cards against each other,
 * and the release accelerates: it starts as distinguishable ticks, runs into a
 * blur in the middle, and thins out again as the packets run out. A train of
 * evenly spaced clicks at the same average rate is heard as a ratchet or a
 * zipper - it is the acceleration that says cards.
 *
 * Then the bridge: the two halves are pushed together and spring down into one
 * deck, which is a much denser and much shorter burst, and a shuffle without it
 * sounds like it was cut off.
 */
function riffle(t: Table, at: number): void {
  const n = 26 + Math.floor(Math.random() * 10)
  const span = 0.3 + Math.random() * 0.12
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    /* Fast in the middle, slower at both ends: the integral of a rate that
     * peaks at the centre, which is what a thumb release does. */
    const when = at + span * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI))
    slip(
      t,
      when + (Math.random() - 0.5) * 0.004,
      1500 + Math.random() * 1500,
      0.016 * (0.6 + Math.random() * 0.8),
      0.01 + Math.random() * 0.012,
    )
  }
  /* The bridge. Fifteen cards inside 70ms, which is a rustle rather than a
   * sequence of events. */
  const bridge = at + span + 0.05
  for (let i = 0; i < 15; i++) {
    slip(t, bridge + Math.random() * 0.07, 1100 + Math.random() * 1400, 0.012, 0.014)
  }
  /* And squaring the deck up against the baize. */
  slip(t, bridge + 0.13, 600, 0.03, 0.05)
}

/**
 * Cards going out: n of them sliding off the deck and landing on the cloth.
 *
 * Two events per card, and both are needed. The slide is a rising hiss as the
 * card leaves the deck; the landing is a dull slap with no top on it, because
 * baize is about the most absorbent surface in the building. A deal with only
 * the slap is somebody tapping a table, and with only the slide it is a snake.
 */
function deal(t: Table, at: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const when = at + i * (0.15 + Math.random() * 0.08)
    const c = ac()
    const s = c.createBufferSource()
    s.buffer = noiseBuffer(c)
    const sweep = c.createBiquadFilter()
    sweep.type = 'bandpass'
    sweep.frequency.setValueAtTime(1300, when)
    sweep.frequency.exponentialRampToValueAtTime(3000, when + 0.05)
    sweep.Q.value = 0.8
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.linearRampToValueAtTime(0.012, when + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
    s.connect(sweep).connect(g).connect(t.dry)
    g.connect(t.wet)
    s.start(when, Math.random() * 1.4)
    s.stop(when + 0.08)
    /* The cloth. Nothing above 900Hz survives it. */
    const land = c.createBufferSource()
    land.buffer = noiseBuffer(c)
    const soft = c.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 900
    const lg = c.createGain()
    lg.gain.setValueAtTime(0.0001, when + 0.055)
    lg.gain.linearRampToValueAtTime(0.02, when + 0.06)
    lg.gain.exponentialRampToValueAtTime(0.0001, when + 0.1)
    land.connect(soft).connect(lg).connect(t.dry)
    lg.connect(t.wet)
    land.start(when + 0.055, Math.random() * 1.4)
    land.stop(when + 0.12)
  }
}

/**
 * A stack of chips riffled in one hand - the thing a bored gambler does with
 * his money while he waits for somebody else to decide.
 *
 * Distinguishable from a card riffle by having a pitch: eight or ten small
 * clay discs falling against each other in 200ms, all around the same note,
 * which reads as a stutter on one tone rather than as a hiss.
 */
function chipRiffle(t: Table, at: number): void {
  const n = 7 + Math.floor(Math.random() * 6)
  const hz = 1250 + Math.random() * 400
  for (let i = 0; i < n; i++) {
    chip(t, at + (i / n) * (0.17 + Math.random() * 0.09) + Math.random() * 0.008, hz * (0.97 + Math.random() * 0.06), 0.013)
  }
}

/** Chips dropped one at a time onto a stack, counting out a bet. */
function chipCount(t: Table, at: number): void {
  const n = 3 + Math.floor(Math.random() * 4)
  const hz = 1150 + Math.random() * 500
  for (let i = 0; i < n; i++) {
    /* Each one lands on a taller stack, so the note comes up a little. */
    chip(t, at + i * (0.19 + Math.random() * 0.1), hz * (1 + i * 0.03), 0.02)
  }
}

/**
 * A bet going in: the stack shoved across the cloth and toppling as it goes.
 *
 * The scrape is the recognisable half - chips dragged over baize is a
 * low band of noise that stops dead rather than decaying, because the hand
 * arrives and stops it.
 */
function bet(t: Table, at: number): void {
  const c = ac()
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const drag = c.createBiquadFilter()
  drag.type = 'bandpass'
  drag.frequency.setValueAtTime(700, at)
  drag.frequency.linearRampToValueAtTime(1000, at + 0.18)
  drag.Q.value = 1.5
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(0.02, at + 0.03)
  g.gain.setValueAtTime(0.02, at + 0.15)
  g.gain.linearRampToValueAtTime(0.0001, at + 0.19)
  s.connect(drag).connect(g).connect(t.dry)
  g.connect(t.wet)
  s.start(at, Math.random() * 1.4)
  s.stop(at + 0.22)
  const hz = 1200 + Math.random() * 400
  for (let i = 0; i < 4; i++) chip(t, at + 0.08 + Math.random() * 0.16, hz * (0.96 + Math.random() * 0.08), 0.014)
}

/** One card turned face up, on its own, which is the loudest moment of a hand. */
function turn(t: Table, at: number): void {
  slip(t, at, 2600, 0.022, 0.03)
  slip(t, at + 0.045, 700, 0.026, 0.06)
}

/** The deck knocked square on its edge, twice. Wood, with paper on it. */
function square(t: Table, at: number): void {
  for (let i = 0; i < 2; i++) {
    const when = at + i * (0.11 + Math.random() * 0.04)
    slip(t, when, 480, 0.036, 0.055)
    slip(t, when, 1900, 0.014, 0.012)
  }
}

/**
 * One event at the card table.
 *
 * Weighted the way a hand actually goes rather than evenly, because the
 * proportions are part of the recognition: there is a lot more fidgeting with
 * chips and turning of cards than there is shuffling, and a table that
 * shuffles every few seconds is a table where nobody is playing.
 */
export function cardTable(dry: AudioNode, wet: AudioNode): void {
  const t: Table = { dry, wet }
  const at = ac().currentTime
  const pick = Math.random()
  if (pick < 0.3) chipRiffle(t, at)
  else if (pick < 0.48) turn(t, at)
  else if (pick < 0.62) deal(t, at, 3 + Math.floor(Math.random() * 4))
  else if (pick < 0.74) chipCount(t, at)
  else if (pick < 0.85) bet(t, at)
  else if (pick < 0.94) square(t, at)
  else riffle(t, at)
}
