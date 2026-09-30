import { ac, duck, noiseBuffer, reverbIn, sfxBus, softClip } from './engine'

/*
 * The machine. Iron, springs, and coins, all synthesised and all sent through
 * the same room the crowd is standing in - a dry click over a picture with a
 * room in it is worse than no sound at all.
 *
 * The only sound in here that is doing a job rather than dressing the picture
 * is reelStop(): the third one has to land hard enough to be the full stop at
 * the end of a pull, because that is the instant the room reacts to.
 *
 * REBUILT, and the thing that was wrong with it is easy to state. Everything in
 * this file used to be made of two primitives: a band of noise with a decay on
 * it, and a sine with a decay on it. Those are the right two primitives and
 * they are not enough, because a machine made of them has no METAL in it. The
 * defining property of struck steel is that it rings at frequencies which are
 * not a harmonic series - a plate's modes go roughly 1 : 2.76 : 5.4 : 8.9 - and
 * that inharmonicity is what the ear uses to tell iron from wood, from glass,
 * and from an oscillator. A ratchet tooth built as a filtered click is a click;
 * built as four inharmonic partials under a click it is a steel pawl.
 *
 * Three structural things came out of taking that seriously, and they are the
 * reason this machine sounds like a different machine rather than the same one
 * remixed:
 *
 *   THE CASTING IS A SHARED BODY. Every impact on it - the lever hitting its
 *     stop, each reel dropping into its notch - now goes through the same two
 *     resonances, because they are all the same eighty pounds of cast iron
 *     being hit in different places. Before, each event had its own private
 *     thud, and a machine whose parts do not share a body is a collection of
 *     sounds rather than an object.
 *
 *   THE CUP IS A RESONATOR. A coin fall used to be eighteen independent bells
 *     at random pitches, which is a wind chime. A real payout is eighteen
 *     nearly identical coins exciting ONE iron cup, so what you hear is the
 *     cup's note struck repeatedly and the coins' own edges on top of it. That
 *     is the single biggest audible change in the file.
 *
 *   THE SPRING IS DISPERSIVE. A coil spring carries high frequencies faster
 *     than low ones, which is why a spring goes "boing" and not "bong". The
 *     lever's return now has that in it.
 */

function bus(send = 0.3): GainNode {
  const c = ac()
  const g = c.createGain()
  g.connect(sfxBus())
  const room = c.createGain()
  room.gain.value = send
  g.connect(room).connect(reverbIn())
  return g
}

function burst(o: {
  at?: number
  freq: number
  q: number
  gain: number
  attack?: number
  decay: number
  type?: BiquadFilterType
  send?: number
  into?: AudioNode
}): void {
  const c = ac()
  const at = o.at ?? c.currentTime
  const s = c.createBufferSource()
  s.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.value = o.freq
  f.Q.value = o.q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(o.gain, at + (o.attack ?? 0.003))
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.decay)
  s.connect(f).connect(g).connect(o.into ?? bus(o.send))
  s.start(at, Math.random() * 1.4)
  s.stop(at + o.decay + 0.05)
}

function tone(o: {
  at?: number
  freq: number
  to?: number
  gain: number
  decay: number
  type?: OscillatorType
  send?: number
  into?: AudioNode
}): void {
  const c = ac()
  const at = o.at ?? c.currentTime
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, at)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.decay)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(o.gain, at + 0.005)
  g.gain.exponentialRampToValueAtTime(o.gain * 0.0002, at + o.decay)
  osc.connect(g).connect(o.into ?? bus(o.send ?? 0.28))
  osc.start(at)
  osc.stop(at + o.decay + 0.05)
}

/**
 * A struck piece of steel, and the new primitive this file is built on.
 *
 * The ratios are a free circular plate's bending modes rather than a harmonic
 * series, and that is the whole point: 1, 2.76, 5.4, 8.9 is metal, and
 * 1, 2, 3, 4 is a musical instrument. The higher modes are damped harder than
 * the lower ones because that is how a plate loses energy, which is why a
 * struck pawl is a bright tick that turns into a short dull note rather than a
 * chord that fades evenly.
 *
 * @param bright 0 to 1: how much of the upper modes survive. A pawl tapped by
 *        a light spring is dull; the same pawl slammed by a falling arm rings.
 */
