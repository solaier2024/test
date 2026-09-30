#!/usr/bin/env node
/*
 * Measures what actually reaches the speakers.
 *
 *   node scripts/verify-audio.mjs [baseUrl]
 *
 * The brief for this table was that the room sighs OR cheers - that a loss is
 * answered as loudly as a win. That is a claim about a mix, and a mix is the
 * one thing you cannot check by reading the source. Every cue here was being
 * requested at the right moment, by the right outcome, with a line on screen
 * to match, and the audio graph was correctly wired from the oscillator to the
 * destination. It still did not meet the brief, because the crowd was 12dB too
 * quiet: fourteen men shouting came out at -37dBFS against a room tone of -36,
 * so what you actually heard on a win was the coin fall, and on a loss you
 * heard nothing at all. Every reading in this file is there because that was
 * invisible until something measured it.
 *
 * Five kinds of check, in order.
 *
 *   0. The OPENING, measured while the film is on screen. It is first because
 *      it is the first thing a player hears, and it had no sound at all -
 *      invisible to every other section here, all of which begin by skipping
 *      the opening in order to get at the table.
 *
 *   1. What the table is MADE of: the balance between the layers, whether the
 *      ambience is people or a noise generator, whether it is dull enough and
 *      crowded enough not to be heard as words, and whether the band plays
 *      numbers or a loop. Most of these are here because the brief was
 *      tightened to say so, and because every check in this file once passed
 *      on a bed of filtered noise and a four-bar turnaround - a level cannot
 *      tell a crowd from a hiss, and it cannot tell a band from a loop either.
 *
 *   2. Each reaction on its own, fired through the game's own react() on the
 *      game's own graph, so the six can be compared against each other and
 *      against the machine sounds they have to be heard over. Nothing is
 *      simulated: window.__audio.react IS src/audio/crowd.ts. Two-sided now:
 *      a reaction has to be heard, and it has to stay in proportion to what
 *      happened - see the ladder.
 *
 *   3. The binding, by playing. A reaction that is audible but fires on the
 *      wrong outcome is the "fake noise" the brief was guarding against, so
 *      the play-through insists the sound arrives with the line that names
 *      the outcome that caused it. reactionTo() is pinned exhaustively in
 *      src/game/engine.test.ts; this is the other end of the same wire.
 *
 *   4. Silence: the hush on a call, and mute meaning mute.
 *
 * Absolute levels are asserted only as "over the room", because the room is
 * measured in the same run. Everything else is a relationship between two
 * numbers from the same session, which survives a change of mix.
 *
 * Peak-hold at the destination, against a room whose average level is -46dBFS
 * in all three columns. The table has now been wrong in both directions, and
 * the three columns are the two wrong ones and where it ended up:
 *
 *                     silent    loud      now
 *     roar            -37.4   -23.8    -21.4
 *     cheer               -   -27.0    -33.7
 *     gasp            -37.0   -28.1    -32.3
 *     sigh            -37.7   -26.1    -32.7
 *     jeer                -   -28.1    -34.1
 *     murmur              -   -34.8    -36.0
 *     the coin fall   -30.1   -28.5    -31.4
 *     the bell        -28.4   -28.5    -29.6
 *
 * The first column is the original defect in one place: the three reactions
 * that were measurable at all were quieter than the room they were supposed
 * to be reacting in, and both of the machine's own noises were louder than
 * any of them. So everything got pushed up until it cleared the room by 10dB.
 *
 * The second column is what that produced, and it took a player an hour to
 * say what is obvious from it: every row within 5dB of every other row. A
 * flat loss - the commonest outcome on the machine - was 2dB off a jackpot,
 * so the building came apart about every third pull and the jackpot had
 * nothing to be louder than. The brief that produced that column asked for a
 * loss to be answered as loudly as a win and got exactly what it asked for.
 *
 * The third is a ladder. The jackpot went UP; everything routine came down 5
 * to 6dB, under the bell and the coin fall it is reacting to. A roar is now
 * 11dB above an ordinary pull rather than 2.
 *
 * The reaction columns are medians of five firings, because a crowd is
 * randomised on purpose and one reading is a sample rather than a
 * measurement. The two machine rows are single readings and move about 2dB
 * between runs for the same reason - see the pull peak in section 3, which is
 * what the ceiling is measured against instead. Thresholds are set with a few
 * dB of margin rather than against these exact figures.
 */
import { chromium } from 'playwright'
import { open, skipIntro } from './lib/skip-intro.mjs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180/'
/* The night the stills and the walkthrough come from: pull 1 is a near miss,
 * pull 2 pays, pull 3 is a flat loss. */
