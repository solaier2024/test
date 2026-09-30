/*
 * Fires one cue many times and prints the distribution of the level and the
 * colour that verify-audio.mjs holds its thresholds against.
 *
 *   node scripts/probe-spread.mjs [cue] [firings] [url]
 *
 * It is not part of any verify chain. It exists because a reaction here is a
 * handful of randomised throats and verify-audio.mjs reads one by peak-hold,
 * so the number it prints is a draw from a distribution - and the check that
 * guards those readings takes the inner range of five firings and then the
 * WIDEST of six cues, which is an extreme value of an extreme value. One run
 * of that file is a single sample of the thing actually in question, and at
 * five minutes a sample you cannot see the shape. This gets sixteen firings
 * of one cue in about a minute, and reports the statistic the check holds
 * alongside the whole spread, so a fix can be told apart from a lucky run.
 *
 * It is how the CI failure of "no reaction is too erratic to compare" was
 * tracked down: the gasp read 4.3dB there against a 4.0 limit while the whole
 * file was green locally. Two things it ruled out on the way are worth as
 * much as the answer:
 *
 *   - It is not the harness. The measuring loop samples the analyser on
 *     requestAnimationFrame, which is the one clock a loaded CI runner
 *     starves, so that was the first suspect. Swapping it for setTimeout
 *     sampled 627 times in the window instead of 157 and the spread did not
 *     improve at all - at 60fps a 2048-sample read already covers more time
 *     than the gap to the next frame, so there was never a hole to miss a
 *     peak through.
 *   - It is not the room leaking in. A busier bar puts more glassware inside
 *     each measurement window, but that is bounded by the room's own peak and
 *     comes to about a dB.
 *
 * What it was is in react(): an eight-decibel random gain per throat, and the
 * loudest one in the draw sets the peak of the sum.
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const cue = process.argv[2] ?? 'gasp'
const firings = Number(process.argv[3] ?? 16)
const url = process.argv[4] ?? 'http://127.0.0.1:5180/'

/* Deliberately the same measurement as verify-audio.mjs, down to the fftSize
 * and the rAF cadence. A probe that measures differently cannot say anything
 * about what that file reads. */
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
  window.__fire = async (what, ms, density = 0.6) => {
    const probe = window.__probe
    const time = new Float32Array(probe.fftSize)
    const freq = new Float32Array(probe.frequencyBinCount)
    const sum = new Float64Array(probe.frequencyBinCount)
    const hz = probe.context.sampleRate / 2 / probe.frequencyBinCount
    let peak = 0
    let frames = 0
    const until = performance.now() + ms
    if (what === 'coins') window.__audio.coins(18)
    else if (what === 'bell') window.__audio.bell(3)
    else window.__audio.react(what, density)
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
    const band = (lo, hi) => {
      let s = 0
      for (let i = Math.ceil(lo / hz); i < Math.min(sum.length, hi / hz); i++) s += sum[i]
      return s / frames
    }
    return {
      db: peak > 0 ? 20 * Math.log10(peak) : -200,
      bright: band(1200, 6000) / Math.max(1e-9, band(80, 1200)),
      frames,
    }
  }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ reducedMotion: 'no-preference' })
await context.addInitScript(PROBE)
const page = await context.newPage()
await skipIntro(page, url)
await page.waitForSelector('.machines button', { timeout: 30000 })
// The crooked machine, so the table is the one verify-audio.mjs measures on.
await page.locator('.machines button').nth(2).click()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(3000)

const runs = []
for (let i = 0; i < firings; i++) {
  runs.push(await page.evaluate(([w, ms]) => window.__fire(w, ms), [cue, 2600]))
  await page.waitForTimeout(700)
}
await browser.close()

const inner = (xs) => xs[xs.length - 2] - xs[1]
const mid = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const dbs = runs.map((r) => r.db).sort((a, b) => a - b)
console.log(`${cue}, ${firings} firings`)
console.log('  levels        ', dbs.map((d) => d.toFixed(1)).join(' '))
console.log(`  median         ${mid(dbs).toFixed(2)} dBFS`)
console.log(`  full range     ${(dbs.at(-1) - dbs[0]).toFixed(2)} dB over all of them`)
/* The statistic verify-audio.mjs actually holds, sampled every way the run
 * could have fallen: the inner range of five consecutive firings. */
const fives = []
for (let i = 0; i + 5 <= runs.length; i++) {
  fives.push(inner(runs.slice(i, i + 5).map((r) => r.db).sort((a, b) => a - b)))
}
console.log('  inner-five     ', fives.map((f) => f.toFixed(1)).join(' '))
console.log(`  worst inner-five ${Math.max(...fives).toFixed(2)} dB, against a limit of 4`)
const br = runs.map((r) => r.bright).sort((a, b) => a - b)
console.log(`  colour         ${mid(br).toFixed(3)} median, ${br[0].toFixed(3)} to ${br.at(-1).toFixed(3)}`)
console.log(`  sampled        ${mid(runs.map((r) => r.frames))} times in the 2600ms window`)