function metal(at: number, hz: number, gain: number, decay: number, bright: number, into?: AudioNode): void {
  const c = ac()
  const out = into ?? bus(0.22)
  const modes = [1, 2.76, 5.4, 8.9]
  const levels = [1, 0.5 * bright, 0.26 * bright, 0.12 * bright]
  modes.forEach((m, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz * m * (1 + (Math.random() - 0.5) * 0.01)
    const g = c.createGain()
    const d = decay / (1 + i * 0.85)
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(gain * levels[i], at + 0.0012)
    g.gain.exponentialRampToValueAtTime(0.0001, at + d)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + d + 0.03)
  })
  /* And the contact itself, which is what makes it an impact and not a chime. */
  burst({ at, freq: hz * 3.4, q: 1.2, gain: gain * 0.55, decay: 0.006, into: out })
}

/**
 * Eighty pounds of cast iron taking a knock.
 *
 * Shared by everything that hits the machine, because it is the same object
 * every time. Cast iron is heavily damped - a lot of carbon in the grain - so
 * it does not ring like a bell; it gives one low thump and a short woody note
 * and is finished inside a fifth of a second. Getting the DAMPING right is
 * most of what makes it read as iron rather than as a drum.
 *
 * @param weight how hard it was hit, roughly 0.5 to 2.
 */
function casting(at: number, weight: number, send = 0.3): void {
  const out = bus(send)
  /* The body's two audible modes, measured off nothing in particular - these
   * are chosen for being low, close together and fast to die, which is what a
   * thick irregular iron shell does. */
  tone({ at, freq: 96, gain: 0.07 * weight, decay: 0.13, type: 'sine', into: out })
  tone({ at, freq: 149, gain: 0.05 * weight, decay: 0.1, type: 'sine', into: out })
  /* The shock. Broadband, and gone almost immediately. */
  burst({ at, freq: 360, q: 0.7, gain: 0.075 * weight, decay: 0.05, into: out })
  /* The bar top under it. Mahogany two inches thick, which is a thud with no
   * top on it at all. */
  burst({ at, freq: 130, q: 0.9, gain: 0.05 * weight, decay: 0.09, type: 'lowpass', into: out })
}

/**
 * The arm coming down: a steel pawl walking up a ratchet wheel while the
 * return spring is wound, then the whole casting taking the stop at the bottom.
 *
 * Two things here are new and both are mechanisms rather than decoration.
 *
 * The teeth are struck steel now - see metal() - and they get BRIGHTER as well
 * as faster and higher as the arm comes down, because the arm is accelerating
 * and a harder strike puts more energy into the upper modes. A ratchet whose
 * teeth all have the same timbre is a ratchet being turned by a motor.
 *
 * And the spring is audible while it is being wound, which it was not before.
 * Stretching a coil raises its transverse resonance, so there is a thin rising
 * whine under the ratchet - quiet, and the only continuous sound in the pull.
 * Without it a lever is a row of clicks with nothing storing any energy, and
 * then the release at the bottom has come from nowhere.
 */
export function leverPull(): void {
  const c = ac()
  const now = c.currentTime
  const out = bus(0.18)
  const teeth = 17
  for (let i = 0; i < teeth; i++) {
    // Quadratic spacing, so the ratchet accelerates the way an arm does.
    const u = i / teeth
    const t = now + 0.34 * (1 - (1 - u) ** 2)
    metal(t, 1180 + u * 520, 0.03 + u * 0.022, 0.03, 0.35 + u * 0.55, out)
  }
  /* The spring winding. */
  const coil = c.createOscillator()
  coil.type = 'triangle'
  coil.frequency.setValueAtTime(760, now)
  coil.frequency.exponentialRampToValueAtTime(1340, now + 0.34)
  const thin = c.createBiquadFilter()
  thin.type = 'bandpass'
  thin.frequency.value = 1100
  thin.Q.value = 2.4
  const cg = c.createGain()
  cg.gain.setValueAtTime(0.0001, now)
  cg.gain.linearRampToValueAtTime(0.014, now + 0.1)
  cg.gain.setValueAtTime(0.014, now + 0.32)
  cg.gain.linearRampToValueAtTime(0.0001, now + 0.36)
  coil.connect(thin).connect(cg).connect(out)
  coil.start(now)
  coil.stop(now + 0.4)
  /* The hard stop, and then the clutch letting go a few milliseconds later -
   * which is the sound the reels start on. */
  casting(now + 0.35, 1.3)
  metal(now + 0.35, 420, 0.06, 0.1, 0.8, out)
  metal(now + 0.372, 890, 0.035, 0.05, 0.9, out)
  duck(0.14, 0.15, 0.5)
}

