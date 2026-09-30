#!/usr/bin/env node
/*
 * What does this table SOUND LIKE - not how loud is it.
 *
 *   node scripts/probe-fingerprint.mjs <url> [out.json]
 *   node scripts/probe-fingerprint.mjs --diff before.json after.json
 *
 * Not a check. Nothing in here has a threshold and nothing fails.
 *
 * It exists because of a complaint that no check in this project could have
 * answered, and that the person making it was right about: "预览几乎没感觉到
 * 变化" - the preview feels about the same. Every number in verify-audio.mjs
 * is a RELATIONSHIP - the roar clears the room by 11dB, the groan sits within
 * 5dB of the cheer, the band is 10dB under the machine. That is the correct
 * way to hold a mix, because it survives someone changing the master fader.
 * It is also, exactly, a specification that a completely different set of
 * sounds can satisfy while an identical set of sounds also satisfies it. Pass
 * every check in that file twice, with two unrelated soundtracks, and it
 * cannot tell you which one you are listening to.
 *
 * So this measures the thing that file deliberately throws away: the SHAPE of
 * each sound, normalised so that its level cannot enter into it. Two builds
 * whose fingerprints differ by a fraction of a dB per band are the same
 * material with the faders moved. Two builds that differ by several dB per
 * band are different material, and that is a claim about the work rather than
 * about the mix.
 *
 * The fingerprint is deliberately crude, and it has to be:
 *
 *   EIGHT OCTAVE BANDS, not a spectrum. A 1024-bin spectrum of a randomised
 *     crowd differs from itself run to run; octave bands are the coarsest
 *     description that can still tell a banjo from a piano. Measured against
 *     itself twice on one build, this whole table repeats to about 0.5dB,
 *     which is the noise floor of the instrument and the reason the diff
 *     prints it.
 *
 *   NORMALISED TO EACH SOUND'S OWN TOTAL. Every row is a shape summing to
 *     unity before the logarithm, so turning the whole table up or down, or
 *     turning one cue up or down, moves nothing here at all. That is the
 *     point: "I changed the mix" and "I changed the sounds" are different
 *     claims and this only answers the second one.
 *
 *   THE ENERGY A CUE ADDS, not the energy present while it plays. A reaction
 *     is fired over a room that is still going, so a window containing a
 *     groan is mostly saloon. Each cue is therefore measured twice - once
 *     idle, once firing - and the fingerprint is the difference. Without
 *     that, six reactions come back looking like six copies of the room,
 *     because in a level sense that is what they are.
 *
 * What it cannot tell you is whether the new material is any GOOD. That is
 * what listening is for, and what verify-audio.mjs holds the mix to once the
 * listening is done.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { skipIntro, open } from './lib/skip-intro.mjs'

/* ------------------------------------------------------------------ the diff */

/** Octave-ish, 60Hz to the top of hearing. Labels are what gets printed. */
const BANDS = [
  ['60', 60, 125],
  ['125', 125, 250],
  ['250', 250, 500],
  ['500', 500, 1000],
  ['1k', 1000, 2000],
  ['2k', 2000, 4000],
  ['4k', 4000, 8000],
  ['8k', 8000, 16000],
]

if (process.argv[2] === '--diff') {
  const [a, b] = process.argv.slice(3).map((p) => JSON.parse(readFileSync(p, 'utf8')))
  if (!a || !b) {
    console.error('usage: node scripts/probe-fingerprint.mjs --diff before.json after.json')
    process.exit(1)
  }
  const names = Object.keys(a.sounds).filter((n) => b.sounds[n])
  console.log(`before  ${a.url}\n        ${a.at}`)
  console.log(`after   ${b.url}\n        ${b.at}\n`)
  console.log('sound'.padEnd(10) + BANDS.map(([l]) => l.padStart(7)).join('') + '     mean')
  let total = 0
  for (const name of names) {
    const d = BANDS.map((_, i) => b.sounds[name].shape[i] - a.sounds[name].shape[i])
    const mean = d.reduce((s, v) => s + Math.abs(v), 0) / d.length
    total += mean
    console.log(
      name.padEnd(10) +
        d.map((v) => (v >= 0 ? '+' : '') + v.toFixed(1)).map((s) => s.padStart(7)).join('') +
        mean.toFixed(2).padStart(9),
    )
  }
  const overall = total / names.length
  console.log(`\n${names.length} sounds, ${overall.toFixed(2)}dB per band on average`)
  /*
   * The number to read it against. Running this twice against one unchanged
   * build gives 0.4-0.6dB per band, which is the crowd being randomised and
   * the room's events falling in different places - so anything under about
   * 1dB is the same material measured twice, and the verdict below is that
   * threshold and nothing cleverer.
   */
  console.log(
    overall < 1
      ? 'That is inside the instrument\'s own repeatability: the same sounds, possibly remixed.'
      : 'Different material. (Twice on one unchanged build reads 0.4-0.6dB.)',
  )
  process.exit(0)
}

/* ------------------------------------------------------------ the measurement */

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[3]
const url = `${BASE}${BASE.includes('?') ? '&' : '?'}seed=51`

/*
 * Same patch as verify-audio.mjs uses, and deliberately the same: a probe on
 * whatever joins the destination, installed before any page code runs. A
 * fingerprint taken through a different instrument than the checks use could
 * not be argued against them.
 */