const url = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=51`

/*
 * The probe is installed by patching connect() before any page code runs, so
 * whatever the game joins to the destination is joined to an analyser too. The
 * game needs no test hook for this and what gets measured is the real output
 * rather than a second graph built for testing.
 */
const PROBE = () => {
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !window.__probe) {
      const probe = this.context.createAnalyser()
      probe.fftSize = 2048
      probe.smoothingTimeConstant = 0
      connect.call(this, probe)
      window.__probe = probe
    }
    return connect.call(this, dest, ...rest)
  }

  /*
   * Peak-hold level, and the average spectrum, over a window.
   *
   * Armed from inside the page because a reaction is over in under two
   * seconds: asking for a measurement from the test process after the click
   * has already missed the attack, which is a harness bug that makes a working
   * cue look silent. It is also why the reaction windows below are taken from
   * the moment the line appears rather than from a stopwatch - an earlier
   * version of this file measured 450ms late and reported the tail of a gasp
   * as the gasp.
   */
  const grab = async (ms) => {
    const probe = window.__probe
    if (!probe) return { db: -200, bright: 0 }
    const time = new Float32Array(probe.fftSize)
    const freq = new Float32Array(probe.frequencyBinCount)
    const sum = new Float64Array(probe.frequencyBinCount)
    const hz = probe.context.sampleRate / 2 / probe.frequencyBinCount
    let peak = 0
    let sumRms = 0
    let frames = 0
    const until = performance.now() + ms
    while (performance.now() < until) {
      probe.getFloatTimeDomainData(time)
      let sq = 0
      for (const s of time) sq += s * s
      const rms = Math.sqrt(sq / time.length)
      peak = Math.max(peak, rms)
      sumRms += rms
      probe.getFloatFrequencyData(freq)
      for (let i = 0; i < freq.length; i++) sum[i] += freq[i] > -100 ? 10 ** (freq[i] / 20) : 0
      frames++
      await new Promise((r) => requestAnimationFrame(r))
    }
    /*
     * One number for the colour of the sound: everything above 1.2kHz over
     * everything below it. The centroid of the whole output is useless here
     * because the upright piano moves it by an octave on its own; this ratio
     * is dominated by the vowel, which is the thing that differs.
     */
    const band = (lo, hi) => {
      let s = 0
      for (let i = Math.ceil(lo / hz); i < Math.min(sum.length, hi / hz); i++) s += sum[i]
      return s / frames
    }
    return {
      db: peak > 0 ? 20 * Math.log10(peak) : -200,
      mean: sumRms / frames > 0 ? 20 * Math.log10(sumRms / frames) : -200,
      bright: band(1200, 6000) / Math.max(1e-9, band(80, 1200)),
    }
  }

  window.__grab = grab
  /** Fires one cue on the live graph and measures the window it lands in. */
  window.__fire = async (what, ms, density = 0.6) => {
    const measuring = grab(ms)
    if (what === 'coins') window.__audio.coins(18)
    else if (what === 'bell') window.__audio.bell(3)
    else window.__audio.react(what, density)
    return await measuring
  }
  /**
   * Peak level of each bus over a window, measured on the buses themselves.
   *
   * The probe above sits at the destination and can only ever report the sum,
   * and the thing the brief is about is the BALANCE: the saloon and the
   * machine in front, the upright behind them. These are the live nodes the
   * game plays through - main.tsx hands them over, it does not build a second
   * graph for measuring.
   */
  window.__layers = async (ms) => {
    const { sfx, band, talk } = window.__audio.buses()
    const c = window.__audio.ctx()
    /* The conversation only exists once the room has been started, and one of
     * the things measured below is whether it has been. */
    const taps = Object.entries(talk ? { sfx, band, talk } : { sfx, band }).map(([name, node]) => {
      const a = c.createAnalyser()
      a.fftSize = 2048
      a.smoothingTimeConstant = 0
      node.connect(a)
      return { name, a, buf: new Float32Array(a.fftSize), peak: 0, sum: 0, n: 0 }
    })
    const until = performance.now() + ms
    while (performance.now() < until) {
      for (const t of taps) {
        t.a.getFloatTimeDomainData(t.buf)
        let sq = 0
        for (const s of t.buf) sq += s * s
        const rms = Math.sqrt(sq / t.buf.length)
        t.peak = Math.max(t.peak, rms)
        t.sum += rms
        t.n++
      }
      await new Promise((r) => requestAnimationFrame(r))
    }
    const db = (v) => (v > 0 ? 20 * Math.log10(v) : -200)
    return Object.fromEntries(taps.map((t) => [t.name, { peak: db(t.peak), mean: db(t.sum / t.n) }]))
  }
  /**
   * Is the ambience PEOPLE, or is it a filter on a noise generator?
   *
   * This is the one question about the room that no level, no spectrum and no
   * peak-to-mean ratio can answer, because a crowd and a band of noise have
   * roughly the same long-term spectrum - that is why a noise bed is the
   * standard cheat in the first place, and why it survived here for as long
   * as it did while every other check passed.
   *
   * Two things separate them, and this measures both.
   *
   * IN TIME: speech switches on and off four or five times a second, because
   * that is how fast a mouth can change shape. The amplitude envelope of a
   * room with talking in it therefore carries real energy at 2-8Hz. Noise has
   * none there at any bandwidth or level - its envelope wanders, and
   * wandering is slow.
   *
   * IN FREQUENCY: a voice is a buzz through resonances, so its spectrum is
   * harmonics under formant peaks. Noise has no peaks. Spectral flatness -
   * the geometric mean of the spectrum over its arithmetic mean - is near 1
   * for noise and small for anything with structure, and "flat" is literally
   * what the word "white" in "white noise" means.
   *
   * Both numbers are taken off the conversation layer, and both are taken
   * again off a bed of bandpassed noise built right here from the numbers the
   * old implementation used, played into a gain of zero so that it is
   * measured and never heard. Four numbers, one instrument, one run; nothing
   * to calibrate and nothing to take on trust.
   */
  window.__speechiness = async (ms) => {
    const c = window.__audio.ctx()
    const { sfx, talk } = window.__audio.buses()
    const people = talk ?? sfx

    /* The control: 520Hz bandpassed noise under a 0.23Hz wobble, which is
     * what this table used to call a saloon. Silent by construction. */
    const n = Math.floor(c.sampleRate * 4)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    const src = c.createBufferSource()
    src.buffer = buf
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
    const silent = c.createGain()
    silent.gain.value = 0
    src.connect(band).connect(wobble).connect(silent).connect(c.destination)
    src.start()
    lfo.start()

    const tap = (node) => {
      /* Short window for the envelope: this is measuring how fast the level
       * moves, so the instrument has to be quicker than the thing it is
       * looking for. 512 samples is 12ms, and a syllable is 200. */
      const fast = c.createAnalyser()
      fast.fftSize = 512
      fast.smoothingTimeConstant = 0
      node.connect(fast)
      /* And a long one for the spectrum, because resolving the harmonics of a
       * 120Hz throat needs bins narrower than 120Hz. 4096 gives 11. */
      const fine = c.createAnalyser()
      fine.fftSize = 4096
      fine.smoothingTimeConstant = 0
      node.connect(fine)
      return {
        fast,
        fine,
        buf: new Float32Array(fast.fftSize),
        bins: new Float32Array(fine.frequencyBinCount),
        power: new Float64Array(fine.frequencyBinCount),
        env: [],
        frames: 0,
      }
    }
    const room = tap(people)
    const hiss = tap(wobble)

    const at = []
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      for (const p of [room, hiss]) {
        p.fast.getFloatTimeDomainData(p.buf)
        let sq = 0
        for (const s of p.buf) sq += s * s
        p.env.push(Math.sqrt(sq / p.buf.length))
        /* Only frames with signal in them go into the average spectrum. A
         * talker is silent between phrases, and the flatness of a gap is the
         * flatness of the measuring noise floor. */
        if (sq / p.buf.length > 1e-10) {
          p.fine.getFloatFrequencyData(p.bins)
          for (let i = 0; i < p.bins.length; i++) p.power[i] += 10 ** (p.bins[i] / 10)
          p.frames++
        }
      }
      at.push((performance.now() - t0) / 1000)
      await new Promise((r) => requestAnimationFrame(r))
    }
    src.stop()
    lfo.stop()

    /*
     * Flatness over the band a vowel lives in. Below 180Hz is the throat
     * rather than the mouth and above 4kHz there is nothing but the
     * consonants, and including either would be measuring the filter that
     * puts the talker across the room rather than the talker.
     */
    const hzPerBin = c.sampleRate / 2 / room.power.length
    const energy = (p, lo, hi) => {
      let s = 0
      for (let i = Math.ceil(lo / hzPerBin); i < Math.min(p.power.length, hi / hzPerBin); i++) s += p.power[i]
      return s
    }
    const flatness = (p) => {
      let logs = 0
      let sum = 0
      let n = 0
      for (let i = Math.ceil(180 / hzPerBin); i < Math.min(p.power.length, 4000 / hzPerBin); i++) {
        const v = Math.max(1e-20, p.power[i] / Math.max(1, p.frames))
        logs += Math.log(v)
        sum += v
        n++
      }
      return Math.exp(logs / n) / (sum / n)
    }

    /* rAF does not tick evenly, so put the envelope on a real time base
     * before taking its spectrum - otherwise a dropped frame reads as
     * modulation. */
    const RATE = 60
    const span = at[at.length - 1] - at[0]
    const count = Math.floor(span * RATE)
    const spectrum = (env) => {
      const even = new Float64Array(count)
      let k = 0
      for (let i = 0; i < count; i++) {
        const t = at[0] + i / RATE
        while (k < at.length - 2 && at[k + 1] < t) k++
        const f = (t - at[k]) / Math.max(1e-6, at[k + 1] - at[k])
        even[i] = env[k] + (env[k + 1] - env[k]) * Math.min(1, Math.max(0, f))
      }
      let mean = 0
      for (const v of even) mean += v
      mean /= count
      /* Relative to the mean level, so this says nothing about how loud
       * anything is - only about how much it moves. */
      for (let i = 0; i < count; i++) even[i] = (even[i] - mean) / Math.max(1e-9, mean)
      const out = []
      for (let hz = 0.25; hz <= 16.001; hz += 0.25) {
        let re = 0
        let im = 0
        for (let i = 0; i < count; i++) {
          const w = (2 * Math.PI * hz * i) / RATE
          re += even[i] * Math.cos(w)
          im += even[i] * Math.sin(w)
        }
        out.push({ hz, power: (re * re + im * im) / (count * count) })
      }
      return out
    }
    const measure = (p) => {
      const s = spectrum(p.env)
      const sum = (lo, hi) => s.filter((b) => b.hz >= lo && b.hz <= hi).reduce((a, b) => a + b.power, 0)
      const mean = p.env.reduce((a, b) => a + b, 0) / Math.max(1, p.env.length)
      return {
        /* Energy at a syllable rate against the slow wander that any signal
         * has, so this is a shape and not a level. */
        ratio: sum(2.5, 8) / Math.max(1e-12, sum(0.25, 1.25)),
        flat: flatness(p),
        /*
         * How much of this layer is in the band that carries words.
         *
         * Speech is identifiable AS speech between roughly 1.5 and 4kHz -
         * that is where the consonants are and where the second formant has
         * enough room to say which vowel it is. It is also the first thing
         * that ten metres of air and a wall full of people take away, which
         * is why a crowd across a room is a murmur and not a conversation.
         * A layer with energy up there is somebody talking AT you, and if
         * there is no language behind it, what that sounds like is an alien.
         */
        voiced: energy(p, 1500, 5000) / Math.max(1e-20, energy(p, 180, 1500)),
        /*
         * And how much of the time it thins out to nearly nothing.
         *
         * The other half of the same failure, and the half that is not about
         * filters at all: a crowd is unfollowable because several people are
         * always talking at once. Whenever the layer drops to near silence,
         * whoever speaks next is alone in the clear, and one voice in the
         * clear is a voice the ear tries to get words out of. Six talkers
         * with three-second gaps spent much of their time here.
         */
        alone: p.env.filter((v) => v < mean * 0.25).length / Math.max(1, p.env.length),
      }
    }
    return { room: measure(room), noise: measure(hiss) }
  }

  /**
   * Watches the upright until it has been caught both playing and not.
   *
   * "The music is furniture" was asserted with a level, and a level cannot
   * tell the difference between a piano in a bar and a loop turned down. The
   * difference is that a number ENDS. So this one waits for a stretch of real
   * playing and a gap of at least six seconds, and reports how long each took
   * - which also fails, by timing out, if somebody puts a loop back.
   */
  window.__watchBand = async (ms) => {
    const c = window.__audio.ctx()
    const { band } = window.__audio.buses()
    const a = c.createAnalyser()
    a.fftSize = 1024
    a.smoothingTimeConstant = 0
    band.connect(a)
    const buf = new Float32Array(a.fftSize)
    const t0 = performance.now()
    const seen = []
    /*
     * An absolute threshold, not a fraction of the loudest thing seen. The
     * first version of this scaled against the maximum in the window, and on
     * a run that opened inside a gap the maximum WAS the noise floor, so the
     * check reported a piano that had been playing all along and found no
     * playing at all. Between numbers this bus is digitally silent - nothing
     * is connected to it - so -80dBFS separates the two states with 20dB to
     * spare either way.
     */
    const FLOOR = 1e-4
    const tally = () => {
      let quiet = 0
      let silence = 0
      let playing = 0
      let sum = 0
      let n = 0
      for (const s of seen) {
        quiet = s.rms < FLOOR ? quiet + 0.12 : 0
        silence = Math.max(silence, quiet)
        if (s.rms >= FLOOR) {
          playing += 0.12
          sum += s.rms
          n++
        }
      }
      /*
       * And how loud it is WHILE IT IS PLAYING, which is the only reading of
       * this bus the balance can be argued from. Averaged over the whole
       * watch it would be a number about how long the gaps are.
       */
      const level = n ? 20 * Math.log10(sum / n) : -200
      return { watched: seen.length * 0.12, silence, playing, level }
    }
    while (performance.now() - t0 < ms) {
      a.getFloatTimeDomainData(buf)
      let sq = 0
      for (const s of buf) sq += s * s
      seen.push({ rms: Math.sqrt(sq / buf.length) })
      await new Promise((r) => setTimeout(r, 120))
      /* Stop as soon as the question is answered, so a run that catches the
       * piano early does not sit out the rest of the number. */
      const got = tally()
      if (got.silence > 6 && got.playing > 4) break
    }
    return tally()
  }

  /** Waits for the room to say something on screen, then measures from there. */
  window.__onReaction = async (ms) => {
    const text = () => document.querySelector('.said')?.textContent?.trim() ?? ''
    const t0 = performance.now()
    while (!text() && performance.now() - t0 < 20000) await new Promise((r) => requestAnimationFrame(r))
    const said = text()
    return { ...(await grab(ms)), said }
  }
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const problems = []
let checks = 0
function expect(what, ok, detail) {
  checks++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what.padEnd(52)} ${detail}`)
  if (!ok) problems.push(`${what}: ${detail}`)
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ reducedMotion: 'no-preference' })
await context.addInitScript(PROBE)

