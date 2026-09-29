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
 * Three kinds of check, in order.
 *
 *   1. Each reaction on its own, fired through the game's own react() on the
 *      game's own graph, so the six can be compared against each other and
 *      against the machine sounds they have to be heard over. Nothing is
 *      simulated: window.__audio.react IS src/audio/crowd.ts.
 *
 *   2. The binding, by playing. A reaction that is audible but fires on the
 *      wrong outcome is the "fake noise" the brief was guarding against, so
 *      the play-through insists the sound arrives with the line that names
 *      the outcome that caused it. reactionTo() is pinned exhaustively in
 *      src/game/engine.test.ts; this is the other end of the same wire.
 *
 *   3. Silence: the hush on a call, and mute meaning mute.
 *
 * Absolute levels are asserted only as "over the room", because the room is
 * measured in the same run. Everything else is a relationship between two
 * numbers from the same session, which survives a change of mix.
 *
 * What the table sounds like now, peak-hold at the destination against a room
 * tone of -36dBFS, and what it sounded like before any of this was measured:
 *
 *                       was     now      above 1.2kHz
 *     roar            -37.4   -24.9          0.72
 *     cheer               -   -27.5          0.79
 *     gasp            -37.0   -27.1          0.79   <- brighter
 *     sigh            -37.7   -27.9          0.46   <- darker
 *     jeer                -   -28.7          0.60
 *     murmur              -   -33.6          0.73
 *     the coin fall   -30.1   -31.4          1.40
 *     the bell        -28.4   -29.8          0.98
 *
 * The left column is the whole problem in one place: the three reactions that
 * were measurable were all quieter than the room they were supposed to be
 * reacting in, and both of the machine's own noises were louder than any of
 * them.
 *
 * The right column is a median of three firings, because a crowd is randomised
 * on purpose and one reading is a sample rather than a measurement. Thresholds
 * are set with a few dB of margin rather than against these exact figures.
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

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
    let frames = 0
    const until = performance.now() + ms
    while (performance.now() < until) {
      probe.getFloatTimeDomainData(time)
      let sq = 0
      for (const s of time) sq += s * s
      peak = Math.max(peak, Math.sqrt(sq / time.length))
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
    const { sfx, piano, music } = window.__audio.buses()
    const c = window.__audio.ctx()
    const taps = Object.entries({ sfx, piano, music }).map(([name, node]) => {
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
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

await skipIntro(page, url)
await page.waitForSelector('.machines button', { timeout: 30000 })

const label = () => page.locator('button.sound').textContent().then((s) => (s ?? '').trim())

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
async function soundOn() {
  for (let i = 0; i < 3; i++) {
    if ((await label()).includes('🔊')) return true
    await page.locator('button.sound').click()
    await page.waitForTimeout(500)
  }
  return (await label()).includes('🔊')
}
expect('the sound control turns audio on', await soundOn(), await label())

// The crooked machine: the most reactions per pull, so the fewest pulls.
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(3000)

/* ---- 0. what the table is made of ------------------------------------- */

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
 * inside a six second window swings the peak by 6dB. That spread is the room
 * being a room, and the median is what the room is like.
 */
const idle = []
for (let i = 0; i < 3; i++) idle.push(await page.evaluate((ms) => window.__layers(ms), 6000))
const layer = (bus, field = 'peak') => median(idle.map((m) => m[bus][field]))
const saloon = layer('sfx')
const upright = layer('piano')

expect('an idle table is the saloon, not the piano', saloon > upright + 4,
  `the room ${saloon.toFixed(1)} dBFS against an upright at ${upright.toFixed(1)}`)
/*
 * And the room is a ROOM, not a hiss. A bed of filtered noise loud enough to
 * lead the mix is just tape hiss; what makes a saloon read as busy at a much
 * lower level is that things happen in it. A wide gap between peak and mean
 * is what "things happen in it" looks like as a number.
 */
expect('and it is a room rather than a hum', saloon - layer('sfx', 'mean') > 5,
  `${(saloon - layer('sfx', 'mean')).toFixed(1)}dB between the loudest thing in it and its average`)

/* ---- 1. the room, and the six things it does -------------------------- */

/*
 * Measured first and every reaction is compared against it, so a table that
 * was silent to begin with cannot pass the rest of this file by default.
 *
 * Three windows and the middle one, like everything else here, and for a
 * reason that only appeared once the bar had glassware in it: the room used
 * to be a steady hum, where one peak-hold reading is the level, and it is now
 * a hum with events on top, where one reading is whichever event happened to
 * land. Measured across windows it moves by 6dB, which is enough to have
 * turned every "audible over the room" comparison below into a coin toss.
 */
const roomRuns = []
for (let i = 0; i < 3; i++) roomRuns.push(await page.evaluate((ms) => window.__grab(ms), 3000))
const room = { db: median(roomRuns.map((r) => r.db)), bright: median(roomRuns.map((r) => r.bright)) }
expect('the empty table has a room tone', room.db > -55 && room.db < -25, `${room.db.toFixed(1)} dBFS`)

const fire = async (what) => {
  const got = await page.evaluate(([w, ms]) => window.__fire(w, ms), [what, 2800])
  await page.waitForTimeout(2400)
  return got
}

/**
 * Three firings, and the middle one of each number.
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
 */
const fireOften = async (what, n = 3) => {
  const runs = []
  for (let i = 0; i < n; i++) runs.push(await fire(what))
  return {
    db: median(runs.map((r) => r.db)),
    bright: median(runs.map((r) => r.bright)),
    spread: Math.max(...runs.map((r) => r.db)) - Math.min(...runs.map((r) => r.db)),
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
const over = (k) => `${heard[k].db.toFixed(1)} dBFS over a ${room.db.toFixed(1)} room`

/*
 * All six, not just the two the happy path fires. A reaction nobody has heard
 * since it was written is exactly where 12dB goes missing.
 */
for (const kind of ['roar', 'cheer', 'gasp', 'sigh', 'jeer']) {
  expect(`the room's ${kind} is audible over it`, heard[kind].db > room.db + 3.5, over(kind))
}
/*
 * The exception, and it is deliberate: a murmur is the room NOT reacting -
 * a win too small to look up from. It has to be there, and it has to be the
 * smallest thing the room does, which is a relationship rather than a level.
 */
const quietest = Math.min(...['roar', 'cheer', 'gasp', 'sigh', 'jeer'].map((k) => heard[k].db))
expect(
  'a murmur is there, and is the least the room does',
  heard.murmur.db > room.db + 1 && heard.murmur.db < quietest - 1,
  `${heard.murmur.db.toFixed(1)} dBFS, between a ${room.db.toFixed(1)} room and a ${quietest.toFixed(1)} groan`,
)
/*
 * And it holds still enough to be worth ordering. A murmur was five throats
 * scattered over 300ms, which barely overlap, so peak-hold was reading one
 * random voice and swinging 6.7dB; it is twelve inside 160ms now, at the same
 * level, because the level was never the problem.
 */
expect(
  'and no reaction is too erratic to compare',
  Math.max(...['roar', 'cheer', 'gasp', 'sigh', 'jeer', 'murmur'].map((k) => heard[k].spread)) < 6,
  `widest spread over three firings ${Math.max(...['roar', 'cheer', 'gasp', 'sigh', 'jeer', 'murmur'].map((k) => heard[k].spread)).toFixed(1)}dB`,
)

/*
 * The whole point of the brief, as one line: a loss is answered at a
 * comparable level to a win. Not equal - a jackpot should be the loudest thing
 * in the building - but within sight of it, which is what "输赢均有" asks for.
 */
expect(
  'a loss is answered within 6dB of a win',
  heard.sigh.db > heard.roar.db - 6,
  `groan ${heard.sigh.db.toFixed(1)} against a roar of ${heard.roar.db.toFixed(1)} dBFS`,
)
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

/* ---- 2. bound to the outcome, by playing ------------------------------ */

/*
 * The other half of the balance, measured while the machine is working: iron
 * and coins in front of the saloon, and the upright still behind both. The
 * window is one whole pull, so what it catches is the ratchet, the three
 * bands landing and whatever the room says about it.
 */
const working = page.evaluate((ms) => window.__layers(ms), 7000)
await page.locator('button.lever').click()
const played = await working
await page.waitForTimeout(2500)
expect('the machine leads while it is working', played.sfx.peak > saloon + 5,
  `${played.sfx.peak.toFixed(1)} dBFS against an idle saloon of ${saloon.toFixed(1)}`)
expect('and the upright is behind both of them', played.piano.peak < saloon - 2,
  `upright ${played.piano.peak.toFixed(1)}, saloon ${saloon.toFixed(1)}, machine ${played.sfx.peak.toFixed(1)} dBFS`)

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
    got.db > room.db + 3,
    `${got.kind ?? '?'} at ${got.db.toFixed(1)} dBFS over a ${room.db.toFixed(1)} room`,
  )
  /*
   * The colour matches the reaction the engine named, measured the same way
   * as the isolated pass - so a groan cannot be a cheer wearing a groan's
   * caption. The band is wide because in play the reaction shares its window
   * with whatever the machine is doing, and the coin fall is the brightest
   * thing on the table; the separation being checked is the 1.75x between a
   * gasp and a groan, which is well outside it.
   */
  if (got.kind) {
    const solo = heard[got.kind].bright
    expect(
      `pull ${n}: and it is the ${got.kind} it says it is`,
      got.bright > solo * 0.5 && got.bright < solo * 2,
      `${got.bright.toFixed(2)} against ${solo.toFixed(2)} measured alone`,
    )
  }
}

/* ---- 3. silence --------------------------------------------------------- */

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
expect('calling the house stops the room dead', hushed.db < room.db - 15, `${hushed.db.toFixed(1)} dBFS, room was ${room.db.toFixed(1)}`)
await page.waitForTimeout(4500)

await page.locator('button.sound').click()
await page.waitForTimeout(700)
expect('the control then reads muted', (await label()).includes('🔇'), await label())
const off = await page.evaluate((d) => window.__grab(d), 1400)
expect('and mute means mute', off.db < -70, `${off.db.toFixed(1)} dBFS`)

await page.locator('button.sound').click()
await page.waitForTimeout(1800)
expect('unmuting reads on again', (await label()).includes('🔊'), await label())
const back = await page.evaluate((d) => window.__grab(d), 2000)
expect('and brings the room back', back.db > room.db - 6, `${back.db.toFixed(1)} dBFS`)

await browser.close()

if (problems.length) console.error('\n' + problems.join('\n'))
console.log(
  problems.length
    ? '\nFAILED'
    : `\nOK: ${checks} measurements at the destination; the room answers a loss as well as a win`,
)
process.exit(problems.length ? 1 : 0)