const PROBE = () => {
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !window.__probe) {
      const probe = this.context.createAnalyser()
      probe.fftSize = 4096
      probe.smoothingTimeConstant = 0
      connect.call(this, probe)
      window.__probe = probe
    }
    return connect.call(this, dest, ...rest)
  }

  /**
   * Average power spectrum over a window, in linear power per bin.
   *
   * @param node  a bus, or nothing for the destination.
   * @param floor gate: frames quieter than this fraction of the window's own
   *        loudest frame are dropped. The band sits at digital silence
   *        between numbers and the gaps are most of any window long enough to
   *        be stable, so averaging them in measures the silence.
   */
  window.__spectrum = async (ms, which, floor = 0) => {
    const c = window.__audio.ctx()
    let probe = window.__probe
    if (which) {
      const node = window.__audio.buses()[which]
      if (!node) return null
      probe = c.createAnalyser()
      probe.fftSize = 4096
      probe.smoothingTimeConstant = 0
      node.connect(probe)
    }
    const bins = new Float32Array(probe.frequencyBinCount)
    const time = new Float32Array(probe.fftSize)
    const frames = []
    const until = performance.now() + ms
    while (performance.now() < until) {
      probe.getFloatTimeDomainData(time)
      let sq = 0
      for (const s of time) sq += s * s
      probe.getFloatFrequencyData(bins)
      frames.push({ rms: Math.sqrt(sq / time.length), bins: Float32Array.from(bins) })
      await new Promise((r) => requestAnimationFrame(r))
    }
    const loudest = frames.reduce((m, f) => Math.max(m, f.rms), 0)
    const kept = frames.filter((f) => f.rms >= loudest * floor)
    const power = new Float64Array(probe.frequencyBinCount)
    for (const f of kept) {
      for (let i = 0; i < power.length; i++) power[i] += 10 ** (f.bins[i] / 10)
    }
    for (let i = 0; i < power.length; i++) power[i] /= Math.max(1, kept.length)
    return { power: Array.from(power), hzPerBin: c.sampleRate / 2 / power.length, frames: kept.length }
  }

  /** Idle window, then the same window with a cue in it. */
  window.__cue = async (what, ms) => {
    const before = await window.__spectrum(ms)
    const measuring = window.__spectrum(ms)
    if (what === 'coins') window.__audio.coins(18)
    else if (what === 'bell') window.__audio.bell(3)
    else if (what !== 'pull') window.__audio.react(what, 0.6)
    const after = await measuring
    return { before, after }
  }
}

const bands = (spectrum) => {
  if (!spectrum) return null
  const { power, hzPerBin } = spectrum
  return BANDS.map(([, lo, hi]) => {
    let s = 0
    for (let i = Math.ceil(lo / hzPerBin); i < Math.min(power.length, hi / hzPerBin); i++) s += power[i]
    return s
  })
}

/** A band vector as a SHAPE: dB relative to its own total, so level drops out. */
const shape = (raw) => {
  const total = raw.reduce((s, v) => s + v, 0)
  return raw.map((v) => +(10 * Math.log10(Math.max(1e-12, v) / Math.max(1e-12, total))).toFixed(2))
}

/** What a cue ADDED over the idle room underneath it. */
const added = ({ before, after }) => {
  const a = bands(before)
  const b = bands(after)
  return shape(b.map((v, i) => Math.max(v * 0.02, v - a[i])))
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ reducedMotion: 'no-preference' })
await context.addInitScript(PROBE)

async function soundOn(p) {
  for (let i = 0; i < 3; i++) {
    const label = (await p.locator('button.sound').textContent()) ?? ''
    if (label.includes('🔊')) return
    await p.locator('button.sound').click()
    await p.waitForTimeout(500)
  }
}

const sounds = {}

/* The film first, on its own page, because the opening only plays once. */
const film = await context.newPage()
await open(film, url)
await film.waitForSelector('.intro-video', { timeout: 30000 })
await soundOn(film)
sounds.opening = { shape: shape(bands(await film.evaluate((ms) => window.__spectrum(ms), 6000))) }
await film.close()

const page = await context.newPage()
await skipIntro(page, url)
await page.waitForSelector('.machines button', { timeout: 30000 })
await soundOn(page)
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(3000)

/* The three standing layers, each on its own bus. */
sounds.room = { shape: shape(bands(await page.evaluate((ms) => window.__spectrum(ms, 'sfx'), 8000))) }
sounds.talk = { shape: shape(bands(await page.evaluate((ms) => window.__spectrum(ms, 'talk'), 8000))) }
/* Gated at a fifth of its own loudest frame: between numbers this bus is
 * digitally silent, and a window that catches a gap would otherwise be a
 * fingerprint of the noise floor. */
sounds.band = {
  shape: shape(bands(await page.evaluate((ms) => window.__spectrum(ms, 'band', 0.2), 14000))),
}

for (const cue of ['roar', 'cheer', 'gasp', 'sigh', 'jeer', 'murmur', 'coins', 'bell']) {
  sounds[cue] = { shape: added(await page.evaluate(([c, ms]) => window.__cue(c, ms), [cue, 2500])) }
  await page.waitForTimeout(2200)
}

/* And the iron, which is the one cue that has to be played rather than fired. */
const pulling = page.evaluate((ms) => window.__cue('pull', ms), 2600)
await page.waitForTimeout(2650)
await page.locator('button.lever').click()
sounds.pull = { shape: added(await pulling) }

await browser.close()

const out = { url: BASE, at: new Date().toISOString(), bands: BANDS.map(([l]) => l), sounds }

console.log('sound'.padEnd(10) + BANDS.map(([l]) => l.padStart(7)).join(''))
for (const [name, v] of Object.entries(sounds)) {
  console.log(name.padEnd(10) + v.shape.map((n) => n.toFixed(1).padStart(7)).join(''))
}
console.log('\ndB relative to each sound\'s own total, so this says nothing about level.')

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`\nwritten to ${OUT}`)
}