const label = (p) => p.locator('button.sound').textContent().then((s) => (s ?? '').trim())

/*
 * Presses the control until sound is on, whatever state it started in, and
 * reads the state off the speaker glyph rather than assuming it.
 *
 * Getting this wrong is not a small harness bug, it is an INVERTING one, and
 * it is the first thing this file did. The control is three-state - locked, on,
 * muted - and one press means "unlock" or "toggle" depending on which it was.
 * Under --autoplay-policy=no-user-gesture-required the context is already
 * running, so a blind opening press MUTES the game and every reading after it
 * is of silence. Nine failures that all pointed at the audio engine and none of
 * which were in it.
 */
async function soundOn(p) {
  for (let i = 0; i < 3; i++) {
    if ((await label(p)).includes('🔊')) return true
    await p.locator('button.sound').click()
    await p.waitForTimeout(500)
  }
  return (await label(p)).includes('🔊')
}

/* ---- 0. the opening ---------------------------------------------------- */

/*
 * The film had no sound at all, and nothing in this file could tell.
 *
 * Every clip in the project is silent by design - a room tone baked into a
 * video cannot duck under a reel - so the opening's soundtrack is the live
 * saloon running underneath it. That was wired up and it did not work:
 * Intro.tsx started the band and not the room, and the band deferred its
 * first number by six to sixteen seconds, which is longer than the film. So
 * the game opened on a shot of a bar three deep with a band playing in the
 * corner of it, in silence, and then the sound arrived when you sat down.
 *
 * The reason this file could not see it is structural rather than subtle:
 * every other section starts by SKIPPING the opening, because the sections
 * are about the table. So the opening gets its own page, which does not seed
 * the seen-flag, and everything here is measured while the film is on screen
 * - asserted at both ends of the window, so a reading taken after the film
 * had handed over to the machine-select screen cannot pass for one taken
 * during it.
 */