/**
 * One tooth of the ratchet, for a hand dragging the arm down by hand rather
 * than letting leverPull() play the whole movement.
 *
 * @param tension 0 to 1, how far down the throw the tooth is. The pitch and
 *        the brightness both rise with it because the spring is being wound
 *        and the pawl is being pushed harder, which is the only cue a player
 *        gets that the arm is nearly at the clutch.
 */
export function leverNotch(tension: number): void {
  metal(ac().currentTime, 1180 + tension * 520, 0.032 + tension * 0.022, 0.032, 0.35 + tension * 0.55)
}

/**
 * The arm swinging back up under its spring, and the one genuinely odd sound
 * in the file.
 *
 * A coil spring is DISPERSIVE: a disturbance travelling along it moves faster
 * at high frequencies than at low ones, so a single knock arrives at the far
 * end smeared out into a descending chirp, and a train of those is the "boing"
 * that no other object makes. Three staggered chirps is enough to hear it.
 */
export function leverReturn(): void {
  const c = ac()
  const now = c.currentTime
  const out = bus(0.2)
  for (let i = 0; i < 3; i++) {
    const at = now + i * 0.045
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(1500 - i * 220, at)
    o.frequency.exponentialRampToValueAtTime(320 - i * 40, at + 0.13)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(0.022 / (1 + i * 0.6), at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + 0.18)
  }
  /* And the arm reaching the top of its travel and bouncing once. */
  metal(now + 0.19, 640, 0.04, 0.06, 0.7, out)
  metal(now + 0.245, 640, 0.014, 0.04, 0.5, out)
}

/**
 * One stop going past the window. Called from the reel loop, not scheduled.
 *
 * The reel band's detent clicking past its spring, inside a box - so it is a
 * tick with the drum's own cavity behind it, and the cavity is why three reels
 * spinning sound like one machine instead of three.
 */
export function reelTick(speed: number): void {
  const c = ac()
  const out = bus(0.1)
  const drum = c.createBiquadFilter()
  drum.type = 'peaking'
  drum.frequency.value = 520
  drum.Q.value = 2.2
  drum.gain.value = 7
  drum.connect(out)
  burst({ freq: 2100 + speed * 30, q: 7, gain: 0.011 + speed * 0.0006, decay: 0.014, into: drum })
  burst({ freq: 700, q: 1.6, gain: 0.006 + speed * 0.0004, decay: 0.022, into: drum })
}

/**
 * A band coming to rest, and the only sound in this file with a job.
 *
 * A reel does not simply stop: the pawl drops into its notch, the drum's
 * momentum carries it a few degrees further against the spring, and it rocks
 * back into the notch once or twice before it settles. Those rebounds are here
 * and they are the reason this reads as something heavy arriving rather than a
 * sample being cut off - and on the third reel they are also the last thing
 * the player hears before the room says what it thinks.
 *
 * The index makes the last one the heaviest, because it is the one the room is
 * holding its breath for.
 */
export function reelStop(index: number): void {
  const c = ac()
  const now = c.currentTime
  const weight = 1 + index * 0.55
  const out = bus(0.26)
  /* The pawl into the notch. Each reel is a slightly different size, so each
   * one has its own note - which is what stops three stops in a row sounding
   * like one sound played three times. */
  metal(now, 560 - index * 70, 0.055 * weight, 0.09, 0.85, out)
  /* The drum rocking back. Two rebounds, closer together and much quieter,
   * which is what a damped return against a spring does. */
  metal(now + 0.052 + index * 0.004, 560 - index * 70, 0.018 * weight, 0.06, 0.5, out)
  metal(now + 0.086 + index * 0.006, 560 - index * 70, 0.007 * weight, 0.04, 0.3, out)
  /* And the casting feeling it. Only really on the last one - the first two
   * are the mechanism, the third is the machine. */
  casting(now, 0.45 * weight)
  if (index === 2) duck(0.2, 0.1, 0.5)
}