const film = await context.newPage()
film.on('pageerror', (e) => problems.push(String(e)))
film.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
await open(film, url)
await film.waitForSelector('.intro-video', { timeout: 30000 })
/* The control is inside the intro's own chrome row, which stops the click
 * propagating, so turning the sound on does not dismiss the film. */
expect('the sound control turns audio on', await soundOn(film), await label(film))

const rolling = () => film.locator('.intro-video').count()
const before = await rolling()
const [opening, openingBuses] = await Promise.all([
  film.evaluate((ms) => window.__grab(ms), 4500),
  film.evaluate((ms) => window.__layers(ms), 4500),
])
const during = before > 0 && (await rolling()) > 0
await film.close()

expect('the film is still on screen while it is measured', during, `${before} video element(s), then ${during ? 'still there' : 'gone'}`)
/*
 * Not silence. An absolute threshold is worth using exactly once, and this is
 * the place: the claim is that there is an audio track at all. For scale, the
 * check at the bottom of this file that mute means mute asks for -70dBFS and
 * measures around -200, and the table's own room tone lands near -46.
 */
expect('the opening has a soundtrack at all', opening.mean > -60, `${opening.mean.toFixed(1)} dBFS average under the film`)
/*
 * And it is the saloon rather than a music cue, which is the other half of
 * the requirement: the film is four shots of the inside of a busy bar, so
 * what plays under it has to be that bar. Same ordering as the idle table
 * below, measured on the same buses.
 */
expect(
  'and what plays under it is the room, not the band',
  openingBuses.sfx.mean > openingBuses.band.mean + 4,
  `room ${openingBuses.sfx.mean.toFixed(1)} against a band of ${openingBuses.band.mean.toFixed(1)} dBFS`,
)
/*
 * Including the conversation, which is the part that was missing rather than
 * merely quiet: startRoom() is what builds this bus, so if the opening had
 * gone on starting the band alone there would be no talk bus for __layers to
 * find at all.
 */
expect(
  'and the conversation is running under it',
  openingBuses.talk !== undefined && openingBuses.talk.mean > -60,
  openingBuses.talk ? `${openingBuses.talk.mean.toFixed(1)} dBFS of talking` : 'the room was never started',
)

const page = await context.newPage()
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

await skipIntro(page, url)
await page.waitForSelector('.machines button', { timeout: 30000 })
expect('the sound control turns audio on at the table too', await soundOn(page), await label(page))

// The crooked machine: the most reactions per pull, so the fewest pulls.
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(3000)

/* ---- 1. what the table is made of ------------------------------------- */

/*
 * The brief, in one sentence: the sound of this table is the saloon and the
 * machine, and the upright in the corner is furniture. That is a claim about
 * the balance between three buses, and it is not visible at the destination
 * where they are already summed - so this section measures each bus on its
 * own and asserts the ordering between them.
 *
 * It is a check worth having because the mix drifted the other way without
 * anybody deciding to. Measured before this existed: the piano peaked at
 * -35.8 and the whole ambience at -39.8, so an idle table was a soundtrack
 * with a saloon behind it rather than a saloon with a piano in it.
 *
 * Medians of three windows, for the same reason the reactions below are: an
 * idle saloon is EVENTS - a glass down, boots, a chair - and which ones fall
 * inside a six second window swings its PEAK by 6dB. That spread is the room
 * being a room, and the median is what the room is like.
 *
 * Both sides of the comparison are levels that converge, and getting there
 * cost a second CI failure in the same spot as the first. This used to be
 * peak against peak, and it failed on the deployed build at exactly 4.0dB
 * with the room at -40.0 and the upright at -44.0. Nothing was wrong with
 * the mix: the same build read -33.4 against -44.5 locally. The room's PEAK
 * moved 6.6dB between two machines and the upright's did not, for the reason
 * written out at the room tone below - a peak-hold reading of a room with
 * sparse transients in it is the loudest event that happened to land in the
 * window, and that is an extreme value, not a level.
 *
 * So the room is its MEAN, and the upright is its mean WHILE IT IS PLAYING
 * (from the watch below, which is why that runs first). The second half
 * matters as much as the first: the upright now plays a number and then sits
 * out fourteen to forty-two seconds, so its mean over any window long enough
 * to be stable is mostly a measurement of the silence, and comparing the
 * room against that would pass no matter how loud the piano was.
 */
const idle = []
for (let i = 0; i < 3; i++) idle.push(await page.evaluate((ms) => window.__layers(ms), 6000))
const layer = (bus, field = 'peak') => median(idle.map((m) => m[bus][field]))
const saloon = layer('sfx', 'mean')
const loudest = layer('sfx')
const numbers = await page.evaluate((ms) => window.__watchBand(ms), 80000)
const upright = numbers.level

expect('an idle table is the saloon, not the piano', saloon > upright + 4,
  `the room ${saloon.toFixed(1)} dBFS against an upright that reaches ${upright.toFixed(1)} while it plays`)
/*
 * And the room is a ROOM, not a hiss. A bed of filtered noise loud enough to
 * lead the mix is just tape hiss; what makes a saloon read as busy at a much
 * lower level is that things happen in it. A wide gap between peak and mean
 * is what "things happen in it" looks like as a number - and here the peak
 * being an extreme value is the point rather than a problem, because the
 * claim is about the distance between the loudest event and the average.
 */
expect('and it is a room rather than a hum', loudest - saloon > 5,
  `${(loudest - saloon).toFixed(1)}dB between the loudest thing in it and its average`)
/*
 * And it is the SAME room the film opened on, which is the second half of
 * the opening's requirement and the only part of it that needs a number from
 * this section. The four shots are the inside of this bar; walking from them
 * to the table should not sound like walking into a different building.
 *
 * A band rather than an equality, because the opening runs the room at a
 * fixed density - the loud hour, which is what the first shot is of - and
 * the table hands that dial to how hard the player is being looked at.
 */
expect(
  'and it is the room the film opened on',
  Math.abs(openingBuses.sfx.mean - saloon) < 6,
  `${openingBuses.sfx.mean.toFixed(1)} dBFS under the film against ${saloon.toFixed(1)} at the table`,
)

/*
 * And the part that no level can reach: the ambience is PEOPLE.
 *
 * The brief says the saloon noise must not be a noise floor - it has to be
 * conversation, glasses, boots, laughter. The last three of those are events
 * and the peak-to-mean check above sees them. Conversation is not an event,
 * it is continuous, and a continuous voice-shaped signal and a band of noise
 * measure the same on everything the rest of this file knows how to ask.
 * That is exactly why the bed got away with being 520Hz noise through a slow
 * wobble for as long as it did: every check in this file passed on it.
 *
 * Two properties separate them - how fast the level moves, and whether the
 * spectrum has peaks in it - and both are measured against a bed of that
 * same 520Hz noise, generated on the spot and played into a gain of zero.
 */
const speech = await page.evaluate((ms) => window.__speechiness(ms), 12000)
expect(
  'the room moves at a syllable rate, which noise cannot',
  speech.room.ratio > speech.noise.ratio * 3,
  `${speech.room.ratio.toFixed(2)} of its movement is at 2-8Hz against ${speech.noise.ratio.toFixed(2)} for noise`,
)
/*
 * And it is voices rather than a filter, which is the other half of the same
 * claim and the one the word "white" in "white noise" is literally about: a
 * flat spectrum. A buzz through formants is not flat, and no amount of
 * filtering noise makes it unflat - a filter shapes a spectrum, it cannot put
 * harmonics into one.
 */
expect(
  'and it is voices, not a flat spectrum with a filter on it',
  speech.room.flat < speech.noise.flat * 0.5,
  `spectral flatness ${speech.room.flat.toFixed(3)} against ${speech.noise.flat.toFixed(3)} for noise`,
)

/*
 * And the two checks above, having been met, produced the opposite complaint.
 *
 * Making the bed measurably people meant giving each talker a mouth: a
 * glottal buzz through formants that swept between six vowels, gated into
 * syllables, with a hiss on the front of half of them for the consonant.
 * Every number in this file improved. What a player heard was aliens.
 *
 * The diagnosis is that "a crowd" and "a voice you cannot understand" are
 * different sounds. A crowd across a room is a voice you cannot FOLLOW; the
 * moment one throat is trackable the ear starts listening for words, and in
 * a game with no language in it, the absence of words becomes the loudest
 * thing in the mix. So there are two more properties to hold, and they pull
 * against the two above rather than extending them - which is the reason to
 * measure all four rather than any one of them.
 */
expect(
  'and it is too dull to be words',
  speech.room.voiced < 0.06,
  `${(speech.room.voiced * 100).toFixed(1)}% of it is in the 1.5-5kHz band that carries them`,
)
expect(
  'and never thins out to one voice in the clear',
  speech.room.alone < 0.1,
  `near-silent for ${(speech.room.alone * 100).toFixed(1)}% of the window`,
)

/*
 * And the upright plays NUMBERS.
 *
 * "The music is furniture" was asserted with a level for as long as there
 * was music here, and a level cannot tell a piano in a bar from a loop
 * turned down - which is what it was: four bars going round for as long as
 * the table was open. A loop has no beginning and no end, and that is the
 * property that makes a thing a soundtrack, not its volume.
 *
 * So the claim is now about time rather than level: somebody plays a number,
 * finishes it, and the piano stops. The check waits for both states and
 * times out if it only ever finds one. (The watch itself ran up at the top
 * of this section, because the balance needs the level it measures.)
 */
expect(
  'the upright plays numbers and then stops',
  numbers.silence > 6 && numbers.playing > 4,
  `${numbers.playing.toFixed(0)}s of playing and a ${numbers.silence.toFixed(0)}s gap inside ${numbers.watched.toFixed(0)}s`,
)

/* ---- 2. the room, and the six things it does -------------------------- */

/*
 * Measured first and every reaction is compared against it, so a table that
 * was silent to begin with cannot pass the rest of this file by default.
 *
 * It is the room's AVERAGE level, not its peak, and that distinction only
 * started mattering when the bar got glassware. A peak-hold reading of a
 * steady hum is the level of that hum. A peak-hold reading of a room with
 * sparse transients in it is the loudest event that happened to land inside
 * the window - an extreme value, which is not a level and does not converge.
 * Measured, that is not a quibble:
 *
 *     3s windows, peak   -38.1 -40.8 -35.5 -39.9 -40.9   median -39.9
 *     8s windows, peak   -36.1 -36.7 -37.1 -40.2 -36.8   median -36.8
 *     3s windows, mean   -46.1 -45.6 -43.4 -45.6 -46.0   median -45.6
 *     8s windows, mean   -44.8 -44.7 -44.8 -45.1 -45.2   median -44.8
 *
 * The peak swings 5dB between windows AND climbs 3dB when you listen longer,
 * because listening longer catches rarer events - there is no value it is
 * converging on. The mean of an 8s window repeats to half a dB. So the mean
 * is the reference, and the reactions below are still peaks: "is this event
 * audible over the ongoing room" is exactly a peak against a level.
 *
 * This cost a CI failure on the deployed build to work out. A murmur came in
 * 0.2dB under a room whose peak had drifted 5dB up between runs - the mix was
 * fine and the ruler was rubber.
 */