/**
 * Coins into the iron cup, and the biggest single change in this file.
 *
 * What was here before was one sine per coin at a random pitch between 1.7 and
 * 3.1kHz. Every coin was therefore a different object, which is a wind chime:
 * the sound had no place in it. Two things fix that and both are physical.
 *
 * THE CUP. All of them land in the same cast-iron cup, so all of them excite
 * the same two resonances, and those resonances are the sound of the payout -
 * the coins are only what is exciting them. This is why a real jackpot sounds
 * like a single continuous event with a rhythm rather than like n separate
 * noises, and it is built as a shared filter chain that every coin in one
 * payout runs through.
 *
 * THE BOUNCES. A coin dropped into a metal cup does not land once. It lands,
 * rebounds, lands again sooner and quieter, and the interval shrinks
 * geometrically until it rattles flat and stops. That accelerating rattle is
 * the most recognisable part of the whole sound, and it was completely absent.
 *
 * On top of those, the coins are all nearly the same object now - they are all
 * nickels - so their own edge-tones sit in a narrow band with a few percent of
 * scatter, rather than being spread over an octave.
 */
export function payoutCoins(count: number): void {
  const c = ac()
  const n = Math.min(26, Math.max(2, count))
  const out = bus(0.45)

  /* The cup, shared. Two peaks: the shell's note and the ring of the rim. */
  const shell = c.createBiquadFilter()
  shell.type = 'peaking'
  shell.frequency.value = 430
  shell.Q.value = 3.2
  shell.gain.value = 11
  const rim = c.createBiquadFilter()
  rim.type = 'peaking'
  rim.frequency.value = 1250
  rim.Q.value = 2.6
  rim.gain.value = 8
  shell.connect(rim).connect(out)

  for (let i = 0; i < n; i++) {
    const first = c.currentTime + 0.05 + i * (0.055 + Math.random() * 0.05)
    /* One coin, in a narrow band because they are all the same coin. */
    const hz = 3400 + Math.random() * 500
    let at = first
    let level = 1
    let step = 0.038 + Math.random() * 0.02
    /* Four contacts, each sooner and quieter than the last. */
    for (let b = 0; b < 4; b++) {
      metal(at, hz, 0.026 * level, 0.13 * level, 0.9, shell)
      /* And the cup being struck, which is where nearly all of the level is. */
      burst({ at, freq: 520, q: 1.1, gain: 0.03 * level, decay: 0.05, into: shell })
      at += step
      step *= 0.62
      level *= 0.45
    }
  }
  duck(0.16, 0.2 + n * 0.02, 0.8)
}

/**
 * The bell on top of the machine, rebuilt as a bell rather than as a set of
 * ratios that were not a beep.
 *
 * The old one had six partials at 1, 2, 2.4, 3, 4.5, 5.33 over 620Hz, struck
 * three times 420ms apart, decaying over two and a bit seconds. Every number
 * in that is now different, and two of the changes are the ones you hear.
 *
 * IT IS A STEEL DOME, NOT A CHURCH BELL. A slot machine carries a small struck
 * gong a couple of inches across. That is a much higher and much shorter sound
 * than 620Hz ringing for two seconds - it is up near a kilohertz and it is
 * done inside a second - and the reason the old one read as churchy is that a
 * long low decay is the only thing a big bell has that a small one does not.
 *
 * IT TRILLS. The hammer on these machines is driven by the same mechanism that
 * is paying the coins out, so it does not strike three deliberate times: it
 * hits fast, six or seven times, unevenly, and the strikes pile up on each
 * other while the previous one is still ringing. That overlap - not the
 * partial ratios - is what makes it sound like a machine announcing something.
 *
 * The ratios themselves are still a real bell's rather than a harmonic series.
 * A tuned bell has a hum an octave below the strike note, then the prime, then
 * a MINOR third above it, a fifth, and the nominal an octave up; that minor
 * third is why bells sound the way they sound and nothing else in this project
 * has one.
 */