const roomRuns = []
for (let i = 0; i < 3; i++) roomRuns.push(await page.evaluate((ms) => window.__grab(ms), 6000))
const room = {
  level: median(roomRuns.map((r) => r.mean)),
  bright: median(roomRuns.map((r) => r.bright)),
}
expect(
  'the empty table has a room tone',
  room.level > -55 && room.level < -32,
  `${room.level.toFixed(1)} dBFS average`,
)

const fire = async (what) => {
  const got = await page.evaluate(([w, ms]) => window.__fire(w, ms), [what, 2800])
  await page.waitForTimeout(2400)
  return got
}

/**
 * Five firings, and the middle one of each number.
 *
 * A crowd is deliberately randomised - every throat gets its own gain, start
 * time and length - so one peak-hold reading is a sample of a distribution and
 * not a measurement of the mix. Sampled eight times each, the roar varies by
 * 1.8dB between firings and the murmur, being the thinnest of them, by over
 * 4dB. Asserting an ordering between two single samples that overlap that far
 * is a coin toss dressed as a check, and it duly failed in CI on a murmur that
 * happened to come out 0.4dB above a jeer that happened to come out quiet.
 *
 * The median of three is the cheapest estimator that is actually about the
 * mix. It is not a softer claim - the thresholds below are unchanged - it is
 * the same claim measured with an instrument that can hold still.
 *
 * Five, not three, since CI failed the roar-against-groan ordering on a run
 * whose widest spread was 4.9dB. Two medians of three, differenced, carry
 * more noise than the 1-2dB that ordering had to spare. The other half of
 * that repair was in the mix, where it belonged.
 */
const fireOften = async (what, n = 5) => {
  const runs = []
  for (let i = 0; i < n; i++) runs.push(await fire(what))
  /*
   * Spread with the loudest and the quietest thrown away, which is the middle
   * three of the five. Highest-minus-lowest was the obvious thing to write
   * and it is the wrong statistic to hold a threshold against, because it can
   * only grow as you take more samples: going from three firings to five put
   * this check 0.5dB from failing without anything about the mix changing.
   * The inner range does not drift with n, and one freak firing cannot carry
   * it on its own.
   */
  const sorted = runs.map((r) => r.db).sort((a, b) => a - b)
  return {
    db: median(runs.map((r) => r.db)),
    bright: median(runs.map((r) => r.bright)),
    spread: sorted[sorted.length - 2] - sorted[1],
  }
}

const heard = {}
for (const kind of ['roar', 'cheer', 'gasp', 'sigh', 'murmur', 'jeer']) {
  heard[kind] = await fireOften(kind)
}
/* The machine's own two noises are not randomised, so one reading is the
 * measurement rather than a sample of one. */
for (const kind of ['coins', 'bell']) {
  heard[kind] = await fire(kind)
}
const over = (k) => `${heard[k].db.toFixed(1)} dBFS over a ${room.level.toFixed(1)} room`

/*
 * How far over the room a reaction has to come, in dB. Both are chosen from
 * hearing rather than from what the mix happens to measure: 10dB is roughly
 * the classic doubling of loudness, which is what a room reacting TOGETHER
 * should be worth, and 6dB is an unambiguous step up for the one reaction
 * that is not really a reaction.
 *
 * These are the floor, and turning the table down made them the binding
 * constraint rather than a formality. The five used to clear 10dB by five or
 * more; they now clear it by two to four, and the quietest of them - the jeer
 * - has the least room of anything in this file. That is the correct place
 * for the pressure to be: the reactions are as restrained as they can be
 * while a player can still hear that the room reacted.
 */
const TOGETHER = 10
const BARELY = 6

/*
 * All six, not just the two the happy path fires. A reaction nobody has heard
 * since it was written is exactly where 12dB goes missing.
 */
for (const kind of ['roar', 'cheer', 'gasp', 'sigh', 'jeer']) {
  expect(`the room's ${kind} is audible over it`, heard[kind].db > room.level + TOGETHER, over(kind))
}
/*
 * The exception, and it is deliberate: a murmur is the room NOT reacting -
 * a win too small to look up from. It has to be there, and it has to be the
 * smallest thing the room does, which is a relationship rather than a level.
 */
const quietest = Math.min(...['roar', 'cheer', 'gasp', 'sigh', 'jeer'].map((k) => heard[k].db))
expect(
  'a murmur is there, and is the least the room does',
  heard.murmur.db > room.level + BARELY && heard.murmur.db < quietest - 1,
  `${heard.murmur.db.toFixed(1)} dBFS, between a ${room.level.toFixed(1)} room and a ${quietest.toFixed(1)} groan`,
)
/*
 * And it holds still enough to be worth ordering. A murmur was five throats
 * scattered over 300ms, which barely overlap, so peak-hold was reading one
 * random voice and swinging 6.7dB; it is twelve inside 160ms now, at the same
 * level, because the level was never the problem.
 */
const worst = ['roar', 'cheer', 'gasp', 'sigh', 'jeer', 'murmur'].reduce((a, b) =>
  heard[a].spread > heard[b].spread ? a : b,
)
expect(
  'and no reaction is too erratic to compare',
  heard[worst].spread < 4,
  `widest is the ${worst}, ${heard[worst].spread.toFixed(1)}dB across the middle three of five`,
)

/*
 * The whole point of the brief, as one line, and it now has two sides.
 *
 * The original defect was that what shipped answered a win with a coin fall
 * and a loss with nothing audible at all. That got asserted as "the groan is
 * within 6dB of the ROAR", which fixed the silence and then caused the
 * opposite complaint: a player put an hour into the table and reported that
 * it came apart on every pull. He was right, and this check was part of the
 * reason. A flat loss is the commonest outcome on the machine and a jackpot
 * is the rarest, so a rule holding the commonest outcome within 6dB of the
 * rarest one is a rule that the building has to fall over every third pull.
 *
 * It was comparing the wrong pair. "输赢均有" is about a win and a loss being
 * answered alike, and the win that belongs next to an ordinary loss is an
 * ordinary WIN - the five-coin one, where somebody slaps the bar - not the
 * twenty-coin jackpot where the hats go up. Those two are what the engine
 * hands out most of the time, and holding them to each other says the thing
 * that was meant while leaving the jackpot free to be an event.
 *
 * Two-sided by construction, because it is a distance rather than a floor: a
 * groan cannot go quiet and it cannot go operatic either.
 */
expect(
  'a loss is answered as well as a win',
  Math.abs(heard.sigh.db - heard.cheer.db) < 5,
  `groan ${heard.sigh.db.toFixed(1)} against a cheer of ${heard.cheer.db.toFixed(1)} dBFS`,
)
/*
 * And the same thing for the rest of the table, which is the part a player
 * hears as restraint: only the jackpot is allowed to be an event.
 *
 * reactionTo() gives a roar at twenty coins or more, so most players will go
 * a long time without one. Everything else is routine - a five-coin win, a
 * near miss, a flat loss - and routine has to sound routine, or the loud
 * moment has nothing to be louder than.
 */
const ROUTINE = ['cheer', 'gasp', 'sigh', 'jeer', 'murmur']
const loudestRoutine = ROUTINE.reduce((a, b) => (heard[a].db > heard[b].db ? a : b))
expect(
  'only the jackpot comes off the floor',
  ROUTINE.every((k) => heard[k].db < heard.roar.db - 3),
  `loudest routine reaction is the ${loudestRoutine} at ${heard[loudestRoutine].db.toFixed(1)}, ${(heard.roar.db - heard[loudestRoutine].db).toFixed(1)}dB under a roar of ${heard.roar.db.toFixed(1)} dBFS`,
)
/*
 * The ceiling that goes with it is expressed against the machine and lives in
 * the next section, because the steady reading of "the machine" comes from a
 * whole pull rather than from firing its two noises on their own.
 */
/*
 * And the crowd, not the payout, is what you hear on a win. This is the check
 * that would have caught the original defect on its own: the coins and the
 * bell were louder than the room, so "the crowd reacted" was really "the
 * machine paid out".
 */
expect(
  'and the room is louder than the money it is cheering',
  heard.roar.db > heard.coins.db + 3 && heard.roar.db > heard.bell.db + 2,
  `roar ${heard.roar.db.toFixed(1)}, coins ${heard.coins.db.toFixed(1)}, bell ${heard.bell.db.toFixed(1)} dBFS`,
)

/*
 * Different sounds, not one buffer fired twice. A gasp is an open "aah" out of
 * eleven throats gliding UP; a groan is a round "aww" out of ten gliding DOWN.
 * Both of those pulls pay nothing, so the difference between them cannot be
 * the payout - it is the room, and it is the vowel.
 */
expect(
  'a gasp is a brighter sound than a groan',
  heard.gasp.bright > heard.sigh.bright * 1.25,
  `${heard.gasp.bright.toFixed(2)} against ${heard.sigh.bright.toFixed(2)} above 1.2kHz`,
)

/* ---- 3. bound to the outcome, by playing ------------------------------ */

/*
 * The other half of the balance, measured while the machine is working: iron
 * and coins in front of the saloon, and the upright still behind both. The
 * window is one whole pull, so what it catches is the ratchet, the three
 * bands landing and whatever the room says about it.
 *
 * The iron and the saloon share the sfx bus - there is no separate machine
 * bus, because the machine IS something in the room - so "the machine leads"
 * is that bus with the machine working, against the room's ongoing level.
 *
 * Which makes this a peak against a mean, for the same reason the reactions
 * above are: a pull is EVENTS - the ratchet, three bands landing, coins in
 * the hopper - and asking whether an event is audible over an ongoing room
 * is exactly a peak against a level. Measured with the mean on both sides it
 * reads -44.8 against -48.4, because seven seconds of a pull is mostly seven
 * seconds of room; the peak is 21dB clear and repeats to a dB between
 * machines, because it is the loudest sound the machine is BUILT to make
 * rather than whichever glass happened to land in the window.
 *
 * The second line is a different measurement from "an idle table is the
 * saloon, not the piano" rather than a restatement of it: it is the two
 * buses inside ONE window, so it is the only thing here that can see the
 * duck. Take the duck out and raise the piano and the idle comparison can
 * still pass while this one does not.
 */
const working = page.evaluate((ms) => window.__layers(ms), 7000)
await page.locator('button.lever').click()
const played = await working
await page.waitForTimeout(2500)
expect('the machine leads while it is working', played.sfx.peak > saloon + 5,
  `${played.sfx.peak.toFixed(1)} dBFS against an idle saloon of ${saloon.toFixed(1)}`)
expect('and the upright is behind both of them', played.band.mean < played.sfx.mean - 10,
  `upright ${played.band.mean.toFixed(1)}, saloon ${saloon.toFixed(1)}, machine ${played.sfx.mean.toFixed(1)} dBFS`)
/*
 * And the other half of the ladder: the loudest thing in an ordinary pull is
 * the machine, not the room.
 *
 * This is the one that says "proportionate" with no taste in it at all. The
 * player pulled the arm of a slot machine; what should dominate is the arm,
 * the reels and the payout. A room that out-shouts the iron on a routine pull
 * is a room performing, and performing four times a minute is exactly what
 * "every pull blows the place up" is as a measurement. The jackpot roar is
 * deliberately exempt - it is the one moment where the room IS the event, and
 * it is pinned the other way round in the section above, over the bell.
 *
 * Measured against the pull rather than against the bell and the coin fall
 * fired on their own, and that is not a convenience. Both of those are built
 * out of eighteen randomised coins and three randomised strikes, so a single
 * peak-hold reading of either moves 2.4dB between runs on the same machine,
 * which is most of the margin this check has. The peak of a whole pull -
 * lever, ratchet, three bands landing, hopper - repeats to 0.4dB, because it
 * is the loudest sound the machine is BUILT to make rather than whichever
 * coin happened to land on top of another one.
 */
expect(
  'and the loudest thing in a pull is the machine',
  heard[loudestRoutine].db < played.sfx.peak,
  `the ${loudestRoutine} at ${heard[loudestRoutine].db.toFixed(1)} against a pull peaking at ${played.sfx.peak.toFixed(1)} dBFS`,
)

/*
 * Reaction lines, as regexes, so a pull can be checked against the reaction
 * the engine actually chose. Keep in step with crowd* in src/i18n/strings.ts.
 */
const LINE = {
  roar: /comes off the floor/i,
  cheer: /slaps the bar/i,
  gasp: /one stop short/i,
  sigh: /a groan/i,
  murmur: /nobody moves/i,
  jeer: /laughter/i,
}

/** Pulls the lever and measures from the instant the room says something. */
async function pull(ms) {
  const measuring = page.evaluate((d) => window.__onReaction(d), ms)
  await page.locator('button.lever').click()
  const got = await measuring
  await page.waitForTimeout(3000)
  const kind = Object.keys(LINE).find((k) => LINE[k].test(got.said))
  return { ...got, kind }
}