export function libertyBell(strikes = 3): void {
  const c = ac()
  const out = bus(0.6)
  const f0 = 1080
  /* hum, prime, tierce (minor third), quint, nominal, and one above. */
  const partials = [0.5, 1, 1.19, 1.5, 2, 2.53]
  const levels = [0.55, 1, 0.68, 0.34, 0.42, 0.18]
  /* Six or seven hammer blows in the time the old one fitted three. */
  const blows = Math.max(3, Math.round(strikes * 2.2))
  let at = c.currentTime
  for (let s = 0; s < blows; s++) {
    /* Uneven, because a mechanical hammer driven off a payout is not a
     * metronome. */
    const strength = s === 0 ? 1 : 0.62 + Math.random() * 0.38
    partials.forEach((p, i) => {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = f0 * p * (1 + (Math.random() - 0.5) * 0.003)
      const g = c.createGain()
      const decay = 0.85 / (1 + i * 0.4)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.linearRampToValueAtTime(0.028 * levels[i] * strength, at + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + decay + 0.04)
    })
    /* The hammer itself hitting the dome: a hard tick, and without it a bell
     * is a tone that faded in. */
    burst({ at, freq: 5400, q: 1.2, gain: 0.03 * strength, decay: 0.012, into: out })
    at += 0.115 + Math.random() * 0.05
  }
  duck(0.34, 0.5, 1.4)
}

/**
 * Coins going in, one slot at a time.
 *
 * Counted out rather than played once and made louder, because the count is
 * the information: the stake is a number the player set and this is the only
 * confirmation of it that does not need looking at.
 *
 * It is now the whole journey rather than three blips. A coin edged into the
 * slot scrapes on the way in, drops down a sheet-steel chute - which is a run
 * of contacts getting closer together as it accelerates, the one sound in the
 * machine that speeds up - and lands on the mechanism at the bottom. The chute
 * is the part that makes it read as going INTO something.
 */
export function coinIn(count = 1): void {
  const c = ac()
  const out = bus(0.3)
  for (let i = 0; i < count; i++) {
    const start = c.currentTime + i * 0.19
    /* Slightly different from the last, the way three coins down the same
     * slot are. */
    const hz = 3500 * (1 - i * 0.03)
    /* Edged in: the coin's rim on the slot's lip. */
    burst({ at: start, freq: 4200, q: 2.4, gain: 0.022, decay: 0.03, into: out })
    metal(start + 0.01, hz, 0.02, 0.07, 0.8, out)
    /* Down the chute, accelerating. */
    let t = start + 0.055
    let step = 0.036
    for (let k = 0; k < 5; k++) {
      metal(t, hz * (0.94 + Math.random() * 0.12), 0.012, 0.045, 0.7, out)
      t += step
      step *= 0.78
    }
    /* And onto the mechanism, which is the only part of this the casting
     * feels. */
    metal(t, 700, 0.03, 0.08, 0.6, out)
    casting(t, 0.3, 0.3)
  }
}

/** The iron going quiet for the night, when the room shuts it down. */
export function shutDown(): void {
  const c = ac()
  const now = c.currentTime
  const shaped = softClip(c, 2.0)
  shaped.connect(bus(0.7))
  /*
   * A flywheel coasting to a stop, which is a pitch falling and a rate
   * falling with it. The rate is the part that was missing: a tone sliding
   * down is a synthesiser, and a tone sliding down with a slowing rattle on
   * top of it is something mechanical losing its momentum.
   */
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.setValueAtTime(168, now)
  o.frequency.exponentialRampToValueAtTime(38, now + 1.5)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.linearRampToValueAtTime(0.13, now + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.7)
  o.connect(g).connect(shaped)
  o.start(now)
  o.stop(now + 1.8)
  let t = now
  let step = 0.075
  while (t < now + 1.45) {
    metal(t, 300 + Math.random() * 120, 0.012 * (1 - (t - now) / 1.6), 0.05, 0.4)
    t += step
    step *= 1.17
  }
  /* And the last thing to move drops into place. */
  casting(now + 1.5, 0.8, 0.8)
}

/** A control answering a finger: the smallest piece of steel in the building. */
export function click(): void {
  metal(ac().currentTime, 1650, 0.03, 0.028, 0.5, bus(0.12))
}

/** A notch cut into the bar rail: one more pull counted. */
export function notch(): void {
  const out = bus(0.2)
  /* A knife point into hardwood: a hard tick with no ring at all, because
   * wood does not have any, and the fibres tearing under it. */
  burst({ freq: 2400, q: 1.8, gain: 0.028, decay: 0.018, into: out })
  burst({ freq: 620, q: 1.1, gain: 0.016, decay: 0.045, into: out })
}