for (const n of [1, 2, 3]) {
  const got = await pull(2000)
  expect(`pull ${n} names an outcome`, Boolean(got.kind), got.said || '(nothing on screen)')
  /*
   * Over the room AND over the reel that just stopped. The three bands land in
   * the second before this window opens, so a reaction that were only as loud
   * as the machine would not clear this.
   */
  expect(
    `pull ${n}: the room is heard doing it`,
    got.db > room.level + TOGETHER,
    `${got.kind ?? '?'} at ${got.db.toFixed(1)} dBFS over a ${room.level.toFixed(1)} room`,
  )
  /*
   * The colour matches the reaction the engine named, measured the same way
   * as the isolated pass - so a groan cannot be a cheer wearing a groan's
   * caption.
   *
   * The ceiling depends on whether the pull PAID, and that is read off the
   * engine rather than guessed: reactionTo() in src/game/engine.ts returns a
   * roar at 20 coins or more, a cheer at 5, a murmur at anything above zero,
   * and a groan or a gasp at nothing. So on those first three the window
   * contains the bell and the coin fall as well as the room, and the coin
   * fall is by measurement the brightest thing on the table - 1.40 against
   * 0.37 for a groan. A mixture cannot be more coloured than its brightest
   * component, so that is the ceiling, and it is a number from this same run.
   *
   * It was a flat 2x, which is the check failing on a jackpot for a reason
   * that is not a defect: 1.32 measured against a roar of 0.59 alone. Both of
   * those readings were right. What was wrong was asking a roar buried in
   * eighteen falling coins to have the colour of a roar on its own.
   *
   * The allowance over that brightest component is 1.5x rather than something
   * nearer 1, and the reason is a real mechanism rather than slack. A paying
   * pull is the only window in this file where the room DUCKS: a roar takes
   * the bed down by 70%, and the bed is now the darkest thing on the table
   * since the conversation got low-passed to stop it sounding like words. So
   * the mixture has had dark content removed that every one of its components
   * was measured with still present, and it therefore legitimately reads
   * brighter than all of them - 1.12 against 0.93 for the coin fall, which at
   * 1.2x was a fail by two hundredths. It still bounds something: a groan in
   * a jackpot's caption measures 0.14.
   *
   * The two reactions that pay nothing are the ones this check is really
   * for: a gasp and a groan are both a losing pull, so the difference
   * between them cannot be the payout - it is the vowel, and the gap between
   * them is in the throat rather than borrowed from the room. See
   * VoiceOpts.top in src/audio/crowd.ts.
   *
   * Those two used to be held inside a [0.5x, 2x] band around the solo
   * median, and that failed in CI on a groan reading 0.16 against 0.35 -
   * under the floor by two hundredths. Nothing was wrong with the mix. The
   * band was narrower than the noise it was measuring, and this is the third
   * time that mistake has been made in this file in a different place.
   *
   * Sampled sixteen times each, a single firing's colour spans:
   *
   *     gasp    0.799   (0.621 - 1.070)
   *     sigh    0.275   (0.201 - 0.442)
   *
   * A 2.2x spread on the groan on its own, against a window of 4x total -
   * so a fixed band around the median cannot hold, and the asymmetry makes
   * it worse: `solo` is a MEDIAN OF FIVE firings and `got.bright` is ONE
   * draw taken in context, so the two sides of the comparison are not even
   * estimates of the same quality.
   *
   * What the check is for does not need a band. reactionTo() returns a gasp
   * or a groan and nothing else when a pull pays nothing, so on an unpaid
   * pull there are exactly TWO sounds this could be, and the question is
   * which - a classification, not a tolerance. So ask whether the reading is
   * nearer the named one than the other, in log ratio because these are
   * ratios. The two part at their geometric mean, 0.469, which is 1.7x clear
   * of either median and still 1.06x above the loudest groan ever measured
   * here. Both margins are wider than the spread, which is what the band it
   * replaces could not say.
   *
   * The paying three keep the ceiling above, because up there the coin fall
   * and the bell are legitimately inside the window and the thing worth
   * bounding is the mixture.
   */
  if (got.kind) {
    const solo = heard[got.kind].bright
    if (['roar', 'cheer', 'murmur'].includes(got.kind)) {
      const ceiling = Math.max(solo, heard.coins.bright, heard.bell.bright) * 1.5
      expect(
        `pull ${n}: and it is the ${got.kind} it says it is`,
        got.bright > solo * 0.5 && got.bright < ceiling,
        `${got.bright.toFixed(2)} against ${solo.toFixed(2)} alone and ${heard.coins.bright.toFixed(2)} for the money that fell with it`,
      )
    } else {
      const other = got.kind === 'sigh' ? 'gasp' : 'sigh'
      const rival = heard[other].bright
      expect(
        `pull ${n}: and it is the ${got.kind} it says it is`,
        Math.abs(Math.log(got.bright / solo)) < Math.abs(Math.log(got.bright / rival)),
        `${got.bright.toFixed(2)} is nearer the ${got.kind}'s ${solo.toFixed(2)} than the ${other}'s ${rival.toFixed(2)}, which part at ${Math.sqrt(solo * rival).toFixed(2)}`,
      )
    }
  }
}

/* ---- 4. silence --------------------------------------------------------- */

/*
 * Calling the house out stops the room dead - the oldest gesture in the genre
 * and the only real silence on this table. The window is taken 0.8s after the
 * shout, because the shout itself is loud and hush() runs for 1.7s behind it.
 */
const hushing = page.evaluate(([w, d]) => new Promise((done) => {
  setTimeout(async () => done(await window.__grab(d)), w)
}), [900, 500])
await page.keyboard.press('c')
const hushed = await hushing
expect(
  'calling the house stops the room dead',
  hushed.db < room.level - 20,
  `${hushed.db.toFixed(1)} dBFS, room was ${room.level.toFixed(1)}`,
)
await page.waitForTimeout(4500)

await page.locator('button.sound').click()
await page.waitForTimeout(700)
expect('the control then reads muted', (await label(page)).includes('🔇'), await label(page))
const off = await page.evaluate((d) => window.__grab(d), 1400)
expect('and mute means mute', off.db < -70, `${off.db.toFixed(1)} dBFS`)

await page.locator('button.sound').click()
await page.waitForTimeout(1800)
expect('unmuting reads on again', (await label(page)).includes('🔊'), await label(page))
const back = await page.evaluate((d) => window.__grab(d), 4000)
/*
 * Level against level, not peak against level, because this one is about the
 * room being THERE rather than about an event being audible in it - and a
 * peak here would be asking whether a glass happened to land in the window.
 * Measured on the deployed build it cleared a peak threshold by 0.4dB, which
 * is the same rubber ruler as the room tone, caught before it could fail.
 */
expect(
  'and brings the room back',
  back.mean > room.level - 4,
  `${back.mean.toFixed(1)} dBFS average against a room of ${room.level.toFixed(1)}`,
)

await browser.close()

if (problems.length) console.error('\n' + problems.join('\n'))
console.log(
  problems.length
    ? '\nFAILED'
    : `\nOK: ${checks} measurements of real signal; the saloon leads and answers a loss as well as a win`,
)
process.exit(problems.length ? 1 : 0)
